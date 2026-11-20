# Simulações da Telemetria MV Toy (20/11/2026)

## 1. Elétrica (ngspice) — `ngspice -b <arquivo>.cir`
- `entrada.cir` — leitura da moeda em 5/12/24 V × pull-up da máquina 1k/4,7k/10k (18 casos): GPIO 0,03–0,05 V parado e 3,3 V na moeda. Carga máxima no fio: −15% (5 V/10k → 4,24 V).
- `saida.cir` — crédito: PC817 (CTR 50/100/200%) × transistor NPN. PC817 falha com pull-up forte (12 V/1k: sinal fica em 2,8–9,7 V). NPN: < 0,1 V em todos os casos → saída por NPN.
- `transitorio.cir` — pulso de 20 ms, cabo de 1,5 m (10 nF), ruído de 1 V a 1 kHz, pull-up 10k/12 V: sem disparo falso (GPIO parado ≤ 0,035 V), pulso lido com 20,0 ms, saída puxa o sinal a 0,02 V em < 1 µs.

## 2. Programa da placa Bluetooth v0.4 (protocolo 2) — `firmware/`
O próprio arquivo do firmware compilado com "stubs" de Arduino/BLE (OpenSSL no lugar do mbedtls), máquina virtual,
maquininha virtual e servidor falso com as regras da tel-sync v3 (`sim_servidor.h`).
Compilar: baixar `ArduinoJson-v7.2.1.h` (GitHub, bblanchon/ArduinoJson) como `stubs/ArduinoJson.h`, copiar
`../firmware/telemetria_mvtoy_ble/telemetria_mvtoy_ble.ino` para `telemetria_mvtoy_ble.cpp` e rodar:
`g++ -std=c++17 -include stubs/Arduino.h -Istubs -I. -DARDUINO=10819 -DARDUINOJSON_ENABLE_PROGMEM=0 -DARDUINOJSON_ENABLE_ARDUINO_PRINT=0 -DARDUINOJSON_ENABLE_ARDUINO_STREAM=0 -DARDUINOJSON_ENABLE_ARDUINO_STRING=1 sim_placa.cpp -o sim_placa -lcrypto && ./sim_placa`
Resultado (20/11, revisão): **23/23** — sem configuração, relógio, economia (nada em 250 s parado; 1 sinal de vida em 5 min),
moedas com repique, confirmação FALSA pelo Bluetooth não apaga moedas, resposta perdida sem contar duas vezes, Pix de 3
jogadas com confirmação na hora, créditos falsos (hora trocada, sem assinatura, chave errada), resposta Pix antiga depois de
25 créditos recusada, queda de energia com 4 moedas guardadas, celular curioso derrubado em 90 s, limites.
Tamanho no Bluetooth (pior caso): pacote 405 bytes, resposta 430 bytes (limite 512).

### Placa Wi-Fi v0.3 (piloto) — `sim_wifi.cpp` (copiar o .ino como `telemetria_mvtoy_wifi.cpp`)
**10/10**: relógio no 1º contato, economia (3 chamadas/min em vez de 12), moedas com repique, resposta perdida, Pix de 3
jogadas, alguém na rede do ponto fingindo ser o servidor (nenhum crédito falso, moedas preservadas), Wi-Fi caindo + queda
de energia sem perder moedas.

## 3. Servidor tel-sync v3 (chamadas reais pelo banco) — 20/11
Dois pedidos idênticos ao mesmo tempo com 4 moedas → contadas 1 vez (total 8 → 12, 1 evento); confirmação `a` e créditos `s`
conferem com o HMAC calculado no banco; `envio_s` = 300 para Bluetooth; corpo alterado → 401.

## 4. Caixa 3D (malha e encaixe, trimesh)
Base e tampa fechadas (1 corpo cada), colisão base × tampa = 0, placa+peças × caixa = 0, 4 furos alinhados.
Revisão achou e corrigiu: âncoras dos fios com a parte de cima solta, aba da tampa raspando nas torres, malha da base aberta,
instrução de impressão da tampa (imprimir de cabeça para baixo).

## Limites conhecidos
- Moeda que cair no mesmo segundo de uma queda de energia pode não ser guardada (a placa grava no máximo 1x/s).
- Moeda inserida enquanto a placa solta um crédito (≈ 0,15 s por pulso) não é contada pela telemetria (a máquina conta normal).
- Picos acima de 45 V no fio de sinal: a placa final tem TVS; no piloto, cuidado na instalação.
- Compilação real para ESP32 ainda não verificada aqui (o pacote da Espressif não baixa neste ambiente): o montador compila na Arduino IDE.
