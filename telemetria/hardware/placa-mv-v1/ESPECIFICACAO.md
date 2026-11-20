# Placa MV v1 — modelo final (comercial e máquinas próprias)

Versão do desenho 0.1 · 20/11/2026 · autor: CEO MV Toy (IA) · revisão de engenheiro eletrônico: PENDENTE.
[VALIDAR] = depende das fotos e medições das máquinas (conector do chicote, tensão do sinal).

## 1. O que a placa faz
Fica em paralelo no chicote do moedeiro/noteiro. Lê as moedas (entrada) e solta crédito pago (saída), conversando por **Bluetooth com a maquininha** (padrão) ou Wi-Fi (plano B). Uma placa só serve para máquina de 5 V, 12 V ou 24 V, sem ajuste. O sentido do pulso da entrada é escolhido no app (sem jumper).

## 2. Blocos
| Bloco | Solução | Por quê |
|---|---|---|
| Cérebro | **ESP32-C3-WROOM-02** (módulo, Wi-Fi + Bluetooth 5) | Mais barato que o ESP32 clássico, tem USB nativo (grava sem chip extra), módulo já certificado pela fábrica [VALIDAR homologação Anatel do módulo] |
| Alimentação | Entrada 9–24 V da máquina → fusível rearmável 500 mA → diodo de proteção contra inversão → TVS 24 V → regulador buck 3,3 V (ex.: família MP1584/TPS54202, 1 A) | Aguenta 12 V e 24 V, picos da máquina e ligação invertida sem queimar |
| Entrada (moeda) | Transistor NPN (MMBT3904) com resistor de base 47 kΩ + 100 kΩ base-emissor; coletor com pull-up 10 kΩ ao 3,3 V | Liga qualquer sinal de 1,5 a 24 V sem ajuste e quase não "pesa" no fio do moedeiro. (O optoacoplador na entrada foi descartado: com sinal de 5 V e alimentação de 12 V ele ficaria aceso parado.) |
| Saída (crédito) | Transistor NPN MMBT2222A/BC817 (coletor aberto, até 500 mA) com resistor de base 1 kΩ | Puxa o sinal a < 0,1 V com qualquer tensão e pull-up (simulado). O optoacoplador foi descartado: com pull-up forte (12 V/1k) ele não chega a 0 V |
| Sentido do pulso | Configurado no app por máquina (padrão: pulso "para baixo") | Sem jumper para o técnico errar |
| Conectores | Borne de parafuso 4 vias (12V · GND · SINAL · SINAL-2) + posição para conector igual ao do chicote [VALIDAR pela foto] | Instalação sem cortar fio |
| USB-C | Gravação e teste na bancada | Sem cabo especial |
| Interface | LED azul (online), LED verde (pulso), botão BOOT | Diagnóstico pelo técnico |
| Etiqueta | Área branca na serigrafia para o QR com o número da placa (MVP-xxxx) | Pareamento pela maquininha |
| Tamanho | ~50 × 35 mm, 2 camadas, 4 furos de fixação M3 | Cabe na caixinha patola pequena |

## 3. Ligações (netlist)
| Rede | Liga |
|---|---|
| VIN | J1-1 (12V) → F1 → D1 (anodo→catodo) → VIN; TVS1 entre VIN e GND; C entrada 10 µF/35 V; U2 (buck) IN |
| GND | J1-2, U2 GND, U1 GND, emissores, C saídas |
| 3V3 | U2 OUT (via indutor e capacitores do datasheet, 3,3 V) → U1 3V3, pull-ups, LEDs |
| SINAL | J1-3 (e J1-4 em paralelo para máquinas com 2 fios de pulso) |
| ENTRADA | SINAL → R1 47k → base Q1 (MMBT3904); R2 100k base→GND; emissor Q1 → GND; coletor Q1 → GPIO4 + R3 10k → 3V3. Sinal parado alto → GPIO4 = 0; moeda (sinal a 0 V) → GPIO4 = 1 (borda de subida) |
| SAÍDA | GPIO5 → R4 1k → base Q2 (MMBT2222A); emissor Q2 → GND; coletor Q2 → SINAL; R5 100k base→GND (desligado garantido no boot) |
| LEDs | GPIO6 → R 1k → LED azul → GND ; GPIO7 → R 1k → LED verde → GND |
| BOOT/EN | Botão GPIO9 → GND (com R 10k pull-up); EN com RC 10k/1 µF |
| USB | USB-C D+/D− → GPIO19/GPIO18 do ESP32-C3; CC1/CC2 com 5,1k → GND; VBUS → diodo → entrada do buck (alimenta pela USB na bancada) |

