#pragma once
#include "Arduino.h"
#include <map>
extern std::map<std::string, std::string> SIM_NVS;
struct Preferences {
  bool begin(const char*, bool) { return true; }
  void putString(const char* k, const String& v) { SIM_NVS[k] = v.s; }
  String getString(const char* k, const char* d) { auto i = SIM_NVS.find(k); return String(i == SIM_NVS.end() ? std::string(d) : i->second); }
  void putUInt(const char* k, uint32_t v) { SIM_NVS[k] = std::to_string(v); }
  uint32_t getUInt(const char* k, uint32_t d) { auto i = SIM_NVS.find(k); return i == SIM_NVS.end() ? d : std::stoul(i->second); }
  void putInt(const char* k, int v) { SIM_NVS[k] = std::to_string(v); }
  int getInt(const char* k, int d) { auto i = SIM_NVS.find(k); return i == SIM_NVS.end() ? d : std::stoi(i->second); }
};
