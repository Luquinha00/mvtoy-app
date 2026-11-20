// Simulação da Telemetria MV Toy (placa Bluetooth v0.4, protocolo 2) no computador.
// Compila o próprio arquivo do firmware com "stubs" de Arduino/BLE e testa a lógica com uma máquina virtual,
// uma maquininha virtual e um servidor falso com as mesmas regras da tel-sync v3.
#include <map>
#include "Arduino.h"
#include "BLEDevice.h"

uint64_t SIM_US = 1000000;
std::map<std::string, std::string> SIM_NVS;
SerialStub Serial; EspStub ESP;
static std::map<std::string, BLECharacteristic*> CARAC;
void sim_registra_carac(const char* uuid, BLECharacteristic* c) { CARAC[uuid] = c; }

static void (*ISR)() = nullptr;
static int pinoSaida = 0, creditosMaquina = 0;
void attachInterrupt(int, void (*f)(), int) { ISR = f; }
void pinMode(int, int) {}
int digitalRead(int) { return HIGH; }
void sim_avanca_ms(unsigned long ms) { SIM_US += ms * 1000ULL; }
void digitalWrite(int pino, int v) {
  if (pino == 26) { if (v == HIGH && pinoSaida == LOW) { creditosMaquina++; if (ISR) ISR(); } pinoSaida = v; }
}
static void moeda(bool repique) {
  SIM_US += 100000; if (ISR) ISR();
  if (repique) { SIM_US += 2000; if (ISR) ISR(); }
  creditosMaquina++; SIM_US += 50000;
}

#define main firmware_main_nao_usado
#include "telemetria_mvtoy_ble.cpp"
#undef main
#include "sim_servidor.h"

static int falhas = 0, total = 0;
static void confere(bool ok, const char* oque) { total++; if (!ok) falhas++; printf("  %s  %s\n", ok ? "OK  " : "FALHOU", oque); }
static ServidorFalso SV;
static bool perderResposta = false;
static JsonDocument corpoAtual() { JsonDocument p; deserializeJson(p, CARAC[PACOTE_UUID]->valor); JsonDocument c; deserializeJson(c, p["corpo"].as<const char*>()); return c; }
static void escrever(const std::string& json) { CARAC[RESPOSTA_UUID]->valor = json; CARAC[RESPOSTA_UUID]->cb->onWrite(CARAC[RESPOSTA_UUID]); loop(); }
static std::string ultimaResposta;
// maquininha: lê o pacote, leva ao servidor e devolve a resposta à placa
static void maquininha(int prof = 0) {
  if (prof > 5) return;
  int n0 = CARAC[PACOTE_UUID]->notificacoes;
  JsonDocument p; deserializeJson(p, CARAC[PACOTE_UUID]->valor);
  std::string r; SV.atender(std::to_string(p["ts"].as<long>()), p["corpo"].as<std::string>(), p["sig"].as<std::string>(), r);
  SV.agora += 5;
  if (perderResposta) return;
  ultimaResposta = r; escrever(r);
  if (CARAC[PACOTE_UUID]->notificacoes != n0) maquininha(prof + 1);   // a placa avisou de novo (ex.: confirmar crédito)
}
// roda a placa por "ms"; a maquininha (se conectada) atende cada aviso
static int avisosNoPeriodo = 0;
static void rodar(unsigned long ms, bool maquininhaLigada = true) {
  unsigned long fim = millis() + ms; avisosNoPeriodo = 0;
  while (millis() < fim) {
    int antes = CARAC[PACOTE_UUID]->notificacoes;
    loop();
    if (CARAC[PACOTE_UUID]->notificacoes != antes) { avisosNoPeriodo++; if (maquininhaLigada) maquininha(); }
  }
}

