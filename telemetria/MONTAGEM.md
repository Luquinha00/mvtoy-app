# Telemetria MV Toy — montagem do piloto (para o montador)

Versão 5 · 23/11/2026 · placa perfurada com peças prontas. [VALIDAR] = conferir na máquina antes.

## 1. Lista de compra (1 placa + reservas)
| Qtd | Peça | Onde comprar (busca no Mercado Livre) |
|---|---|---|
| 2 | ESP32 DevKit V1 (ESP32-WROOM-32, 30 pinos) — **de preferência com chip USB CP2102** (escrito no anúncio): o Windows reconhece sem instalar driver. Se vier com CH340, instale o driver CH340 antes de gravar | https://lista.mercadolivre.com.br/esp32-wroom-devkit-30-pinos-cp2102 |
| 2 | Transistor BC337 (NPN, saída) — 1 + 1 reserva | https://lista.mercadolivre.com.br/bc337 |
| 1 | Diodo Schottky 1N5819 (protege se ligar 12V e GND invertidos) | https://lista.mercadolivre.com.br/1n5819 |
| 1 | Conversor step-down LM2596 (com trimpot) ou MP1584 | https://lista.mercadolivre.com.br/step-down-lm2596 |
| 1 pct | Resistores 1/4 W: 1 kΩ, 10 kΩ, 47 kΩ, 100 kΩ (kit sortido serve) | https://lista.mercadolivre.com.br/kit-resistores-1-4w |
| 4 | Transistor BC547 (NPN) — 1 por entrada (moeda, nota, prêmio) + 1 reserva | https://lista.mercadolivre.com.br/bc547 |
| 1 | Placa perfurada (ilhada) 5×7 cm | https://lista.mercadolivre.com.br/placa-perfurada-ilhada-5x7 |
| 1 | Barra de pinos fêmea 40 vias (para o ESP32 encaixar, sem soldar direto) | https://lista.mercadolivre.com.br/barra-pinos-femea-2.54 |
| 1 | Borne de parafuso 2,54/5,08 mm de 4 vias (entrada: 12V · GND · SINAL) | https://lista.mercadolivre.com.br/borne-kre-4-vias |
| 1 | Caixa impressa em 3D em PETG ou ABS (`hardware/caixa/caixa_telemetria_mvtoy_base.stl` e `_tampa.stl`) — ou caixa patola ~8×5×3 cm | gráfica 3D local |
| 4+4 | Parafusos auto-atarraxantes M2×6 (placa) e M3×8 (tampa) | https://lista.mercadolivre.com.br/parafuso-m2-auto-atarraxante |
| — | Fio cabinho fino, espaguete termo-retrátil, abraçadeiras | |
| 1 | Cabo USB de dados (para gravar) | |

Custo estimado das peças: R$ 150 a R$ 250 com reservas [VALIDAR no carrinho]. Caixa 3D: serviço de impressão local, PETG, ~R$ 30–60 [VALIDAR].

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
### Entradas extras (opcionais, já no programa v0.5/v0.4): noteiro e prêmio
Na garra, o conector branco da placa-mãe vem escrito: GND · GND · GND · **COINA** · **COINB** · **OUT** · L1 · 12V · 12V · IN · 12V · **Sensor**.
- **COINA** = moedeiro → é o SINAL do mapa acima (entrada GPIO 27 e saída de crédito).
- **COINB** = noteiro / 2º moedeiro → monte um 2º circuito de entrada igual (47k + 100k + BC547 + 10k) e ligue o coletor no **GPIO 25**.
- **OUT ou Sensor** = sensor do prêmio saindo [VALIDAR qual dos dois com o multímetro: deve mudar quando cai uma pelúcia] → 3º circuito de entrada igual, coletor no **GPIO 33**.
Sem fio nessas entradas, a placa simplesmente não conta (não atrapalha). Meça antes: tensão parado e na hora do pulso, como no item 2.

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