Firmware: trocar os pinos para GPIO4 (entrada, interrupção na SUBIDA para pulso "para baixo"), GPIO5 (saída), GPIO6/7 (LEDs) e placa "ESP32C3 Dev Module" (USB CDC ligado). Código já pronto em `firmware/placa_mv_ble/`.

## 4. Lista de peças (para a fábrica montar — catálogo LCSC/JLCPCB)
Códigos LCSC exatos a confirmar na hora do pedido [VALIDAR estoque], preferindo peças "Basic" (sem taxa extra):
| Ref | Peça | Qtd |
|---|---|---|
| U1 | ESP32-C3-WROOM-02 (4 MB) | 1 |
| U2 | Regulador buck 3,3 V até 24 V de entrada (ex.: TPS54202 ou MP1584) + indutor e capacitores do datasheet | 1 |
| Q1 | MMBT3904 (SOT-23) — entrada | 1 |
| Q2 | MMBT2222A (SOT-23) — saída | 1 |
| F1 | Fusível rearmável 500 mA (1206) | 1 |
| D1, D2 | Diodo Schottky SS34 | 2 |
| TVS1 | SMBJ24A | 1 |
| R | 1 kΩ (×3), 5,1 kΩ (×2), 10 kΩ (×3), 47 kΩ, 100 kΩ (×2) — 0603 | 11 |
| C | 10 µF/35 V, 22 µF, 100 nF (×4), 1 µF — 0805/0603 | 7 |
| LED | Azul e verde 0603 | 2 |
| SW | Botão tátil SMD | 1 |
| J1 | Borne de parafuso 4 vias 5,08 mm (montado à mão ou pela fábrica) | 1 |
| J2 | USB-C 16 pinos (só alimentação + dados) | 1 |

## 5. Plano de produção
1. Desenho da placa (KiCad) → arquivos de fabricação (Gerber + lista de peças + posição) — agente.
2. Revisão de 1–2 h por engenheiro eletrônico (R$ 300–600 [VALIDAR]) — antes de pagar o lote.
3. Lote 1: **5 placas montadas** pela fábrica → teste em 3 máquinas (garra, soco, fliperama) por 2–4 semanas.
4. Lote comercial: 50–100 placas. Etiquetas QR impressas, caixinha, gravação e teste na bancada pelo montador.
5. Anatel: confirmar com especialista se a venda da placa ao franqueado exige homologação do produto (Bluetooth/Wi-Fi), mesmo com módulo certificado.

## 6. Pendências que fecham o desenho
- Foto do conector do chicote do moedeiro (frente e lado) e de uma PAGBox instalada.
- Medição do SINAL parado (garra e soco): 5 V ou 12 V; e se cai a 0 V na moeda.
- Revisão de engenheiro (contratar após o desenho pronto).

## 7. Decisões de projeto (registro)
- Entrada sem optoacoplador: o GND já é comum (o regulador liga o GND da máquina ao da placa), então isolamento total não existe de qualquer jeito; o transistor resolve 5/12/24 V sem jumper.
- Saída só "para baixo" (coletor aberto), que é o padrão dos moedeiros e noteiros de pulso. Máquina com pulso "para cima" na saída: não suportada na v1 [VALIDAR se existe na rede].
- Saída por transistor NPN (não optoacoplador): simulação ngspice (telemetria/simulacao/saida.cir) — PC817 com CTR 50–200% não puxa o sinal a 0 V em 12 V/1k e 24 V/1k–4,7k; NPN fica abaixo de 0,1 V em todos os casos.
- Entrada simulada (simulacao/entrada.cir): 5/12/24 V × pull-up 1k/4,7k/10k → GPIO 0,03–0,05 V parado e 3,3 V na moeda; a carga da placa baixa o sinal parado no máximo 15% (5 V/10k → 4,24 V, acima do limite lógico de 3,5 V).
