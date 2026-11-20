// Simulação da Placa MV (firmware Bluetooth v0.3) no computador.
// Compila o próprio arquivo do firmware com "stubs" de Arduino/BLE e testa a lógica com uma máquina virtual.
#include <map>
#include <openssl/hmac.h>
#include "Arduino.h"
#include "BLEDevice.h"

uint64_t SIM_US = 1000000;
std::map<std::string, std::string> SIM_NVS;
SerialStub Serial; EspStub ESP;
static std::map<std::string, BLECharacteristic*> CARAC;
void sim_registra_carac(const char* uuid, BLECharacteristic* c) { CARAC[uuid] = c; }

// --- máquina virtual: fio de SINAL, pino de saída da placa, contador de créditos da máquina ---
static void (*ISR)() = nullptr;
static int pinoSaida = 0, creditosMaquina = 0;
void attachInterrupt(int, void (*f)(), int) { ISR = f; }
void pinMode(int, int) {}
int digitalRead(int) { return HIGH; }   // botão BOOT solto
void sim_avanca_ms(unsigned long ms) { SIM_US += ms * 1000ULL; }
void digitalWrite(int pino, int v) {
  if (pino == 26) {   // saída de crédito: a máquina conta 1 crédito a cada pulso e a entrada "vê" o mesmo pulso
    if (v == HIGH && pinoSaida == LOW) { creditosMaquina++; if (ISR) ISR(); }
    pinoSaida = v;
  }
}
// moeda real: o moedeiro puxa o SINAL (borda na entrada), com repique opcional
static void moeda(bool repique) {
  SIM_US += 100000; if (ISR) ISR();
  if (repique) { SIM_US += 2000; if (ISR) ISR(); }
  creditosMaquina++; SIM_US += 50000;
}

#define main firmware_main_nao_usado
#include "placa_mv_ble.cpp"
#undef main

static std::string hmacHexStr(const std::string& k, const std::string& m) {
  unsigned char o[32]; unsigned int l = 32;
  HMAC(EVP_sha256(), k.data(), k.size(), (const unsigned char*)m.data(), m.size(), o, &l);
  char h[65]; for (int i = 0; i < 32; i++) sprintf(h + 2 * i, "%02x", o[i]); return std::string(h, 64);
}
static int falhas = 0, total = 0;
static void confere(bool ok, const char* oque) { total++; if (!ok) falhas++; printf("  %s  %s\n", ok ? "OK  " : "FALHOU", oque); }
static JsonDocument lerPacote() { JsonDocument d; deserializeJson(d, CARAC[PACOTE_UUID]->valor); return d; }
static void responder(const std::string& json) { CARAC[RESPOSTA_UUID]->valor = json; CARAC[RESPOSTA_UUID]->cb->onWrite(CARAC[RESPOSTA_UUID]); loop(); }
static std::string credito(const std::string& id, int p, const std::string& seg, bool sigBoa = true) {
  std::string s = hmacHexStr(seg, id + "." + std::to_string(p)).substr(0, 32);
  if (!sigBoa) s[0] = s[0] == 'a' ? 'b' : 'a';
  return "{\"id\":\"" + id + "\",\"pulsos\":" + std::to_string(p) + ",\"s\":\"" + s + "\"}";
}

