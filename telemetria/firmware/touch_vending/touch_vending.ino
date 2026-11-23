/*
  Touch Vending · Telemetria MV Toy para vending machines (MDB) · v0.1 · 23/11/2026 (protocolo 2)
  Linha irmã da Touch Pulse (máquinas de pulso). Placas TMD-0001…

  O que faz (MODO 1 · SÓ ESCUTA):
   - Fica em paralelo no chicote MDB (6 vias) e LÊ as duas linhas: o que a máquina (VMC) manda e o que os
     aparelhos respondem. NUNCA transmite no MDB: não atrapalha moedeiro, noteiro nem a maquininha.
   - Reconhece no leitor cashless (endereço 10h ou 60h):
       VEND REQUEST (13 00 preço item)  → guarda preço e seleção
       VEND SUCCESS (13 02 item)        → VENDA no cartão/Pix (preço guardado)
       CASH SALE    (13 05 preço item)  → VENDA em dinheiro (máquinas que avisam o leitor)
     e o SETUP do leitor (fator de escala e casas decimais) para converter o preço em reais.
   - Junta as vendas em lotes, assina (HMAC) e manda para o tel-sync, igual à Touch Pulse (Wi-Fi no piloto).

  [VALIDAR NA BANCADA] antes de instalar em ponto:
   1) A leitura do 9º bit (modo) com EspSoftwareSerial em SWSERIAL_8S1 + readParity().
   2) Se o optoacoplador inverte o sinal (INVERTE abaixo).
   3) Máquina sem leitor cashless: vendas só em moeda não aparecem nesta v0.1 (fica para a v0.2, via moedeiro).

  LIGAÇÃO (ver telemetria/mdb/ESPECIFICACAO.md):
   - MDB pino 5 (Master Transmit, sai da VMC)  → opto → GPIO 16
   - MDB pino 4 (Master Receive, entra na VMC) → opto → GPIO 17
   - MDB pino 6 (comum da comunicação) → lado do LED dos optos; MDB pino 2 (GND de força) só para a fonte
   - Alimentação: MDB pino 1 (+24/34 V) → fusível → step-down (entrada até 40 V) → 5,0 V → VIN do ESP32
  Gravação: "CFG TMD-0001 <chave>" no Monitor Serial (115200) ou pelo portal Wi-Fi "TOUCH-VENDING-xxxx".
  Bibliotecas: ArduinoJson 7, WiFiManager (tzapu) 2.x, EspSoftwareSerial (plerup) 8.x. Nenhum segredo neste arquivo.
*/
#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>
#include "mbedtls/md.h"

char PLACA_ID[16]      = "";
char PLACA_SEGREDO[65] = "";
const char* URL_SYNC   = "https://koxormltidkmdwxgqbsm.supabase.co/functions/v1/tel-sync";
const char* FIRMWARE   = "tv-0.1";
const int PINO_BOOT = 0, PINO_VMC = 16, PINO_PERIF = 17, PINO_LED = 2;
const bool INVERTE = false;              // [VALIDAR] true se o opto inverter o sinal
const uint32_t AGRUPA_MS = 10000;        // junta vendas por 10 s antes de mandar

SoftwareSerial sVmc, sPerif;
Preferences mem;

// ---------- vendas pendentes (guardadas na memória até o servidor confirmar) ----------
struct Venda { uint16_t item; uint32_t centavos; uint8_t meio; };   // meio: 1 cartão, 2 dinheiro
const int MAX_V = 60;
Venda fila[MAX_V]; int nFila = 0;          // ainda não entrou em lote
Venda lote[MAX_V]; int nLote = 0;          // lote em envio (repete até confirmar)
uint32_t loteAtual = 0, envioS = 60, ultimoSync = 0;
long deltaRelogio = 0;
bool primeiroEnvio = true;

// ---------- escala do leitor cashless (vem do SETUP; padrão Brasil: fator 1, 2 casas) ----------
uint8_t fatorEscala = 1, casas = 2;

void salvarFila() { mem.putBytes("fila", fila, sizeof(Venda) * nFila); mem.putInt("nfila", nFila);
                    mem.putBytes("lote", lote, sizeof(Venda) * nLote); mem.putInt("nlote", nLote); }
void novaVenda(uint16_t item, uint16_t precoMdb, uint8_t meio) {
  uint32_t c = (uint32_t)precoMdb * fatorEscala; for (int i = casas; i < 2; i++) c *= 10; for (int i = 2; i < casas; i++) c /= 10;
  if (nFila >= MAX_V) return;            // fila cheia (sem internet há muito tempo): não sobrescreve
  fila[nFila++] = { item, c, meio }; salvarFila();
  digitalWrite(PINO_LED, HIGH); delay(5); digitalWrite(PINO_LED, LOW);
}

