# Simulações da Placa MV (20/11/2026)

## 1. Elétrica (ngspice) — `ngspice -b <arquivo>.cir`
- `entrada.cir` — leitura da moeda em 5/12/24 V × pull-up da máquina 1k/4,7k/10k (18 casos): GPIO 0,03–0,05 V parado e 3,3 V na moeda. Carga máxima no fio: −15% (5 V/10k → 4,24 V).
- `saida.cir` — crédito: PC817 (CTR 50/100/200%) × transistor NPN. PC817 falha com pull-up forte (12 V/1k: sinal fica em 2,8–9,7 V). NPN: < 0,1 V em todos os casos → saída por NPN.
- `transitorio.cir` — pulso de 20 ms, cabo de 1,5 m (10 nF), ruído de 1 V a 1 kHz, pull-up 10k/12 V: sem disparo falso (GPIO parado ≤ 0,035 V), pulso lido com 20,0 ms, saída puxa o sinal a 0,02 V em < 1 µs.

## 2. Firmware Bluetooth v0.3 no computador — `firmware/`
O próprio arquivo do firmware compilado com "stubs" de Arduino/BLE (OpenSSL no lugar do mbedtls) e uma máquina virtual.
Compilar: baixar `ArduinoJson-v7.2.1.h` (GitHub, bblanchon/ArduinoJson) como `stubs/ArduinoJson.h`, copiar `../firmware/placa_mv_ble/placa_mv_ble.ino` para `placa_mv_ble.cpp` e rodar:
`g++ -std=c++17 -include stubs/Arduino.h -Istubs -I. -DARDUINO=10819 -DARDUINOJSON_ENABLE_PROGMEM=0 -DARDUINOJSON_ENABLE_ARDUINO_PRINT=0 -DARDUINOJSON_ENABLE_ARDUINO_STREAM=0 -DARDUINOJSON_ENABLE_ARDUINO_STRING=1 sim_placa.cpp -o sim_placa -lcrypto && ./sim_placa`
Resultado: 18/18 (placa sem configuração, moedas com repique, assinatura, lote reenviado, créditos, repetição, assinatura falsa, queda de energia, relógio, limite de pulsos). Achou e corrigiu 1 falha: após erro de relógio a placa só refazia o pacote 5 s depois (agora refaz na hora).
Tamanho no Bluetooth (pior caso): pacote 395 bytes, resposta 376 bytes (limite 512).

### Firmware Wi-Fi v0.2 (piloto) — `firmware/sim_wifi.cpp`
Mesmo método, contra um servidor falso com as regras da tel-sync: 9/9 (relógio errado no 1º contato, moedas com repique, resposta perdida sem contar duas vezes, crédito Pix de 3 jogadas, confirmação, crédito reenviado sem repetir, Wi-Fi caindo 1 minuto sem perder moedas).

## 3. Servidor (tel-sync, chamadas reais pelo banco) — 20/11
Créditos assinados (assinatura confere com a calculada no banco), limite de 3 por resposta, lote repetido sem contar duas vezes (8 moedas no total, não 13), confirmação marca "executado" e libera o próximo crédito, relógio errado → 401 + hora certa, corpo adulterado → 401, placa inexistente → 401.

## Limites conhecidos
- A placa lembra os últimos 20 créditos: uma resposta antiga reenviada depois de 20 créditos novos seria aceita. Risco baixo (o servidor não reenvia crédito executado); v1 da placa final: guardar o último horário de crédito e recusar mais antigo.
- Picos de tensão no fio de sinal acima de 45 V podem danificar o transistor de saída: a placa final tem TVS no SINAL; no piloto, cuidado na instalação.
