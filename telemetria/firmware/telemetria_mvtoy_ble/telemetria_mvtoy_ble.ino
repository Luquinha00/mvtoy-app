/*
  Telemetria MV Toy · placa Bluetooth · v0.5 · 23/11/2026 (protocolo 2 · moedas, notas e prêmios)
  Arquitetura v2 (regra do Lucas): a MAQUININHA é a central. A placa não tem Wi-Fi, botão nem configuração:
  ela só encaixa no chicote do moedeiro e conversa por Bluetooth (BLE) com o app MV Toy na maquininha.
  A maquininha leva os pacotes da placa até o servidor (Wi-Fi do ponto ou 4G dela) e traz as respostas.

  Segurança (protocolo 2):
   - a placa assina o que manda (HMAC-SHA256 com o segredo dela);
   - o servidor assina a CONFIRMAÇÃO ("a") e cada CRÉDITO ("s", com a hora do servidor). A placa só zera as moedas
     enviadas e só solta crédito com assinatura válida. Ninguém no meio (maquininha, celular por perto) consegue
     inventar crédito, repetir resposta antiga nem apagar moedas da telemetria.

  Economia de servidor (rede inteira): a placa só AVISA a maquininha quando tem moeda (agrupa 20 s), confirmação de
  crédito ou a cada "envio_s" (padrão 300 s, o servidor pode mudar). O pacote é renovado a cada 60 s para a
  maquininha poder ler na hora (ex.: logo depois de uma venda Pix/cartão).

  Gravação (uma vez, na bancada): Arduino IDE, placa "ESP32 Dev Module", biblioteca ArduinoJson 7.
  Número e segredo gravados pela porta USB:   CFG TMV-0001 <segredo>   (app › Placas › Placa nova)
  Ficam na memória. Nenhum segredo neste arquivo.

  Ligação: telemetria/MONTAGEM.md (entrada GPIO 27 via BC547 e saída GPIO 26 via BC337; 12 V → 1N5819 → step-down 5 V → VIN).
  Encaixe em paralelo no chicote: se a placa falhar, a moeda continua funcionando.

  BLE — serviço MV (UUIDs fixos, o app da maquininha procura por eles):
   - PACOTE  (leitura + aviso): {"ts":..,"corpo":"<json>","sig":"<hex>"} → a maquininha envia ao tel-sync
       com os cabeçalhos x-placa / x-ts / x-sig e o corpo.
   - RESPOSTA (escrita): a resposta do tel-sync, sem mudar nada → a placa confere e solta os créditos.
   - INFO    (leitura): {"id":"TMV-0001","fw":"0.4","p":2} (o app confere com o QR antes de ligar).
  Nome Bluetooth: o número da placa (ex.: TMV-0001).
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

const char* FIRMWARE = "0.5";
const int PINO_MOEDA = 27, PINO_NOTA = 25, PINO_PREMIO = 33, PINO_CREDITO = 26, PINO_LED = 2;
const uint32_t DEBOUNCE_US = 15000;
const uint32_t AGRUPA_MS = 20000;      // junta as moedas de 20 s num envio só
const uint32_t RENOVA_MS = 60000;      // pacote sempre "fresco" para leitura da maquininha
const uint32_t SEM_RESPOSTA_MS = 90000; // conexão Bluetooth sem resposta válida por 90 s é derrubada (ninguém "prende" a placa)

char PLACA_ID[16] = "";
char PLACA_SEGREDO[65] = "";
Preferences mem;

volatile uint32_t moedasPendentes = 0, ultimoPulsoUs = 0, notasPendentes = 0, ultimaNotaUs = 0, premiosPendentes = 0, ultimoPremioUs = 0;
volatile bool emitindo = false;   // enquanto a placa solta crédito, o próprio pulso não conta como moeda
uint32_t pulsoMs = 60, intervaloMs = 80, envioS = 300, loteAtual = 0, moedasDoLote = 0, notasDoLote = 0, premiosDoLote = 0, pendSalvo = 0;
long deltaRelogio = 0, ultAgoraCredito = 0;
bool primeiroEnvio = true, conectado = false;
uint32_t conectouEm = 0, ultimaRespValida = 0, ultimoAviso = 0, ultimoMontado = 0, ultimoSalvaPend = 0;

const int MAX_FEITOS = 20;
String feitos[MAX_FEITOS]; bool feitoConfirmado[MAX_FEITOS], feitoNoPacote[MAX_FEITOS]; int proxFeito = 0;

BLEServer* srv;
BLECharacteristic *chPacote, *chResposta, *chInfo;
String respostaPendente; volatile bool temResposta = false;

void IRAM_ATTR aoPulsoMoeda() { if (emitindo) return; uint32_t a = micros(); if (a - ultimoPulsoUs > DEBOUNCE_US) { moedasPendentes++; ultimoPulsoUs = a; } }
void IRAM_ATTR aoPulsoNota() { uint32_t a = micros(); if (a - ultimaNotaUs > DEBOUNCE_US) { notasPendentes++; ultimaNotaUs = a; } }       // COINB: noteiro / 2º moedeiro
void IRAM_ATTR aoPulsoPremio() { uint32_t a = micros(); if (a - ultimoPremioUs > 50000) { premiosPendentes++; ultimoPremioUs = a; } }  // sensor de saída de prêmio (debounce 50 ms)

String hmacHex(const String& msg) {
  byte out[32]; mbedtls_md_context_t ctx; mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)PLACA_SEGREDO, strlen(PLACA_SEGREDO));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out); mbedtls_md_free(&ctx);
  char hex[65]; for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]); hex[64] = 0; return String(hex);
}

// moedas guardadas na memória: queda de energia (shopping fechando) não apaga moedas ainda não enviadas
void salvarMoedas() {
  uint32_t p = moedasPendentes, n = notasPendentes, q = premiosPendentes;
  mem.putUInt("pend", p); mem.putUInt("mlote", moedasDoLote);
  mem.putUInt("npend", n); mem.putUInt("nlote", notasDoLote);
  mem.putUInt("ppend", q); mem.putUInt("plote", premiosDoLote);
  pendSalvo = p + n + q;
}

bool jaFeito(const String& id) { for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) return true; return false; }
bool temFeitoPendente() { for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i].length() && !feitoConfirmado[i]) return true; return false; }
void marcarFeito(const String& id) {
  feitos[proxFeito] = id; feitoConfirmado[proxFeito] = false; feitoNoPacote[proxFeito] = false;
  mem.putString(("f" + String(proxFeito)).c_str(), id);
  proxFeito = (proxFeito + 1) % MAX_FEITOS; mem.putInt("prox", proxFeito);
}
void darCredito(int pulsos) {
  emitindo = true;
  for (int i = 0; i < pulsos; i++) { digitalWrite(PINO_CREDITO, HIGH); delay(pulsoMs); digitalWrite(PINO_CREDITO, LOW); delay(intervaloMs); }
  delay(30); emitindo = false;
}

// monta o pacote assinado que a maquininha vai levar ao servidor; avisar = notifica a maquininha
void montarPacote(bool avisar) {
  if (!strlen(PLACA_ID) || !strlen(PLACA_SEGREDO)) return;
  if (moedasDoLote == 0 && notasDoLote == 0 && premiosDoLote == 0) {
    noInterrupts();
    moedasDoLote = moedasPendentes; moedasPendentes = 0;
    notasDoLote = notasPendentes; notasPendentes = 0;
    premiosDoLote = premiosPendentes; premiosPendentes = 0;
    interrupts();
    if (moedasDoLote + notasDoLote + premiosDoLote > 0) { loteAtual++; mem.putUInt("lote", loteAtual); salvarMoedas(); }
  }
  JsonDocument c;
  c["p"] = 2; c["via"] = "ble"; c["fw"] = FIRMWARE; c["lote"] = loteAtual; c["moedas"] = moedasDoLote; c["notas"] = notasDoLote; c["premios"] = premiosDoLote; c["rssi"] = 0;
  if (primeiroEnvio) c["boot"] = true;
  JsonArray arr = c["feitos"].to<JsonArray>(); int n = 0;
  for (int i = 0; i < MAX_FEITOS; i++) {
    feitoNoPacote[i] = feitos[i].length() && !feitoConfirmado[i] && n < 5;
    if (feitoNoPacote[i]) { arr.add(feitos[i]); n++; }
  }
  String corpo; serializeJson(c, corpo);
  long ts = (long)(millis() / 1000) + deltaRelogio;
  JsonDocument p; p["ts"] = ts; p["corpo"] = corpo; p["sig"] = hmacHex(String(ts) + "." + corpo);
  String saida; serializeJson(p, saida);
  chPacote->setValue(saida.c_str());
  ultimoMontado = millis();
  if (avisar) { ultimoAviso = millis(); if (conectado) chPacote->notify(); }
}

// a maquininha devolveu a resposta do servidor
void tratarResposta(const String& txt) {
  JsonDocument r; if (deserializeJson(r, txt)) return;
  if (!r["ok"].as<bool>()) {   // erro (ex.: relógio): acerta o relógio e refaz o pacote na hora (não mexe em moedas)
    if (r["agora"].is<long>()) deltaRelogio = r["agora"].as<long>() - (long)(millis() / 1000);
    montarPacote(true); return;
  }
  long agora = r["agora"].as<long>();
  // confirmação assinada pelo servidor: só ela zera as moedas enviadas
  String a = r["a"].as<String>();
  bool confirmado = a == hmacHex("ok." + String(agora) + "." + String(loteAtual)).substring(0, 32);
  if (confirmado) {   // (resposta falsa ou de um lote anterior não zera nada; créditos têm assinatura própria abaixo)
    ultimaRespValida = millis();
    deltaRelogio = agora - (long)(millis() / 1000);
    moedasDoLote = 0; notasDoLote = 0; premiosDoLote = 0; primeiroEnvio = false; salvarMoedas();
    for (int i = 0; i < MAX_FEITOS; i++) if (feitoNoPacote[i]) { feitoConfirmado[i] = true; feitoNoPacote[i] = false; }
    if (r["cfg"]["pulso_ms"].is<int>()) pulsoMs = constrain(r["cfg"]["pulso_ms"].as<int>(), 20, 300);
    if (r["cfg"]["intervalo_ms"].is<int>()) intervaloMs = constrain(r["cfg"]["intervalo_ms"].as<int>(), 20, 500);
    if (r["cfg"]["envio_s"].is<int>()) envioS = constrain(r["cfg"]["envio_s"].as<int>(), 10, 3600);
  }
  bool deuCredito = false;
  for (JsonObject cr : r["creditos"].as<JsonArray>()) {
    String id = cr["id"].as<String>(); int pulsos = cr["pulsos"].as<int>(); String s = cr["s"].as<String>();
    if (!id.length() || pulsos < 1 || pulsos > 50) continue;
    if (s != hmacHex(id + "." + String(pulsos) + "." + String(agora)).substring(0, 32)) continue;   // assinatura inválida: ignora
    if (agora < ultAgoraCredito) continue;                         // resposta antiga reenviada: ignora
    ultimaRespValida = millis();
    if (!jaFeito(id)) { darCredito(pulsos); marcarFeito(id); deuCredito = true; }
    else for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) feitoConfirmado[i] = false;   // reenvia a confirmação
    if (agora > ultAgoraCredito) { ultAgoraCredito = agora; mem.putUInt("uagora", (uint32_t)agora); }
  }
  digitalWrite(PINO_LED, HIGH); delay(30); digitalWrite(PINO_LED, LOW);
  montarPacote(deuCredito || temFeitoPendente());   // confirma na hora os créditos executados
}

class Servidor : public BLEServerCallbacks {
  void onConnect(BLEServer*) { conectado = true; conectouEm = millis(); }
  void onDisconnect(BLEServer* s) { conectado = false; s->getAdvertising()->start(); }
};
class Escrita : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) { respostaPendente = String(c->getValue().c_str()); temResposta = true; }
};

void lerSerial() {   // gravação na bancada: "CFG TMV-0001 <segredo>"
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
  pinMode(PINO_MOEDA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_MOEDA), aoPulsoMoeda, RISING);
  pinMode(PINO_NOTA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_NOTA), aoPulsoNota, RISING);
  pinMode(PINO_PREMIO, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_PREMIO), aoPulsoPremio, RISING);  // entrada sem fio = nunca dispara (pull-up)  // entrada por transistor: moeda = GPIO sobe
  mem.begin("telmv", false);
  loteAtual = mem.getUInt("lote", 0); proxFeito = mem.getInt("prox", 0);
  moedasDoLote = mem.getUInt("mlote", 0); moedasPendentes = mem.getUInt("pend", 0);
  notasDoLote = mem.getUInt("nlote", 0); notasPendentes = mem.getUInt("npend", 0);
  premiosDoLote = mem.getUInt("plote", 0); premiosPendentes = mem.getUInt("ppend", 0);
  pendSalvo = moedasPendentes + notasPendentes + premiosPendentes;
  ultAgoraCredito = (long)mem.getUInt("uagora", 0);
  for (int i = 0; i < MAX_FEITOS; i++) { feitos[i] = mem.getString(("f" + String(i)).c_str(), ""); feitoConfirmado[i] = false; feitoNoPacote[i] = false; }
  mem.getString("id", "").toCharArray(PLACA_ID, sizeof(PLACA_ID));
  mem.getString("seg", "").toCharArray(PLACA_SEGREDO, sizeof(PLACA_SEGREDO));

  BLEDevice::init(strlen(PLACA_ID) ? PLACA_ID : "TMV-SEM-CONFIG");
  BLEDevice::setMTU(517);
  srv = BLEDevice::createServer(); srv->setCallbacks(new Servidor());
  BLEService* sv = srv->createService(SERVICO_UUID);
  chPacote = sv->createCharacteristic(PACOTE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  chPacote->addDescriptor(new BLE2902());
  chResposta = sv->createCharacteristic(RESPOSTA_UUID, BLECharacteristic::PROPERTY_WRITE);
  chResposta->setCallbacks(new Escrita());
  chInfo = sv->createCharacteristic(INFO_UUID, BLECharacteristic::PROPERTY_READ);
  String info = String("{\"id\":\"") + PLACA_ID + "\",\"fw\":\"" + FIRMWARE + "\",\"p\":2}";
  chInfo->setValue(info.c_str());
  sv->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising(); adv->addServiceUUID(SERVICO_UUID); adv->start();
  montarPacote(true);
}

void loop() {
  lerSerial();
  if (temResposta) { temResposta = false; tratarResposta(respostaPendente); }
  uint32_t agoraMs = millis();
  // guarda moedas novas na memória (no máximo 1 gravação por segundo)
  if (moedasPendentes + notasPendentes + premiosPendentes != pendSalvo && agoraMs - ultimoSalvaPend >= 1000) { ultimoSalvaPend = agoraMs; salvarMoedas(); }
  bool temDados = moedasDoLote + notasDoLote + premiosDoLote > 0 || moedasPendentes + notasPendentes + premiosPendentes > 0 || temFeitoPendente();
  if (temDados && agoraMs - ultimoAviso >= AGRUPA_MS) montarPacote(true);
  else if (agoraMs - ultimoAviso >= envioS * 1000UL) montarPacote(true);        // "estou viva"
  else if (agoraMs - ultimoMontado >= RENOVA_MS) montarPacote(false);
  // ninguém segura a conexão Bluetooth sem trazer resposta válida do servidor
  // (a maquininha de verdade devolve a 1ª resposta em segundos; quem conecta e não traz resposta assinada sai em 90 s)
  if (conectado && agoraMs - conectouEm > SEM_RESPOSTA_MS && (int32_t)(ultimaRespValida - conectouEm) < 0) {
    srv->disconnect(srv->getConnId()); conectado = false;
  }
  delay(10);
}