int main() {
  const std::string SEG = "0123456789abcdef0123456789abcdef0123456789abcdef";
  SV.seg = SEG;
  printf("1) Placa nova, sem configuração\n");
  setup();
  confere(CARAC[PACOTE_UUID]->valor.empty(), "sem número/chave não gera pacote");

  printf("2) Placa gravada (CFG TMV-0001 <chave>) e religada\n");
  SIM_NVS["id"] = "TMV-0001"; SIM_NVS["seg"] = SEG;
  setup();
  confere(std::string(PLACA_ID) == "TMV-0001" && CARAC[INFO_UUID]->valor.find("TMV-0001") != std::string::npos, "número lido da memória e mostrado na INFO");

  printf("3) Maquininha conecta e leva o 1º pacote (relógio da placa ainda errado)\n");
  BLEDevice::createServer()->cb->onConnect(nullptr);
  maquininha();             // recusado por relógio → placa refaz e avisa
  rodar(100);
  confere(std::abs(((long)(millis() / 1000) + deltaRelogio) - SV.agora) < 10, "relógio acertado e 2º envio aceito");
  confere(!primeiroEnvio, "confirmação assinada aceita");

  printf("4) Economia: sem moedas, a placa fica quieta e só dá sinal de vida a cada 5 min\n");
  int ch = SV.chamadas; rodar(250000);
  confere(SV.chamadas == ch, "nenhuma chamada ao servidor em 250 s sem movimento");
  rodar(60000);
  confere(SV.chamadas == ch + 1, "1 chamada de \"estou viva\" no 5º minuto");

  printf("5) Três moedas (uma com repique): agrupa e envia em até 20 s\n");
  moeda(false); moeda(true); moeda(false);
  rodar(21000);
  confere(SV.moedas == 3, "servidor recebeu 3 moedas (repique ignorado)");

  printf("6) Alguém por perto escreve uma confirmação FALSA pelo Bluetooth\n");
  moeda(false); moeda(false);
  montarPacote(false);
  long loteA = corpoAtual()["lote"].as<long>();
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"a\":\"00000000000000000000000000000000\",\"creditos\":[]}");
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + "}");
  JsonDocument c = corpoAtual();
  confere(c["lote"].as<long>() == loteA && c["moedas"].as<int>() == 2, "moedas NÃO foram apagadas (continuam no mesmo lote)");
  rodar(21000);
  confere(SV.moedas == 5, "as 2 moedas chegam ao servidor");

  printf("7) Resposta se perde (servidor contou, placa não soube)\n");
  moeda(false); perderResposta = true; rodar(21000); perderResposta = false; rodar(21000);
  confere(SV.moedas == 6, "moeda contada 1 vez só (mesmo lote reenviado)");

  printf("8) Venda Pix de 3 jogadas\n");
  int antes = creditosMaquina;
  SV.pendentes.push_back({"7f3c2a10-0000-4000-8000-000000000001", 3});
  maquininha();             // a maquininha lê o pacote logo depois da venda
  rodar(1000);
  confere(creditosMaquina - antes == 3, "máquina recebeu 3 créditos");
  confere(SV.executados.count("7f3c2a10-0000-4000-8000-000000000001") == 1, "confirmação chega ao servidor na hora");
  confere(SV.moedas == 6, "o próprio crédito não virou moeda");
  std::string respostaPix = ultimaResposta;

  printf("9) Créditos falsos\n");
  antes = creditosMaquina;
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"creditos\":[{\"id\":\"x-1\",\"pulsos\":5,\"s\":\"" + SV.cred("x-1", 5, SV.agora - 1) + "\"}]}");
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"creditos\":[{\"id\":\"x-2\",\"pulsos\":10}]}");
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"creditos\":[{\"id\":\"x-3\",\"pulsos\":2,\"s\":\"" + hx("chave-errada", "x-3.2." + std::to_string(SV.agora)).substr(0, 32) + "\"}]}");
  confere(creditosMaquina == antes, "assinatura com hora trocada, sem assinatura ou com chave errada: nenhum crédito");

  printf("10) Resposta Pix antiga reenviada depois de 25 créditos novos (memória de 20 já passou)\n");
  for (int i = 0; i < 25; i++) { char id[48]; snprintf(id, 48, "7f3c2a10-0000-4000-8000-1000000000%02d", i); SV.pendentes.push_back({id, 1}); }
  for (int i = 0; i < 12; i++) { maquininha(); rodar(500); }
  antes = creditosMaquina;
  escrever(respostaPix);
  confere(creditosMaquina == antes, "resposta antiga recusada pela hora (não repete o Pix)");
  confere(SV.executados.size() == 26, "os 25 créditos novos executados e confirmados");

  printf("11) Shopping fecha: maquininha desligada, 4 moedas, luz cai\n");
  BLEDevice::createServer()->cb->onDisconnect(BLEDevice::createServer());
  for (int i = 0; i < 4; i++) moeda(false);
  rodar(3000, false);
  moedasPendentes = 0; moedasDoLote = 0;    // a memória RAM some na queda de energia
  setup();                                   // religa no dia seguinte
  BLEDevice::createServer()->cb->onConnect(nullptr);
  rodar(25000);
  confere(SV.moedas == 10, "as 4 moedas guardadas na memória chegam ao servidor");

  printf("12) Relógio errado no servidor (resposta de erro)\n");
  moeda(false); moeda(false); montarPacote(false);
  c = corpoAtual(); long lote12 = c["lote"].as<long>();
  escrever("{\"erro\":\"relogio\",\"agora\":" + std::to_string(SV.agora + 30) + "}");
  c = corpoAtual();
  confere(c["lote"].as<long>() == lote12 && c["moedas"].as<int>() == 2, "mantém o lote e as moedas");
  rodar(25000);
  confere(SV.moedas == 12, "moedas entregues depois");

  printf("13) Celular de curioso conecta e não faz nada\n");
  BLEServer* bs = BLEDevice::createServer();
  bs->cb->onDisconnect(bs); int desc = bs->desconexoes;
  bs->cb->onConnect(nullptr); rodar(95000, false);
  confere(bs->desconexoes == desc + 1, "derrubado em 90 s (a placa volta a anunciar para a maquininha)");
  bs->cb->onConnect(nullptr); maquininha(); rodar(400000);
  confere(bs->desconexoes == desc + 1, "maquininha de verdade fica conectada (respostas assinadas)");

  printf("14) Limites\n");
  antes = creditosMaquina;
  escrever("{\"ok\":true,\"agora\":" + std::to_string(SV.agora + 100) + ",\"creditos\":[{\"id\":\"y\",\"pulsos\":99,\"s\":\"" + SV.cred("y", 99, SV.agora + 100) + "\"}]}");
  confere(creditosMaquina == antes, "pedido de 99 pulsos recusado (máximo 50)");
  // pior caso de tamanho no Bluetooth: 5 confirmações + 3 créditos
  for (int i = 0; i < 5; i++) { feitos[i] = "7f3c2a10-0000-4000-8000-99999999999" + std::to_string(i); feitoConfirmado[i] = false; }
  moedasDoLote = 499; loteAtual = 4000000000u; montarPacote(false);
  size_t tPac = CARAC[PACOTE_UUID]->valor.size();
  std::string cr3; for (int i = 0; i < 3; i++) { if (i) cr3 += ","; std::string id = "7f3c2a10-0000-4000-8000-88888888888" + std::to_string(i); cr3 += "{\"id\":\"" + id + "\",\"pulsos\":50,\"s\":\"" + SV.cred(id, 50, SV.agora) + "\"}"; }
  std::string rMax = "{\"ok\":true,\"agora\":" + std::to_string(SV.agora) + ",\"a\":\"" + std::string(32, 'f') + "\",\"creditos\":[" + cr3 + "],\"cfg\":{\"pulso_ms\":300,\"intervalo_ms\":500,\"envio_s\":3600}}";
  printf("     pacote %zu bytes, resposta %zu bytes (limite 512)\n", tPac, rMax.size());
  confere(tPac <= 512 && rMax.size() <= 512, "cabe numa mensagem Bluetooth");

  printf("\nResultado: %d de %d verificações OK\n", total - falhas, total);
  return falhas ? 1 : 0;
}
