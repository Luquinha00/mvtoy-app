// Simulação da Placa MV v0.2 (Wi-Fi) contra um servidor falso que imita a tel-sync.
#include <map>
#include <set>
#include <openssl/hmac.h>
#include "Arduino.h"
#include "HTTPClient.h"
#include "WiFi.h"
uint64_t SIM_US = 1000000; std::map<std::string, std::string> SIM_NVS; SerialStub Serial; EspStub ESP; WiFiStub WiFi;
std::function<int(const std::map<std::string,std::string>&, const std::string&, std::string&)> SIM_SERVIDOR;
static void (*ISR)() = nullptr; static int pinoSaida = 0, creditosMaquina = 0;
void attachInterrupt(int, void (*f)(), int) { ISR = f; }
void pinMode(int, int) {} int digitalRead(int) { return HIGH; }
void sim_avanca_ms(unsigned long ms) { SIM_US += ms * 1000ULL; }
void digitalWrite(int pino, int v) { if (pino == 26) { if (v == HIGH && pinoSaida == LOW) { creditosMaquina++; if (ISR) ISR(); } pinoSaida = v; } }
static void moeda() { SIM_US += 100000; if (ISR) ISR(); SIM_US += 2000; if (ISR) ISR(); creditosMaquina++; SIM_US += 50000; }
#include "placa_mv.cpp"
#include "ArduinoJson.h"
static std::string hx(const std::string& k, const std::string& m) { unsigned char o[32]; unsigned l = 32; HMAC(EVP_sha256(), k.data(), k.size(), (const unsigned char*)m.data(), m.size(), o, &l); char h[65]; for (int i = 0; i < 32; i++) sprintf(h + 2*i, "%02x", o[i]); return std::string(h, 64); }
static int falhas = 0, total = 0;
static void confere(bool ok, const char* o) { total++; if (!ok) falhas++; printf("  %s  %s\n", ok ? "OK  " : "FALHOU", o); }
int main() {
  const std::string SEG = "fedcba9876543210fedcba9876543210fedcba9876543210";
  SIM_NVS["id"] = "MVP-0002"; SIM_NVS["seg"] = SEG;
  // servidor falso = mesmas regras da tel-sync
  long agoraServidor = 1795300000; long ultimoLote = -1; int moedasServidor = 0; std::set<std::string> executados;
  std::vector<std::pair<std::string,int>> pendentes; bool perderResposta = false; int chamadas = 0;
  SIM_SERVIDOR = [&](const std::map<std::string,std::string>& h, const std::string& corpo, std::string& resp) {
    chamadas++;
    long ts = std::stol(h.at("x-ts"));
    if (hx(SEG, h.at("x-ts") + "." + corpo) != h.at("x-sig")) { resp = "{\"erro\":\"assinatura\"}"; return 401; }
    if (std::labs(agoraServidor - ts) > 600) { resp = "{\"erro\":\"relogio\",\"agora\":" + std::to_string(agoraServidor) + "}"; return 401; }
    JsonDocument b; deserializeJson(b, corpo);
    if (b["moedas"].as<int>() > 0 && b["lote"].as<long>() != ultimoLote) { moedasServidor += b["moedas"].as<int>(); ultimoLote = b["lote"].as<long>(); }
    for (JsonVariant f : b["feitos"].as<JsonArray>()) executados.insert(f.as<std::string>());
    std::string cr;
    for (auto& p : pendentes) if (!executados.count(p.first)) { if (!cr.empty()) cr += ","; cr += "{\"id\":\"" + p.first + "\",\"pulsos\":" + std::to_string(p.second) + "}"; }
    resp = "{\"ok\":true,\"agora\":" + std::to_string(agoraServidor) + ",\"creditos\":[" + cr + "],\"cfg\":{\"pulso_ms\":60,\"intervalo_ms\":80}}";
    if (perderResposta) { resp = ""; return -1; }
    return 200;
  };
  setup();
  printf("1) Primeiro contato: relógio da placa errado\n");
  sincronizar(); sincronizar();
  confere(chamadas == 2 && std::labs(((long)(millis()/1000) + deltaRelogio) - agoraServidor) < 5, "1ª chamada recusada por relógio, 2ª já com a hora certa");
  printf("2) Moedas com repique\n");
  moeda(); moeda(); moeda(); sincronizar();
  confere(moedasServidor == 3, "servidor recebeu 3 moedas");
  printf("3) Internet cai na hora da resposta (servidor recebeu, placa não soube)\n");
  moeda(); perderResposta = true; sincronizar(); perderResposta = false; sincronizar();
  confere(moedasServidor == 4, "4ª moeda contada 1 vez só (lote reenviado)");
  printf("4) Crédito pago (Pix) de 3 jogadas\n");
  int antes = creditosMaquina; pendentes.push_back({"pix-1", 3}); sincronizar();
  confere(creditosMaquina - antes == 3, "máquina recebeu 3 créditos");
  sincronizar();
  confere(executados.count("pix-1") == 1, "servidor marcou como executado");
  confere(moedasServidor == 4, "o próprio crédito não virou moeda");
  printf("5) Resposta com o crédito se perde e o servidor manda de novo\n");
  antes = creditosMaquina; pendentes.push_back({"pix-2", 2});
  perderResposta = false; sincronizar();             // executa
  executados.erase("pix-2");                          // simula servidor que não recebeu a confirmação
  sincronizar();
  confere(creditosMaquina - antes == 2, "não repete o crédito (2 jogadas, não 4)");
  printf("6) Wi-Fi do ponto cai por 1 minuto\n");
  WiFi.st = 0; moeda(); moeda(); int ch = chamadas; for (int i = 0; i < 12; i++) sincronizar();
  confere(chamadas == ch, "sem Wi-Fi não tenta enviar");
  WiFi.st = 3; sincronizar();
  confere(moedasServidor == 6, "as 2 moedas do período sem internet chegam quando volta");
  printf("\nResultado: %d de %d verificações OK\n", total - falhas, total);
  return falhas ? 1 : 0;
}
