// Servidor falso com as MESMAS regras da tel-sync v3 (protocolo 2), para as simulações.
#pragma once
#include <map>
#include <set>
#include <vector>
#include <openssl/hmac.h>
static std::string hx(const std::string& k, const std::string& m) { unsigned char o[32]; unsigned l = 32; HMAC(EVP_sha256(), k.data(), k.size(), (const unsigned char*)m.data(), m.size(), o, &l); char h[65]; for (int i = 0; i < 32; i++) sprintf(h + 2*i, "%02x", o[i]); return std::string(h, 64); }
struct ServidorFalso {
  std::string seg; long agora = 1795300000; long ultimoLote = -1; bool temLote = false; int moedas = 0, notas = 0, premios = 0, chamadas = 0;
  std::set<std::string> executados; std::vector<std::pair<std::string,int>> pendentes; bool ligada = true;
  bool loteNovo(long l) { if (!l) return false; if (!temLote) return true; return l > ultimoLote || l < ultimoLote - 50; }
  std::string cred(const std::string& id, int p, long ag) { return hx(seg, id + "." + std::to_string(p) + "." + std::to_string(ag)).substr(0, 32); }
  int atender(const std::string& xts, const std::string& corpo, const std::string& xsig, std::string& resp) {
    chamadas++;
    long ts = std::stol(xts);
    if (hx(seg, xts + "." + corpo) != xsig) { resp = "{\"erro\":\"assinatura\"}"; return 401; }
    if (std::labs(agora - ts) > 600) { resp = "{\"erro\":\"relogio\",\"agora\":" + std::to_string(agora) + "}"; return 401; }
    JsonDocument b; deserializeJson(b, corpo);
    long lote = b["lote"].as<long>(); int m = b["moedas"].as<int>(), nt = b["notas"].as<int>(), pr = b["premios"].as<int>();
    if (m + nt + pr > 0 && loteNovo(lote)) { moedas += m; notas += nt; premios += pr; ultimoLote = lote; temLote = true; }
    for (JsonVariant f : b["feitos"].as<JsonArray>()) executados.insert(f.as<std::string>());
    std::string cr; int n = 0;
    if (ligada) for (auto& p : pendentes) if (!executados.count(p.first) && n < 3) { if (!cr.empty()) cr += ","; cr += "{\"id\":\"" + p.first + "\",\"pulsos\":" + std::to_string(p.second) + ",\"s\":\"" + cred(p.first, p.second, agora) + "\"}"; n++; }
    std::string a = hx(seg, "ok." + std::to_string(agora) + "." + std::to_string(lote)).substr(0, 32);
    std::string via = b["via"].as<std::string>();
    resp = "{\"ok\":true,\"agora\":" + std::to_string(agora) + ",\"a\":\"" + a + "\",\"creditos\":[" + cr + "],\"cfg\":{\"pulso_ms\":60,\"intervalo_ms\":80,\"envio_s\":" + (via == "wifi" ? "20" : "300") + "}}";
    return 200;
  }
};
