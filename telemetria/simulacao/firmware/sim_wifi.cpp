// Simulação da Telemetria MV Toy · placa Wi-Fi v0.3 (piloto, protocolo 2) contra o servidor falso (regras da tel-sync v3).
#include <map>
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
#include "telemetria_mvtoy_wifi.cpp"
#include "sim_servidor.h"
static int falhas = 0, total = 0;
static void confere(bool ok, const char* o) { total++; if (!ok) falhas++; printf("  %s  %s\n", ok ? "OK  " : "FALHOU", o); }
static ServidorFalso SV; static bool perder = false, falso = false;
static void rodar(unsigned long ms) { unsigned long fim = millis() + ms; while (millis() < fim) loop(); }
int main() {
  const std::string SEG = "fedcba9876543210fedcba9876543210fedcba9876543210";
  SIM_NVS["id"] = "TMV-0002"; SIM_NVS["seg"] = SEG; SV.seg = SEG;
  SIM_SERVIDOR = [&](const std::map<std::string,std::string>& h, const std::string& corpo, std::string& resp) {
    if (falso) {   // alguém na rede do ponto fingindo ser o servidor
      resp = "{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"a\":\"" + std::string(32,'0') + "\",\"creditos\":[{\"id\":\"gratis\",\"pulsos\":10,\"s\":\"" + std::string(32,'1') + "\"}]}";
      return 200;
    }
    int code = SV.atender(h.at("x-ts"), corpo, h.at("x-sig"), resp); SV.agora += 5;
    if (perder) { resp = ""; return -1; }
    return code;
  };
  setup();
  printf("1) Primeiro contato com relógio errado\n");
  rodar(1000);
  confere(SV.chamadas == 2 && !primeiroEnvio, "1ª chamada recusada, 2ª aceita logo em seguida");
  printf("2) Economia no piloto: sem movimento fala a cada 20 s (servidor manda)\n");
  int ch = SV.chamadas; rodar(60500);
  confere(SV.chamadas - ch == 3, "3 chamadas em 1 minuto (antes: 12)");
  printf("3) Moedas com repique, agrupadas\n");
  moeda(); moeda(); moeda(); rodar(21000);
  confere(SV.moedas == 3, "servidor recebeu 3 moedas");
  printf("4) Internet cai na hora da resposta\n");
  moeda(); perder = true; rodar(10500); perder = false; rodar(10500);
  confere(SV.moedas == 4, "4ª moeda contada 1 vez só");
  printf("5) Pix de 3 jogadas\n");
  int antes = creditosMaquina; SV.pendentes.push_back({"a1b2c3d4-0000-4000-8000-000000000001", 3}); rodar(21000);
  confere(creditosMaquina - antes == 3, "máquina recebeu 3 créditos em até 20 s");
  rodar(11000);
  confere(SV.executados.size() == 1 && SV.moedas == 4, "confirmado e o próprio crédito não virou moeda");
  printf("6) Alguém na rede do ponto finge ser o servidor\n");
  moeda(); moeda(); antes = creditosMaquina; falso = true; rodar(21000); falso = false;
  confere(creditosMaquina == antes, "nenhum crédito falso solto");
  rodar(11000);
  confere(SV.moedas == 6, "as 2 moedas não foram apagadas e chegam ao servidor de verdade");
  printf("7) Wi-Fi cai 1 minuto e a luz pisca no meio\n");
  WiFi.st = 0; moeda(); moeda(); ch = SV.chamadas; rodar(60000);
  confere(SV.chamadas == ch, "sem Wi-Fi não tenta enviar");
  moedasPendentes = 0; moedasDoLote = 0; WiFi.st = 3; setup(); rodar(15000);
  confere(SV.moedas == 8, "as 2 moedas do período sem internet chegam (estavam na memória)");
  printf("\nResultado: %d de %d verificações OK\n", total - falhas, total);
  return falhas ? 1 : 0;
}
