#pragma once
#include "Arduino.h"
class BLEServer; class BLECharacteristic;
struct BLEServerCallbacks { virtual void onConnect(BLEServer*) {} virtual void onDisconnect(BLEServer*) {} virtual ~BLEServerCallbacks() {} };
struct BLECharacteristicCallbacks { virtual void onWrite(BLECharacteristic*) {} virtual ~BLECharacteristicCallbacks() {} };
struct BLEDescriptor {};
class BLECharacteristic {
 public:
  enum { PROPERTY_READ = 1, PROPERTY_WRITE = 2, PROPERTY_NOTIFY = 4 };
  std::string valor; BLECharacteristicCallbacks* cb = nullptr; int notificacoes = 0;
  void setValue(const char* v) { valor = v; }
  std::string getValue() { return valor; }
  void notify() { notificacoes++; }
  void addDescriptor(BLEDescriptor*) {}
  void setCallbacks(BLECharacteristicCallbacks* c) { cb = c; }
};
struct BLEAdvertising { void addServiceUUID(const char*) {} void start() {} };
class BLEService {
 public:
  BLECharacteristic* createCharacteristic(const char* uuid, int) { auto* c = new BLECharacteristic(); extern void sim_registra_carac(const char*, BLECharacteristic*); sim_registra_carac(uuid, c); return c; }
  void start() {}
};
class BLEServer {
 public:
  BLEServerCallbacks* cb = nullptr;
  void setCallbacks(BLEServerCallbacks* c) { cb = c; }
  BLEService* createService(const char*) { return new BLEService(); }
  BLEAdvertising* getAdvertising() { static BLEAdvertising a; return &a; }
  int desconexoes = 0;
  uint16_t getConnId() { return 0; }
  void disconnect(uint16_t) { desconexoes++; if (cb) cb->onDisconnect(this); }
};
struct BLEDevice {
  static void init(const char* n) { printf("[ble] nome = %s\n", n); }
  static void setMTU(int) {}
  static BLEServer* createServer() { static BLEServer s; return &s; }
  static BLEAdvertising* getAdvertising() { static BLEAdvertising a; return &a; }
};
