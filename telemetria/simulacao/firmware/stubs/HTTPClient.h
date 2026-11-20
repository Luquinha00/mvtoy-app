#pragma once
#include "Arduino.h"
#include "WiFiClientSecure.h"
#include <map>
// servidor falso: a simulação define a função que responde
extern std::function<int(const std::map<std::string,std::string>&, const std::string&, std::string&)> SIM_SERVIDOR;
struct HTTPClient {
  std::map<std::string,std::string> h; std::string resp;
  void begin(WiFiClientSecure&, const char*) { h.clear(); }
  void setTimeout(int) {}
  void addHeader(const char* k, const String& v) { h[k] = v.s; }
  int POST(const String& corpo) { return SIM_SERVIDOR(h, corpo.s, resp); }
  String getString() { return String(resp); }
  void end() {}
};
