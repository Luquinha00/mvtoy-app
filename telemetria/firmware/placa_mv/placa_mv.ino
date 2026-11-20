/*
  Placa MV — telemetria própria MV Toy (piloto) · v0.1 · 20/11/2026
  Placa: ESP32 (DevKit). Arduino IDE com "esp32 by Espressif" 2.x ou 3.x.

  O que faz:
   1) Conta os pulsos do moedeiro/noteiro (dinheiro que entrou).
   2) Recebe do servidor os créditos pagos (Pix/cartão/remoto) e manda o pulso
      para a placa da máquina, como se fosse uma moeda.
   3) Avisa o servidor a cada ~5 s que está online.

  LIGAÇÃO: ver telemetria/MONTAGEM.md (mapa para o montador).
   - ENTRADA: SINAL → resistor 47k → base do transistor BC547; resistor 100k entre base e GND; emissor → GND;
              coletor → GPIO 27 + resistor 10k ao 3V3.  (Parado: GPIO 27 = 0. Moeda puxa o SINAL a 0 V → GPIO 27 sobe.)
              Funciona com sinal de 5, 12 ou 24 V sem ajuste.
   - SAÍDA:   GPIO 26 → resistor 330 → pino 1 do PC817; pino 2 → GND;
              pino 4 (coletor) → fio SINAL; pino 3 (emissor) → GND.  (GPIO 26 em 1 → SINAL vai a 0 V = "uma moeda".)
   - Alimentação: 12 V da máquina → conversor step-down ajustado em 5,0 V → pino VIN do ESP32; GND comum.
   - Enquanto a placa solta crédito, ela ignora a entrada (o próprio pulso não vira "moeda").

  CONFIGURAÇÃO SEM REGRAVAR (v0.2):
   - O mesmo programa serve para todas as placas. Na primeira vez (ou segurando o botão BOOT por 5 s ao ligar),
     a placa abre a rede Wi-Fi "PLACA-MV-xxxx". Conecte o celular, abre a página de configuração:
     escolha o Wi-Fi do ponto e cole PLACA_ID e PLACA_SEGREDO (gerados no app › Placas › Placa nova).
   - Tudo fica guardado na memória da placa. Nenhum segredo neste arquivo.
   Biblioteca extra: "WiFiManager" (tzapu) 2.x.
*/
#include <WiFi.h>
#include <WiFiManager.h>  // tzapu 2.x
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>      // Biblioteca "ArduinoJson" (Benoit Blanchon) 7.x
#include "mbedtls/md.h"

// ---------- CONFIGURAÇÃO ----------
char PLACA_ID[16]      = "";
char PLACA_SEGREDO[65] = "";
const char* URL_SYNC      = "https://koxormltidkmdwxgqbsm.supabase.co/functions/v1/tel-sync";
const char* FIRMWARE      = "0.2";
const int PINO_BOOT = 0;       // botão BOOT do ESP32: segurar 5 s ao ligar = reconfigurar

const int PINO_MOEDA   = 27;   // entrada (via PC817)
const int PINO_CREDITO = 26;   // saída   (via PC817)
const int PINO_LED     = 2;    // LED azul da placa: pisca = online
const uint32_t SYNC_MS = 5000;
const uint32_t DEBOUNCE_US = 15000; // ignora repiques < 15 ms

// ---------- ESTADO ----------
volatile uint32_t moedasPendentes = 0;
volatile uint32_t ultimoPulsoUs = 0;
volatile bool emitindo = false;   // enquanto a placa solta crédito, o próprio pulso não conta como moeda
uint32_t pulsoMs = 60, intervaloMs = 80;
uint32_t loteAtual = 0, moedasDoLote = 0;
long deltaRelogio = 0;          // diferença entre o relógio do servidor e o millis()
bool primeiroEnvio = true;
Preferences mem;

// créditos já executados (para não repetir se a resposta se perder)
const int MAX_FEITOS = 20;
String feitos[MAX_FEITOS];
bool feitoConfirmado[MAX_FEITOS];
int proxFeito = 0;

void IRAM_ATTR aoPulsoMoeda() {
  if (emitindo) return;
  uint32_t agora = micros();
  if (agora - ultimoPulsoUs > DEBOUNCE_US) { moedasPendentes++; ultimoPulsoUs = agora; }
}

bool jaFeito(const String& id) {
  for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) return true;
  return false;
}
void marcarFeito(const String& id) {
  feitos[proxFeito] = id; feitoConfirmado[proxFeito] = false;
  proxFeito = (proxFeito + 1) % MAX_FEITOS;
  // guarda na memória para sobreviver a uma queda de energia
  for (int i = 0; i < MAX_FEITOS; i++) mem.putString(("f" + String(i)).c_str(), feitos[i]);
  mem.putInt("prox", proxFeito);
}

void darCredito(int pulsos) {
  emitindo = true;
  for (int i = 0; i < pulsos; i++) {
    digitalWrite(PINO_CREDITO, HIGH);   // PC817 conduz: sinal da máquina vai ao GND
    delay(pulsoMs);
    digitalWrite(PINO_CREDITO, LOW);
    delay(intervaloMs);
  }
  delay(30); emitindo = false;
}

String hmacHex(const String& msg) {
  byte saida[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)PLACA_SEGREDO, strlen(PLACA_SEGREDO));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, saida);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", saida[i]);
  hex[64] = 0;
  return String(hex);
}