int main() {
  const std::string SEG = "0123456789abcdef0123456789abcdef0123456789abcdef";
  printf("1) Placa nova, sem configuração\n");
  setup();
  confere(CARAC[PACOTE_UUID]->valor.empty(), "sem número/chave não gera pacote (não fala com o servidor)");

  printf("2) Placa gravada (CFG MVP-0001 <chave>) e religada\n");
  SIM_NVS["id"] = "MVP-0001"; SIM_NVS["seg"] = SEG;
  setup();
  confere(std::string(PLACA_ID) == "MVP-0001", "número da placa lido da memória");

  printf("3) Três moedas, uma com repique de contato\n");
  moeda(false); moeda(true); moeda(false);
  montarPacote();
  JsonDocument p = lerPacote(); JsonDocument c; deserializeJson(c, p["corpo"].as<const char*>());
  confere(c["moedas"].as<int>() == 3, "conta 3 moedas (repique ignorado)");
  confere(c["lote"].as<int>() == 1, "abre o lote 1");
  std::string esperado = hmacHexStr(SEG, std::to_string(p["ts"].as<long>()) + "." + p["corpo"].as<std::string>());
  confere(esperado == p["sig"].as<std::string>(), "pacote assinado corretamente (servidor confere)");
  confere(c["boot"].as<bool>(), "avisa que reiniciou");

  printf("4) Resposta se perde: a placa reenvia o MESMO lote (servidor não conta duas vezes)\n");
  moeda(false);
  montarPacote(); p = lerPacote(); deserializeJson(c, p["corpo"].as<const char*>());
  confere(c["lote"].as<int>() == 1 && c["moedas"].as<int>() == 3, "reenvia lote 1 com 3 moedas; a 4ª moeda espera o próximo lote");

  printf("5) Servidor responde OK com 2 créditos assinados (1 e 2 jogadas)\n");
  int antes = creditosMaquina;
  responder("{\"ok\":true,\"agora\":1795200000,\"cfg\":{\"pulso_ms\":60,\"intervalo_ms\":80},\"creditos\":[" + credito("aaa-1", 1, SEG) + "," + credito("bbb-2", 2, SEG) + "]}");
  confere(creditosMaquina - antes == 3, "máquina recebeu 3 pulsos de crédito");
  p = lerPacote(); deserializeJson(c, p["corpo"].as<const char*>());
  confere(c["lote"].as<int>() == 2 && c["moedas"].as<int>() == 1, "próximo lote (2) leva só a 4ª moeda: o próprio crédito NÃO virou moeda");
  confere(c["feitos"].size() == 2, "confirma ao servidor os 2 créditos executados");
  confere(std::abs(p["ts"].as<long>() - 1795200000L) < 5, "relógio acertado pelo servidor");

  printf("6) Mesma resposta chega de novo (repetição/ataque por Bluetooth)\n");
  antes = creditosMaquina;
  responder("{\"ok\":true,\"agora\":1795200001,\"creditos\":[" + credito("aaa-1", 1, SEG) + "," + credito("bbb-2", 2, SEG) + "]}");
  confere(creditosMaquina == antes, "nenhum crédito repetido");

  printf("7) Crédito com assinatura falsa (alguém tentando jogar de graça)\n");
  antes = creditosMaquina;
  responder("{\"ok\":true,\"agora\":1795200002,\"creditos\":[" + credito("ccc-3", 5, SEG, false) + "]}");
  confere(creditosMaquina == antes, "crédito falso ignorado");
  responder("{\"ok\":true,\"agora\":1795200003,\"creditos\":[{\"id\":\"ddd-4\",\"pulsos\":10}]}");
  confere(creditosMaquina == antes, "crédito sem assinatura ignorado");

  printf("8) Queda de energia e religa: crédito antigo reaparece\n");
  setup();
  antes = creditosMaquina;
  responder("{\"ok\":true,\"agora\":1795200100,\"creditos\":[" + credito("bbb-2", 2, SEG) + "]}");
  confere(creditosMaquina == antes, "lembra dos créditos já dados mesmo depois de desligar");

  printf("9) Servidor recusa (relógio errado): a placa acerta o relógio e não perde as moedas\n");
  moeda(false); moeda(false);
  montarPacote(); p = lerPacote(); deserializeJson(c, p["corpo"].as<const char*>());
  int loteAntes = c["lote"].as<int>(), moedasAntes = c["moedas"].as<int>();
  responder("{\"erro\":\"relogio\",\"agora\":1795209999}");
  p = lerPacote(); deserializeJson(c, p["corpo"].as<const char*>());
  confere(c["lote"].as<int>() == loteAntes && c["moedas"].as<int>() == moedasAntes, "mantém o mesmo lote com as mesmas moedas");
  confere(std::abs(p["ts"].as<long>() - 1795209999L) < 5, "relógio acertado");

  printf("10) Pulsos fora do limite\n");
  antes = creditosMaquina;
  responder("{\"ok\":true,\"agora\":1795210000,\"creditos\":[" + credito("eee-5", 99, SEG) + "]}");
  confere(creditosMaquina == antes, "pedido de 99 pulsos recusado (máximo 50)");

  printf("\nResultado: %d de %d verificações OK\n", total - falhas, total);
  return falhas ? 1 : 0;
}
