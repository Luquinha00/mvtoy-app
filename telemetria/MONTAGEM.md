# Telemetria MV Toy — montagem do piloto (para o montador)

Versão 1 · 20/11/2026 · placa perfurada com peças prontas. [VALIDAR] = conferir na máquina antes.

## 1. Lista de compra (1 placa + reservas)
| Qtd | Peça | Como procurar no Mercado Livre |
|---|---|---|
| 2 | ESP32 DevKit V1 (ESP32-WROOM-32, 30 pinos, micro-USB ou USB-C) | "esp32 wroom devkit 30 pinos" |
| 2 | Transistor BC337 (NPN, saída) — 1 + 1 reserva | "bc337" |
| 1 | Diodo Schottky 1N5819 (protege se ligar 12V e GND invertidos) | "1n5819" |
| 1 | Conversor step-down LM2596 (com trimpot) ou MP1584 | "step down lm2596" |
| 1 pct | Resistores 1/4 W: 1 kΩ, 10 kΩ, 47 kΩ, 100 kΩ (kit sortido serve) | "kit resistores 1/4w" |
| 2 | Transistor BC547 (NPN) | "bc547" |
| 1 | Placa perfurada (ilhada) 5×7 cm | "placa perfurada ilhada 5x7" |
| 1 | Barra de pinos fêmea 40 vias (para o ESP32 encaixar, sem soldar direto) | "barra pinos femea 2.54" |
| 1 | Borne de parafuso 2,54/5,08 mm de 4 vias (entrada: 12V · GND · SINAL) | "borne kre 4 vias" |
| 1 | Caixa impressa em 3D em PETG ou ABS (`hardware/caixa/caixa_telemetria_mvtoy_base.stl` e `_tampa.stl`) — ou caixa patola ~8×5×3 cm | gráfica 3D local |
| 4+4 | Parafusos auto-atarraxantes M2×6 (placa) e M3×8 (tampa) | "parafuso m2 auto atarraxante" |
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
MÁQUINA (chicote)         TELEMETRIA MV TOY
 12V  ──► diodo 1N5819 (faixa para o lado do step-down) ──► IN+ step-down ──(5,0 V)──► OUT+ ──► VIN do ESP32
 GND  ───────────────┬──► IN- step-down ── OUT- ──► GND do ESP32
                     ├──► BC547 emissor (E)
                     ├──► resistor 100k ──► BC547 base (B)
                     └──► BC337 emissor (E)
 SINAL ──────────────┬──► resistor 47k ──► BC547 base (B)
                     └──► BC337 coletor (C)

 ESP32 GPIO 27 ◄──┬───── BC547 coletor (C)            (entrada: lê a moeda)
 ESP32 3V3 ──► resistor 10k ──┘
 ESP32 GPIO 26 ──► resistor 1k ──► BC337 base (B)     (saída: solta o crédito)
```
BC547 e BC337: com a parte reta virada para você, pernas da esquerda para a direita = C, B, E (BC337: confira no anúncio, alguns são C-B-E e outros E-B-C).
Por que transistores: a simulação elétrica (pasta simulacao/) mostrou que a entrada funciona de 5 a 24 V sem ajuste e que o optoacoplador PC817 na saída FALHA em máquinas com sinal "forte" (ex.: 12 V com pull-up de 1k); o BC337 puxa o sinal a menos de 0,1 V em todos os casos.

O moedeiro **continua ligado** no chicote como sempre: a placa fica em paralelo (se ela falhar, a moeda funciona).

## 4. Ordem de montagem
1. Ajuste o step-down **sozinho**: ligue 12 V na entrada e gire o trimpot até a saída marcar **5,0 V** no multímetro. Só depois ligue no ESP32.
2. Solde na placa perfurada: barra fêmea do ESP32, o BC547 (entrada), o BC337 (saída), os 4 resistores e o borne de 3–4 vias.
3. Faça as ligações do mapa com fio fino. Confira cada ligação com o multímetro (modo continuidade, o "bip").
4. Encaixe o ESP32 na barra fêmea, de preferência com o USB virado para a ponta direita da placa (abertura de USB da caixa), e isole com termo-retrátil.
5. Caixa 3D: parafuse a placa nos 4 pinos (M2), passe os fios pela entrada da ponta esquerda, prenda com abraçadeira nas 2 âncoras e feche a tampa (4× M3). Imprimir a tampa **de cabeça para baixo** (texto na mesa). Imprima 1 caixa primeiro e confira o encaixe antes de imprimir várias.

## 5. Gravação (uma vez, no notebook)
1. Arduino IDE → Placa "ESP32 Dev Module" → bibliotecas **ArduinoJson** (7.x) e **WiFiManager** (tzapu).
2. **Piloto (agora):** gravar `firmware/telemetria_mvtoy_wifi/telemetria_mvtoy_wifi.ino` (versão Wi-Fi), porque o app da maquininha ainda depende do PagBank.
   Na primeira vez a placa abre a rede "TELEMETRIA-MV-xxxx": conecte o celular, escolha o Wi-Fi do ponto e cole o número e a chave da placa (app › Telemetria › Placa nova).
3. **Depois (com o app da maquininha pronto):** gravar `firmware/telemetria_mvtoy_ble/telemetria_mvtoy_ble.ino` (Bluetooth) e, no Monitor Serial (115200), digitar `CFG TMV-0001 <chave>`. Daí em diante tudo é feito pela maquininha.

## 6. Teste na bancada (sem máquina)
- Fonte 12 V no borne, LED do ESP32 acende.
- Com um fio, encoste SINAL no GND rapidamente → conta 1 moeda (aparece no app › Telemetria em "Moedas hoje" em até ~30 s: a placa agrupa as moedas para economizar servidor).
- No app › Telemetria › Crédito → com o multímetro entre SINAL e GND, a tensão cai a 0 V por um instante.

## 7. Teste na máquina
Instale no chicote, no app › Telemetria › "Ligar placa à máquina" (QR da placa) e faça o **crédito de teste**: a máquina tem que mostrar 1 crédito. Coloque 1 moeda: tem que contar 1 crédito **e** aparecer no app.
Anote para o desenho da placa definitiva: modelo da máquina, tensão do SINAL, duração do pulso que funcionou, tipo de conector do chicote (foto).