void portalConfig(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);          // 5 min com o portal aberto; depois segue tentando
  WiFiManagerParameter pId("placa", "PLACA_ID (ex.: MVP-0001)", PLACA_ID, 15);
  WiFiManagerParameter pSeg("seg", "PLACA_SEGREDO", PLACA_SEGREDO, 64);
  wm.addParameter(&pId); wm.addParameter(&pSeg);
  String rede = "PLACA-MV-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX);
  bool ok = forcar ? wm.startConfigPortal(rede.c_str()) : wm.autoConnect(rede.c_str());
  if (strlen(pId.getValue()) > 0) { strncpy(PLACA_ID, pId.getValue(), 15); mem.putString("id", PLACA_ID); }
  if (strlen(pSeg.getValue()) > 0) { strncpy(PLACA_SEGREDO, pSeg.getValue(), 64); mem.putString("seg", PLACA_SEGREDO); }
  (void)ok;
}

void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin();                             // usa o Wi-Fi guardado pelo portal
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(250); digitalWrite(PINO_LED, !digitalRead(PINO_LED)); }
}

void sincronizar() {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED || strlen(PLACA_ID) == 0 || strlen(PLACA_SEGREDO) == 0) return;

  // fecha um lote de moedas novo só quando o anterior foi aceito
  if (moedasDoLote == 0) {
    noInterrupts(); moedasDoLote = moedasPendentes; moedasPendentes = 0; interrupts();
    if (moedasDoLote > 0) { loteAtual++; mem.putUInt("lote", loteAtual); }
  }

  JsonDocument env;
  env["fw"] = FIRMWARE;
  env["rssi"] = WiFi.RSSI();
  env["lote"] = loteAtual;
  env["moedas"] = moedasDoLote;
  if (primeiroEnvio) env["boot"] = true;
  JsonArray arr = env["feitos"].to<JsonArray>();
  for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i].length() && !feitoConfirmado[i]) arr.add(feitos[i]);
  String corpo; serializeJson(env, corpo);

  long ts = (long)(millis() / 1000) + deltaRelogio;
  WiFiClientSecure cli; cli.setInsecure();   // piloto. Produção: fixar o certificado (setCACert)
  HTTPClient http;
  http.begin(cli, URL_SYNC);
  http.setTimeout(8000);
  http.addHeader("content-type", "application/json");
  http.addHeader("x-placa", PLACA_ID);
  http.addHeader("x-ts", String(ts));
  http.addHeader("x-sig", hmacHex(String(ts) + "." + corpo));
  int code = http.POST(corpo);
  String resp = http.getString();
  http.end();

  JsonDocument r;
  if (deserializeJson(r, resp)) return;
  if (r["agora"].is<long>()) deltaRelogio = r["agora"].as<long>() - (long)(millis() / 1000);
  if (code != 200) return;   // relógio acertado acima; tenta de novo no próximo ciclo

  // servidor aceitou: lote de moedas e créditos informados estão confirmados
  moedasDoLote = 0;
  primeiroEnvio = false;
  for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i].length()) feitoConfirmado[i] = true;
  if (r["cfg"]["pulso_ms"].is<int>()) pulsoMs = constrain(r["cfg"]["pulso_ms"].as<int>(), 20, 300);
  if (r["cfg"]["intervalo_ms"].is<int>()) intervaloMs = constrain(r["cfg"]["intervalo_ms"].as<int>(), 20, 500);

  for (JsonObject c : r["creditos"].as<JsonArray>()) {
    String id = c["id"].as<String>();
    int pulsos = constrain(c["pulsos"].as<int>(), 0, 50);
    if (id.length() == 0 || pulsos == 0) continue;
    if (!jaFeito(id)) { darCredito(pulsos); marcarFeito(id); }
    else {   // já executado: só reenvia a confirmação
      for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) feitoConfirmado[i] = false;
    }
  }
  digitalWrite(PINO_LED, HIGH); delay(30); digitalWrite(PINO_LED, LOW);
}

void setup() {
  pinMode(PINO_CREDITO, OUTPUT); digitalWrite(PINO_CREDITO, LOW);
  pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_MOEDA, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PINO_MOEDA), aoPulsoMoeda, RISING);  // entrada por transistor: moeda = GPIO sobe
  mem.begin("placamv", false);
  loteAtual = mem.getUInt("lote", 0);
  proxFeito = mem.getInt("prox", 0);
  for (int i = 0; i < MAX_FEITOS; i++) { feitos[i] = mem.getString(("f" + String(i)).c_str(), ""); feitoConfirmado[i] = false; }
  mem.getString("id", "").toCharArray(PLACA_ID, sizeof(PLACA_ID));
  mem.getString("seg", "").toCharArray(PLACA_SEGREDO, sizeof(PLACA_SEGREDO));
  pinMode(PINO_BOOT, INPUT_PULLUP);
  uint32_t t0 = millis(); bool segurou = true;
  while (millis() - t0 < 5000) { if (digitalRead(PINO_BOOT) == HIGH) { segurou = false; break; } delay(50); }
  bool semConfig = strlen(PLACA_ID) == 0 || strlen(PLACA_SEGREDO) == 0;
  portalConfig(segurou || semConfig);
}

uint32_t ultimoSync = 0;
void loop() {
  if (millis() - ultimoSync >= SYNC_MS) { ultimoSync = millis(); sincronizar(); }
  delay(10);
}