// ---------- leitura do MDB (9 bits: 8 de dado + bit de modo) ----------
uint8_t bV[40]; int nV = 0;                // bloco que a VMC está mandando
uint8_t bP[40]; int nP = 0;                // resposta do aparelho
uint8_t ultEnd = 0, ultCmd = 0, ultSub = 0;
uint16_t precoPend[2] = {0, 0}, itemPend[2] = {0, 0};
uint32_t ultByteV = 0;

int idxCashless(uint8_t end) { return end == 0x10 ? 0 : end == 0x60 ? 1 : -1; }
bool chkOk(const uint8_t* b, int n) { uint8_t s = 0; for (int i = 0; i < n - 1; i++) s += b[i]; return n >= 2 && s == b[n - 1]; }

void processaComandoVmc() {
  if (nV < 2) { nV = 0; return; }
  uint8_t end = bV[0] & 0xF8, cmd = bV[0] & 0x07; int k = idxCashless(end);
  ultEnd = end; ultCmd = cmd; ultSub = nV > 1 ? bV[1] : 0;
  if (k >= 0 && cmd == 3) {                                       // VEND
    uint8_t sub = bV[1];
    if ((sub == 0x00 || sub == 0x05) && nV >= 7 && chkOk(bV, 7)) {
      uint16_t preco = (bV[2] << 8) | bV[3], item = (bV[4] << 8) | bV[5];
      if (sub == 0x00) { precoPend[k] = preco; itemPend[k] = item; }
      else novaVenda(item, preco, 2);                              // CASH SALE
    } else if (sub == 0x02 && nV >= 5 && chkOk(bV, 5)) {          // VEND SUCCESS
      uint16_t item = (bV[2] << 8) | bV[3];
      if (item == itemPend[k] || itemPend[k] == 0xFFFF) novaVenda(item, precoPend[k], 1);
      else novaVenda(item, precoPend[k], 1);                       // item diferente do pedido: vale o preço pedido [VALIDAR]
      precoPend[k] = 0; itemPend[k] = 0;
    } else if (sub == 0x01 || sub == 0x03) { precoPend[k] = 0; itemPend[k] = 0; }   // cancelou / falhou: não é venda
  }
  nV = 0;
}
void processaRespostaPerif() {
  // resposta ao SETUP config do leitor: 01 nível país(2) fator casas ...
  if (idxCashless(ultEnd) >= 0 && ultCmd == 1 && ultSub == 0x00 && nP >= 7 && bP[0] == 0x01 && chkOk(bP, nP)) {
    if (bP[4] >= 1) fatorEscala = bP[4]; if (bP[5] <= 4) casas = bP[5];
    mem.putUChar("fator", fatorEscala); mem.putUChar("casas", casas);
  }
  nP = 0;
}
void lerMdb() {
  while (sVmc.available()) {
    uint8_t c = sVmc.read(); bool modo = sVmc.readParity();
    if (modo) { processaComandoVmc(); nV = 0; }                    // bit de modo = começo de comando novo
    if (nV < (int)sizeof(bV)) bV[nV++] = c;
    ultByteV = millis();
  }
  if (nV && millis() - ultByteV > 3) processaComandoVmc();        // silêncio na linha: fecha o bloco
  while (sPerif.available()) {
    uint8_t c = sPerif.read(); bool modo = sPerif.readParity();
    if (nP < (int)sizeof(bP)) bP[nP++] = c;
    if (modo) processaRespostaPerif();                              // bit de modo = último byte da resposta
  }
}

// ---------- servidor (mesmo protocolo da Touch Pulse) ----------
String hmacHex(const String& msg) {
  byte out[32]; mbedtls_md_context_t ctx; mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)PLACA_SEGREDO, strlen(PLACA_SEGREDO));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out); mbedtls_md_free(&ctx);
  char hex[65]; for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]); hex[64] = 0; return String(hex);
}
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA); WiFi.begin();
  uint32_t t0 = millis(); while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(100); lerMdb(); }
}
void sincronizar() {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED || !strlen(PLACA_ID) || !strlen(PLACA_SEGREDO)) return;
  if (nLote == 0 && nFila > 0) { memcpy(lote, fila, sizeof(Venda) * nFila); nLote = nFila; nFila = 0; loteAtual++; mem.putUInt("nlt", loteAtual); salvarFila(); }
  JsonDocument env;
  env["p"] = 2; env["via"] = "wifi"; env["fw"] = FIRMWARE; env["rssi"] = WiFi.RSSI(); env["lote"] = loteAtual;
  if (primeiroEnvio) env["boot"] = true;
  JsonArray va = env["vendas"].to<JsonArray>();
  for (int i = 0; i < nLote; i++) { JsonObject o = va.add<JsonObject>(); o["i"] = lote[i].item; o["v"] = lote[i].centavos / 100.0; o["m"] = lote[i].meio == 2 ? "dinheiro" : "cartao"; }
  String corpo; serializeJson(env, corpo);
  long ts = (long)(millis() / 1000) + deltaRelogio;
  WiFiClientSecure cli; cli.setInsecure();   // a segurança está nas assinaturas (protocolo 2)
  HTTPClient http; http.begin(cli, URL_SYNC); http.setTimeout(8000);
  http.addHeader("content-type", "application/json"); http.addHeader("x-placa", PLACA_ID);
  http.addHeader("x-ts", String(ts)); http.addHeader("x-sig", hmacHex(String(ts) + "." + corpo));
  int code = http.POST(corpo); String resp = http.getString(); http.end();
  JsonDocument r; if (deserializeJson(r, resp)) return;
  if (code != 200 || !r["ok"].as<bool>()) { if (r["agora"].is<long>()) { deltaRelogio = r["agora"].as<long>() - (long)(millis() / 1000); ultimoSync = 0; } return; }
  long agora = r["agora"].as<long>();
  if (r["a"].as<String>() == hmacHex("ok." + String(agora) + "." + String(loteAtual)).substring(0, 32)) {
    deltaRelogio = agora - (long)(millis() / 1000); nLote = 0; primeiroEnvio = false; salvarFila();
    if (r["cfg"]["envio_s"].is<int>()) envioS = constrain(r["cfg"]["envio_s"].as<int>(), 10, 3600);
  }
}

