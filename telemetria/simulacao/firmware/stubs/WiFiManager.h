#pragma once
#include "Arduino.h"
struct WiFiManagerParameter { std::string v; WiFiManagerParameter(const char*, const char*, const char* d, int) : v(d) {} const char* getValue() { return v.c_str(); } };
struct WiFiManager { void setConfigPortalTimeout(int) {} void addParameter(WiFiManagerParameter*) {} bool startConfigPortal(const char* n) { printf("[portal] %s\n", n); return true; } bool autoConnect(const char*) { return true; } };
