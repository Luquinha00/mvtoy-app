// Stub mínimo do Arduino para simular a Placa MV no computador (teste de lógica).
#pragma once
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <algorithm>
#include <functional>
#include <vector>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define RISING 1
#define FALLING 2
#define HEX 16
#define IRAM_ATTR
typedef uint8_t byte;

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(char c) : s(1, c) {}
  String(int v) : s(std::to_string(v)) {}
  String(unsigned v) : s(std::to_string(v)) {}
  String(long v) : s(std::to_string(v)) {}
  String(unsigned long v) : s(std::to_string(v)) {}
  String(uint32_t v, int base) { char b[16]; snprintf(b, 16, base == 16 ? "%x" : "%u", v); s = b; }
  const char* c_str() const { return s.c_str(); }
  unsigned int length() const { return s.size(); }
  bool concat(const char* c) { s += c; return true; }
  bool concat(const char* c, unsigned n) { s.append(c, n); return true; }
  bool concat(char c) { s += c; return true; }
  bool reserve(unsigned n) { s.reserve(n); return true; }
  String& operator+=(const String& o) { s += o.s; return *this; }
  String& operator+=(const char* c) { s += c; return *this; }
  String& operator+=(char c) { s += c; return *this; }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator!=(const String& o) const { return s != o.s; }
  bool operator==(const char* c) const { return s == c; }
  char operator[](unsigned i) const { return s[i]; }
  bool startsWith(const char* p) const { return s.rfind(p, 0) == 0; }
  int indexOf(char c, unsigned from = 0) const { auto p = s.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  String substring(unsigned a) const { return String(s.substr(a)); }
  String substring(unsigned a, unsigned b) const { return String(s.substr(a, b - a)); }
  void trim() { while (!s.empty() && isspace((unsigned char)s.back())) s.pop_back(); size_t i = 0; while (i < s.size() && isspace((unsigned char)s[i])) i++; s = s.substr(i); }
  void toCharArray(char* buf, unsigned n) const { strncpy(buf, s.c_str(), n - 1); buf[n - 1] = 0; }
};
inline String operator+(const String& a, const String& b) { return String(a.s + b.s); }
inline String operator+(const String& a, const char* b) { return String(a.s + b); }
inline String operator+(const char* a, const String& b) { return String(std::string(a) + b.s); }

// ---- relógio e pinos simulados ----
extern uint64_t SIM_US;
inline unsigned long millis() { return SIM_US / 1000; }
inline unsigned long micros() { return SIM_US; }
void sim_avanca_ms(unsigned long ms);
inline void delay(unsigned long ms) { sim_avanca_ms(ms); }
void pinMode(int, int);
void digitalWrite(int, int);
int digitalRead(int);
inline int digitalPinToInterrupt(int p) { return p; }
void attachInterrupt(int, void (*)(), int);
inline void noInterrupts() {}
inline void interrupts() {}
template <class T> T constrain(T v, T a, T b) { return v < a ? a : (v > b ? b : v); }

struct SerialStub {
  void begin(int) {}
  int available() { return 0; }
  String readStringUntil(char) { return String(); }
  void println(const char* t) { printf("[serial] %s\n", t); }
};
extern SerialStub Serial;
struct EspStub { void restart() { printf("[restart]\n"); } uint64_t getEfuseMac() { return 0x1234567890ULL; } };
extern EspStub ESP;