// ---------- configuração ----------
void portalConfig(bool forcar) {
  WiFiManager wm; wm.setConfigPortalTimeout(300);
  WiFiManagerParameter pId("placa", "Número da placa (ex.: TMD-0001)", PLACA_ID, 15);
  WiFiManagerParameter pSeg("seg", "Chave da placa", PLACA_SEGREDO, 64);
  wm.addParameter(&pId); wm.addParameter(&pSeg);
  String rede = "TOUCH-VENDING-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX);
  if (forcar) wm.startConfigPortal(rede.c_str()); else wm.autoConnect(rede.c_str());
  if (strlen(pId.getValue())) { strncpy(PLACA_ID, pId.getValue(), 15); mem.putString("id", PLACA_ID); }
  if (strlen(pSeg.getValue())) { strncpy(PLACA_SEGREDO, pSeg.getValue(), 64); mem.putString("seg", PLACA_SEGREDO); }
}
void lerSerial() {   // gravação na bancada: "CFG TMD-0001 <chave>"
  if (!Serial.available()) return;
  String l = Serial.readStringUntil('\n'); l.trim();
  if (!l.startsWith("CFG ")) return;
  int e = l.indexOf(' ', 4); if (e < 0) return;
  String id = l.substring(4, e), seg = l.substring(e + 1); id.toUpperCase();
  if (!id.startsWith("TMD-") || seg.length() < 32) { Serial.println("ERRO: use CFG TMD-0001 <chave>"); return; }
  id.toCharArray(PLACA_ID, sizeof(PLACA_ID)); seg.toCharArray(PLACA_SEGREDO, sizeof(PLACA_SEGREDO));
  mem.putString("id", PLACA_ID); mem.putString("seg", PLACA_SEGREDO);
  Serial.println("OK gravado " + id);
}

void setup() {
  Serial.begin(115200); pinMode(PINO_LED, OUTPUT); pinMode(PINO_BOOT, INPUT_PULLUP);
  mem.begin("touchv", false);
  mem.getString("id", "").toCharArray(PLACA_ID, sizeof(PLACA_ID));
  mem.getString("seg", "").toCharArray(PLACA_SEGREDO, sizeof(PLACA_SEGREDO));
  loteAtual = mem.getUInt("nlt", 0); fatorEscala = mem.getUChar("fator", 1); casas = mem.getUChar("casas", 2);
  nFila = constrain(mem.getInt("nfila", 0), 0, MAX_V); if (nFila) mem.getBytes("fila", fila, sizeof(Venda) * nFila);
  nLote = constrain(mem.getInt("nlote", 0), 0, MAX_V); if (nLote) mem.getBytes("lote", lote, sizeof(Venda) * nLote);
  sVmc.begin(9600, SWSERIAL_8S1, PINO_VMC, -1, INVERTE, 128);     // só RX: a placa nunca transmite no MDB
  sPerif.begin(9600, SWSERIAL_8S1, PINO_PERIF, -1, INVERTE, 128);
  uint32_t t0 = millis(); bool segurou = true;
  while (millis() - t0 < 5000) { if (digitalRead(PINO_BOOT) == HIGH) { segurou = false; break; } delay(50); }
  portalConfig(segurou || !strlen(PLACA_ID) || !strlen(PLACA_SEGREDO));
}
void loop() {
  lerMdb(); lerSerial();
  uint32_t agora = millis(), espera = (nFila || nLote) ? AGRUPA_MS : envioS * 1000UL;
  if (ultimoSync == 0 || agora - ultimoSync >= espera) { ultimoSync = agora ? agora : 1; sincronizar(); }
}
