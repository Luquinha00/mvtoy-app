/*
  Telemetria MV Toy · placa Wi-Fi (SÓ PILOTO / plano B) · v0.4 · 23/11/2026 (protocolo 2 · moedas, notas e prêmios)
  A versão de rede é a Bluetooth (maquininha como central). Esta versão serve para testar a placa sozinha,
  ligada direto no Wi-Fi do ponto, antes do app da maquininha ficar pronto.

  O que faz:
   1) Conta os pulsos do moedeiro/noteiro (dinheiro que entrou) e guarda na memória até o servidor confirmar.
   2) Recebe do servidor os créditos pagos (Pix/cartão/remoto) e solta o pulso na máquina, como uma moeda.
   3) Fala com o servidor só quando precisa: moedas (agrupa 10 s), confirmação de crédito, ou a cada "envio_s"
      (o servidor manda; piloto = 20 s, para o crédito Pix chegar rápido).

  Segurança (protocolo 2): a placa assina o que manda; o servidor assina a confirmação ("a") e cada crédito ("s").
  Mesmo que alguém na rede do ponto finja ser o servidor, a placa não solta crédito nem apaga moedas.

  LIGAÇÃO: telemetria/MONTAGEM.md.
   - ENTRADA: SINAL → 47k → base BC547; 100k base→GND; emissor GND; coletor → GPIO 27 + 10k ao 3V3 (moeda = GPIO sobe).
   - SAÍDA:   GPIO 26 → 1k → base BC337; emissor GND; coletor → SINAL (GPIO 26 em 1 = "uma moeda").
   - Alimentação: 12 V → diodo 1N5819 → step-down ajustado em 5,0 V → VIN; GND comum.

  CONFIGURAÇÃO (piloto): na primeira vez a placa abre a rede "TELEMETRIA-MV-xxxx"; pelo celular escolha o Wi-Fi do ponto
  e cole o número (TMV-0001) e a chave (app › Placas › Placa nova). Para reconfigurar: segurar BOOT 5 s ao ligar.
  Bibliotecas: ArduinoJson 7, WiFiManager (tzapu) 2.x. Nenhum segredo neste arquivo.
*/
#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

char PLACA_ID[16]      = "";
char PLACA_SEGREDO[65] = "";
const char* URL_SYNC   = "https://koxormltidkmdwxgqbsm.supabase.co/functions/v1/tel-sync";
const char* FIRMWARE   = "0.4";
const int PINO_BOOT = 0, PINO_MOEDA = 27, PINO_NOTA = 25, PINO_PREMIO = 33, PINO_CREDITO = 26, PINO_LED = 2;
const uint32_t DEBOUNCE_US = 15000;
const uint32_t AGRUPA_MS = 10000;

volatile uint32_t moedasPendentes = 0, ultimoPulsoUs = 0, notasPendentes = 0, ultimaNotaUs = 0, premiosPendentes = 0, ultimoPremioUs = 0;
volatile bool emitindo = false;
uint32_t pulsoMs = 60, intervaloMs = 80, envioS = 20, loteAtual = 0, moedasDoLote = 0, notasDoLote = 0, premiosDoLote = 0, pendSalvo = 0;
long deltaRelogio = 0, ultAgoraCredito = 0;
bool primeiroEnvio = true;
uint32_t ultimoSync = 0, ultimoSalvaPend = 0;
Preferences mem;

const int MAX_FEITOS = 20;
String feitos[MAX_FEITOS]; bool feitoConfirmado[MAX_FEITOS], feitoNoPacote[MAX_FEITOS]; int proxFeito = 0;

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

void portalConfig(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  WiFiManagerParameter pId("placa", "Número da placa (ex.: TMV-0001)", PLACA_ID, 15);
  WiFiManagerParameter pSeg("seg", "Chave da placa", PLACA_SEGREDO, 64);
  wm.addParameter(&pId); wm.addParameter(&pSeg);
  String rede = "TELEMETRIA-MV-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX);
  bool ok = forcar ? wm.startConfigPortal(rede.c_str()) : wm.autoConnect(rede.c_str());
  if (strlen(pId.getValue()) > 0) { strncpy(PLACA_ID, pId.getValue(), 15); mem.putString("id", PLACA_ID); }
  if (strlen(pSeg.getValue()) > 0) { strncpy(PLACA_SEGREDO, pSeg.getValue(), 64); mem.putString("seg", PLACA_SEGREDO); }
  (void)ok;
}
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA); WiFi.begin();
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(250); digitalWrite(PINO_LED, !digitalRead(PINO_LED)); }
}

