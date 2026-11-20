# Placa MV — montagem do piloto (para o montador)

Versão 1 · 20/11/2026 · placa perfurada com peças prontas. [VALIDAR] = conferir na máquina antes.

## 1. Lista de compra (1 placa + reservas)
| Qtd | Peça | Como procurar no Mercado Livre |
|---|---|---|
| 2 | ESP32 DevKit V1 (ESP32-WROOM-32, 30 pinos, micro-USB ou USB-C) | "esp32 wroom devkit 30 pinos" |
| 1 pct | Optoacoplador PC817 DIP-4 (pacote de 10) | "pc817 dip4 10 peças" |
| 1 | Conversor step-down LM2596 (com trimpot) ou MP1584 | "step down lm2596" |
| 1 pct | Resistores 1/4 W: 330 Ω, 2,2 kΩ (kit sortido serve) | "kit resistores 1/4w" |
| 1 | Placa perfurada (ilhada) 5×7 cm | "placa perfurada ilhada 5x7" |
| 1 | Barra de pinos fêmea 40 vias (para o ESP32 encaixar, sem soldar direto) | "barra pinos femea 2.54" |
| 1 | Borne de parafuso 2,54/5,08 mm de 4 vias (entrada: 12V · GND · SINAL) | "borne kre 4 vias" |
| 1 | Caixinha plástica patola ~8×5×3 cm | "caixa patola pequena" |
| — | Fio cabinho fino, espaguete termo-retrátil, abraçadeiras | |
| 1 | Cabo USB de dados (para gravar) | |

Ferramentas (se o montador não tiver): ferro de solda 40–60 W com estanho 0,8 mm, multímetro, alicate de corte, sugador de solda.

## 2. Antes de tudo: medir a máquina (multímetro) [VALIDAR em cada modelo]
No chicote do moedeiro, com a máquina ligada:
1. Ache **12 V** (vermelho/amarelo) e **GND** (preto): 12 V entre eles.
2. Ache o **SINAL** (branco/azul/verde): meça entre SINAL e GND **parado** → anote (normalmente 5 V ou 12 V).
3. Coloque uma moeda e veja o crédito entrar → o SINAL cai a ~0 V por um instante (é o pulso).
Se o SINAL parado for 0 V e subir na moeda (lógica invertida), **pare e avise**: muda a ligação.

## 3. Mapa de ligação
```
MÁQUINA (chicote)         PLACA MV
 12V  ───────────────┬──► IN+ step-down ──(5,0 V)──► OUT+ ──► VIN do ESP32
                     │
                     └──► resistor 2,2k ──► PC817 #1 pino 1
 GND  ───────────────┬──► IN- step-down ── OUT- ──► GND do ESP32
                     ├──► PC817 #1 pino 3
                     ├──► PC817 #2 pino 2
                     └──► PC817 #2 pino 3
 SINAL ──────────────┬──► PC817 #1 pino 2
                     └──► PC817 #2 pino 4

 ESP32 GPIO 27 ◄──────── PC817 #1 pino 4        (entrada: lê a moeda)
 ESP32 GPIO 26 ──► resistor 330 ──► PC817 #2 pino 1   (saída: solta o crédito)
```
PC817 visto de cima, bolinha/marca no canto: **pino 1** = ânodo (marca) · **2** = cátodo (embaixo do 1) · **3** = emissor (em frente ao 2) · **4** = coletor (em frente ao 1).

O moedeiro **continua ligado** no chicote como sempre: a placa fica em paralelo (se ela falhar, a moeda funciona).

## 4. Ordem de montagem
1. Ajuste o step-down **sozinho**: ligue 12 V na entrada e gire o trimpot até a saída marcar **5,0 V** no multímetro. Só depois ligue no ESP32.
2. Solde na placa perfurada: barra fêmea do ESP32, os 2 PC817, os 2 resistores, o borne de 3–4 vias.
3. Faça as ligações do mapa com fio fino. Confira cada ligação com o multímetro (modo continuidade, o "bip").
4. Encaixe o ESP32 na barra fêmea, isole com termo-retrátil e feche na caixinha (furo para os fios e para ver o LED azul).

## 5. Gravação (uma vez, no notebook)
1. Arduino IDE → Placa "ESP32 Dev Module" → bibliotecas **ArduinoJson** (7.x) e **WiFiManager** (tzapu).
2. **Piloto (agora):** gravar `firmware/placa_mv/placa_mv.ino` (versão Wi-Fi), porque o app da maquininha ainda depende do PagBank.
   Na primeira vez a placa abre a rede "PLACA-MV-xxxx": conecte o celular, escolha o Wi-Fi do ponto e cole o número e a chave da placa (app › Placas › Placa nova).
3. **Depois (com o app da maquininha pronto):** gravar `firmware/placa_mv_ble/placa_mv_ble.ino` (Bluetooth) e, no Monitor Serial (115200), digitar `CFG MVP-0001 <chave>`. Daí em diante tudo é feito pela maquininha.

## 6. Teste na bancada (sem máquina)
- Fonte 12 V no borne, LED do ESP32 acende.
- Com um fio, encoste SINAL no GND rapidamente → conta 1 moeda (aparece no app › Placas em "Moedas hoje").
- No app › Placas › Crédito → com o multímetro entre SINAL e GND, a tensão cai a 0 V por um instante.

## 7. Teste na máquina
Instale no chicote, no app › Placas › "Ligar placa à máquina" (QR da placa) e faça o **crédito de teste**: a máquina tem que mostrar 1 crédito. Coloque 1 moeda: tem que contar 1 crédito **e** aparecer no app.
Anote para o desenho da placa definitiva: modelo da máquina, tensão do SINAL, duração do pulso que funcionou, tipo de conector do chicote (foto).
