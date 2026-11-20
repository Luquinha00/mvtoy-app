#pragma once
#include "Arduino.h"
#define WL_CONNECTED 3
#define WIFI_STA 1
struct WiFiStub { int st = 3; int status() { return st; } void mode(int) {} void begin() {} void begin(const char*, const char*) {} int RSSI() { return -61; } };
extern WiFiStub WiFi;