void sincronizar() {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED || !strlen(PLACA_ID) || !strlen(PLACA_SEGREDO)) return;
  if (moedasDoLote == 0 && notasDoLote == 0 && premiosDoLote == 0) {
    noInterrupts();
    moedasDoLote = moedasPendentes; moedasPendentes = 0;
    notasDoLote = notasPendentes; notasPendentes = 0;
    premiosDoLote = premiosPendentes; premiosPendentes = 0;
    interrupts();
    if (moedasDoLote + notasDoLote + premiosDoLote > 0) { loteAtual++; mem.putUInt("lote", loteAtual); salvarMoedas(); }
  }
  JsonDocument env;
  env["p"] = 2; env["via"] = "wifi"; env["fw"] = FIRMWARE; env["rssi"] = WiFi.RSSI(); env["lote"] = loteAtual; env["moedas"] = moedasDoLote; env["notas"] = notasDoLote; env["premios"] = premiosDoLote;
  if (primeiroEnvio) env["boot"] = true;
  JsonArray arr = env["feitos"].to<JsonArray>(); int n = 0;
  for (int i = 0; i < MAX_FEITOS; i++) { feitoNoPacote[i] = feitos[i].length() && !feitoConfirmado[i] && n < 10; if (feitoNoPacote[i]) { arr.add(feitos[i]); n++; } }
  String corpo; serializeJson(env, corpo);

  long ts = (long)(millis() / 1000) + deltaRelogio;
  WiFiClientSecure cli; cli.setInsecure();   // a segurança está nas assinaturas (protocolo 2), não no certificado
  HTTPClient http;
  http.begin(cli, URL_SYNC); http.setTimeout(8000);
  http.addHeader("content-type", "application/json");
  http.addHeader("x-placa", PLACA_ID);
  http.addHeader("x-ts", String(ts));
  http.addHeader("x-sig", hmacHex(String(ts) + "." + corpo));
  int code = http.POST(corpo);
  String resp = http.getString();
  http.end();

  JsonDocument r;
  if (deserializeJson(r, resp)) return;
  if (code != 200 || !r["ok"].as<bool>()) {   // relógio errado: acerta e tenta já no próximo ciclo curto
    if (r["agora"].is<long>()) { deltaRelogio = r["agora"].as<long>() - (long)(millis() / 1000); ultimoSync = 0; }
    return;
  }
  long agora = r["agora"].as<long>();
  if (r["a"].as<String>() == hmacHex("ok." + String(agora) + "." + String(loteAtual)).substring(0, 32)) {
    deltaRelogio = agora - (long)(millis() / 1000);
    moedasDoLote = 0; notasDoLote = 0; premiosDoLote = 0; primeiroEnvio = false; salvarMoedas();
    for (int i = 0; i < MAX_FEITOS; i++) if (feitoNoPacote[i]) { feitoConfirmado[i] = true; feitoNoPacote[i] = false; }
    if (r["cfg"]["pulso_ms"].is<int>()) pulsoMs = constrain(r["cfg"]["pulso_ms"].as<int>(), 20, 300);
    if (r["cfg"]["intervalo_ms"].is<int>()) intervaloMs = constrain(r["cfg"]["intervalo_ms"].as<int>(), 20, 500);
    if (r["cfg"]["envio_s"].is<int>()) envioS = constrain(r["cfg"]["envio_s"].as<int>(), 10, 3600);
  }
  for (JsonObject c : r["creditos"].as<JsonArray>()) {
    String id = c["id"].as<String>(); int pulsos = c["pulsos"].as<int>(); String s = c["s"].as<String>();
    if (!id.length() || pulsos < 1 || pulsos > 50) continue;
    if (s != hmacHex(id + "." + String(pulsos) + "." + String(agora)).substring(0, 32)) continue;
    if (agora < ultAgoraCredito) continue;
    if (!jaFeito(id)) darCredito(pulsos), marcarFeito(id);
    else for (int i = 0; i < MAX_FEITOS; i++) if (feitos[i] == id) feitoConfirmado[i] = false;
    if (agora > ultAgoraCredito) { ultAgoraCredito = agora; mem.putUInt("uagora", (uint32_t)agora); }
  }
  digitalWrite(PINO_LED, HIGH); delay(30); digitalWrite(PINO_LED, LOW);
}

void setup() {
  pinMode(PINO_CREDITO, OUTPUT); digitalWrite(PINO_CREDITO, LOW); pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_MOEDA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_MOEDA), aoPulsoMoeda, RISING);
  pinMode(PINO_NOTA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_NOTA), aoPulsoNota, RISING);
  pinMode(PINO_PREMIO, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PINO_PREMIO), aoPulsoPremio, RISING);  // entrada sem fio = nunca dispara (pull-up)
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
  pinMode(PINO_BOOT, INPUT_PULLUP);
  uint32_t t0 = millis(); bool segurou = true;
  while (millis() - t0 < 5000) { if (digitalRead(PINO_BOOT) == HIGH) { segurou = false; break; } delay(50); }
  portalConfig(segurou || !strlen(PLACA_ID) || !strlen(PLACA_SEGREDO));
}

void loop() {
  uint32_t agoraMs = millis();
  if (moedasPendentes + notasPendentes + premiosPendentes != pendSalvo && agoraMs - ultimoSalvaPend >= 1000) { ultimoSalvaPend = agoraMs; salvarMoedas(); }
  bool temDados = moedasDoLote + notasDoLote + premiosDoLote > 0 || moedasPendentes + notasPendentes + premiosPendentes > 0 || temFeitoPendente();
  uint32_t espera = temDados ? AGRUPA_MS : envioS * 1000UL;
  if (ultimoSync == 0 || agoraMs - ultimoSync >= espera) { ultimoSync = agoraMs ? agoraMs : 1; sincronizar(); }
  delay(10);
}
