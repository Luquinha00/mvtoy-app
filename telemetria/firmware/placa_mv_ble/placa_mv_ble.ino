/*
  Placa MV · Bluetooth · v0.3 · 20/11/2026
  Arquitetura v2 (regra do Lucas): a MAQUININHA é a central. A placa não tem Wi-Fi, botão nem configuração:
  ela só encaixa no chicote do moedeiro e conversa por Bluetooth (BLE) com o app MV Toy na maquininha.
  A maquininha leva os pacotes da placa até o servidor (Wi-Fi do ponto ou 4G dela) e traz as respostas.

  Segurança: a placa assina o que manda (HMAC-SHA256 com o segredo dela) e só solta crédito com assinatura
  válida do servidor. A maquininha só repassa: não consegue inventar crédito nem apagar moeda.

  Gravação (uma vez, na bancada): Arduino IDE, placa "ESP32 Dev Module", bibliotecas ArduinoJson 7.
  O número e o segredo da placa são gravados pela porta USB com o comando serial:
      CFG MVP-0001 <segredo>      (o app › Placas › Placa nova mostra os dois)
  e ficam na memória. Nenhum segredo neste arquivo.

  Ligação: telemetria/MONTAGEM.md (entrada GPIO 27 via BC547 e saída GPIO 26 via BC337; 12 V → step-down 5 V → VIN).
  Encaixe em paralelo no chicote: se a placa falhar, a moeda continua funcionando.

  BLE — serviço MV (UUIDs fixos, o app da maquininha procura por eles):
   - PACOTE  (leitura + aviso): {"ts":..,"corpo":"<json>","sig":"<hex>"}  → a maquininha envia ao tel-sync
       com os cabeçalhos x-placa / x-ts / x-sig e o corpo.
   - RESPOSTA (escrita): a resposta do tel-sync, sem mudar nada → a placa confere e solta os créditos.
   - INFO    (leitura): {"id":"MVP-0001","fw":"0.3"} (o app confere com o QR antes de ligar).
  Nome Bluetooth: o número da placa (ex.: MVP-0001).
*/
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

#define SERVICO_UUID  "6d760001-4d56-4d56-a001-6d76706c6163"
#define PACOTE_UUID   "6d760002-4d56-4d56-a001-6d76706c6163"
#define RESPOSTA_UUID "6d760003-4d56-4d56-a001-6d76706c6163"
#define INFO_UUID     "6d760004-4d56-4d56-a001-6d76706c6163"

const char* FIRMWARE = "0.3";
const int PINO_MOEDA = 27, PINO_CREDITO = 26, PINO_LED = 2;
const uint32_t DEBOUNCE_US = 15000;
const uint32_t PACOTE_MS = 5000;

char PLACA_ID[16] = "";
char PLACA_SEGREDO[65] = "";
Preferences mem;

volatile uint32_t moedasPendentes = 0, ultimoPulsoUs = 0;
volatile bool emitindo = false;   // enquanto a placa solta crédito, o próprio pulso não conta como moeda
uint32_t pulsoMs = 60, intervaloMs = 80, loteAtual = 0, moedasDoLote = 0;
long deltaRelogio = 0;
bool primeiroEnvio = true, conectado = false;

const int MAX_FEITOS = 20;
String feitos[MAX_FEITOS]; bool feitoConfirmado[MAX_FEITOS]; int proxFeito = 0;

BLECharacteristic *chPacote, *chResposta, *chInfo;
String respostaPendente; volatile bool temResposta = false;

void IRAM_ATTR aoPulsoMoeda() { if (emitindo) return; uint32_t a = micros(); if (a - ultimoPulsoUs > DEBOUNCE_US) { moedasPendentes++; ultimoPulsoUs = a; } }

String hmacHex(const String& msg) {
  byte out[32]; mbedtls_md_context_t ctx; mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)PLACA_SEGREDO, strlen(PLACA_SEGREDO));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out); mbedtls_md_free(&ctx);
  char hex[65]; for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]); hex[64] = 0; return String(hex);
}

bool jaFeito(const String& id) { for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) return true; return false; }
void marcarFeito(const String& id) {
  feitos[proxFeito] = id; feitoConfirmado[proxFeito] = false; proxFeito = (proxFeito + 1) % MAX_FEITOS;
  for (int i = 0; i < MAX_FEITOS; i++) mem.putString(("f" + String(i)).c_str(), feitos[i]);
  mem.putInt("prox", proxFeito);
}
void darCredito(int pulsos) {
  emitindo = true;
  for (int i = 0; i < pulsos; i++) { digitalWrite(PINO_CREDITO, HIGH); delay(pulsoMs); digitalWrite(PINO_CREDITO, LOW); delay(intervaloMs); }
  delay(30); emitindo = false;
}

// monta o pacote assinado que a maquininha vai levar ao servidor
void montarPacote() {
  if (!strlen(PLACA_ID) || !strlen(PLACA_SEGREDO)) return;
  if (moedasDoLote == 0) {
    noInterrupts(); moedasDoLote = moedasPendentes; moedasPendentes = 0; interrupts();
    if (moedasDoLote > 0) { loteAtual++; mem.putUInt("lote", loteAtual); }
  }
  JsonDocument c;
  c["fw"] = FIRMWARE; c["lote"] = loteAtual; c["moedas"] = moedasDoLote; c["rssi"] = 0;
  if (primeiroEnvio) c["boot"] = true;
  JsonArray arr = c["feitos"].to<JsonArray>(); int n = 0;
  for (int i = 0; i < MAX_FEITOS && n < 5; i++) if (feitos[i].length() && !feitoConfirmado[i]) { arr.add(feitos[i]); n++; }
  String corpo; serializeJson(c, corpo);
  long ts = (long)(millis() / 1000) + deltaRelogio;
  JsonDocument p; p["ts"] = ts; p["corpo"] = corpo; p["sig"] = hmacHex(String(ts) + "." + corpo);
  String saida; serializeJson(p, saida);
  chPacote->setValue(saida.c_str());
  if (conectado) chPacote->notify();
}

// a maquininha devolveu a resposta do servidor
void tratarResposta(const String& txt) {
  JsonDocument r; if (deserializeJson(r, txt)) return;
  if (r["agora"].is<long>()) deltaRelogio = r["agora"].as<long>() - (long)(millis() / 1000);
  if (!r["ok"].as<bool>()) { montarPacote(); return; }  // erro (ex.: relógio): já refaz o pacote com o relógio certo
  moedasDoLote = 0; primeiroEnvio = false;
  for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i].length()) feitoConfirmado[i] = true;
  if (r["cfg"]["pulso_ms"].is<int>()) pulsoMs = constrain(r["cfg"]["pulso_ms"].as<int>(), 20, 300);
  if (r["cfg"]["intervalo_ms"].is<int>()) intervaloMs = constrain(r["cfg"]["intervalo_ms"].as<int>(), 20, 500);
  for (JsonObject cr : r["creditos"].as<JsonArray>()) {
    String id = cr["id"].as<String>(); int pulsos = cr["pulsos"].as<int>(); String s = cr["s"].as<String>();
    if (!id.length() || pulsos < 1 || pulsos > 50) continue;
    if (s != hmacHex(id + "." + String(pulsos)).substring(0, 32)) continue;   // assinatura do servidor inválida: ignora
    if (!jaFeito(id)) { darCredito(pulsos); marcarFeito(id); }
    else for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) feitoConfirmado[i] = false;   // reenvia a confirmação
  }
  digitalWrite(PINO_LED, HIGH); delay(30); digitalWrite(PINO_LED, LOW);
  montarPacote();   // já deixa pronto o próximo pacote (confirma os créditos executados)
}

class Servidor : public BLEServerCallbacks {
  void onConnect(BLEServer*) { conectado = true; }
  void onDisconnect(BLEServer* s) { conectado = false; s->getAdvertising()->start(); }
};
class Escrita : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) { respostaPendente = String(c->getValue().c_str()); temResposta = true; }
};

void lerSerial() {   // gravação na bancada: "CFG MVP-0001 <segredo>"
  if (!Serial.available()) return;
  String l = Serial.readStringUntil('\n'); l.trim();
  if (!l.startsWith("CFG ")) return;
  int sp = l.indexOf(' ', 4); if (sp < 0) return;
  String id = l.substring(4, sp), seg = l.substring(sp + 1);
  if (id.length() > 15 || seg.length() < 32 || seg.length() > 64) { Serial.println("ERRO formato"); return; }
  mem.putString("id", id); mem.putString("seg", seg);
  Serial.println("OK gravado. Reiniciando..."); delay(300); ESP.restart();
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_CREDITO, OUTPUT); digitalWrite(PINO_CREDITO, LOW); pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_MOEDA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_MOEDA), aoPulsoMoeda, RISING);  // entrada por transistor: moeda = GPIO sobe
  mem.begin("placamv", false);
  loteAtual = mem.getUInt("lote", 0); proxFeito = mem.getInt("prox", 0);
  for (int i = 0; i < MAX_FEITOS; i++) { feitos[i] = mem.getString(("f" + String(i)).c_str(), ""); feitoConfirmado[i] = false; }
  mem.getString("id", "").toCharArray(PLACA_ID, sizeof(PLACA_ID));
  mem.getString("seg", "").toCharArray(PLACA_SEGREDO, sizeof(PLACA_SEGREDO));

  BLEDevice::init(strlen(PLACA_ID) ? PLACA_ID : "MVP-SEM-CONFIG");
  BLEDevice::setMTU(517);
  BLEServer* srv = BLEDevice::createServer(); srv->setCallbacks(new Servidor());
  BLEService* sv = srv->createService(SERVICO_UUID);
  chPacote = sv->createCharacteristic(PACOTE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  chPacote->addDescriptor(new BLE2902());
  chResposta = sv->createCharacteristic(RESPOSTA_UUID, BLECharacteristic::PROPERTY_WRITE);
  chResposta->setCallbacks(new Escrita());
  chInfo = sv->createCharacteristic(INFO_UUID, BLECharacteristic::PROPERTY_READ);
  String info = String("{\"id\":\"") + PLACA_ID + "\",\"fw\":\"" + FIRMWARE + "\"}";
  chInfo->setValue(info.c_str());
  sv->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising(); adv->addServiceUUID(SERVICO_UUID); adv->start();
  montarPacote();
}

uint32_t ultimoPacote = 0;
void loop() {
  lerSerial();
  if (temResposta) { temResposta = false; tratarResposta(respostaPendente); }
  if (millis() - ultimoPacote >= PACOTE_MS) { ultimoPacote = millis(); montarPacote(); }
  delay(10);
}
