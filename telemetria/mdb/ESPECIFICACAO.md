# Telemetria MV Toy · linha MDB (vending machines) — especificação v0.1 (23/11/2026)

A Telemetria MV Toy passa a ter **duas linhas** no mesmo app, servidor e banco:

| Linha | Máquinas | Como lê | Placa |
|---|---|---|---|
| **Pulso** | garra, soco, basquete, fliperama, carro | pulsos do moedeiro/noteiro + sensor de prêmio; solta crédito por pulso | TMV-0001… (já em montagem) |
| **MDB** | vending machines (SmartMach Splendor/Elegance, refrigeradas, snacks) | conversa digital MDB com a placa da máquina (VMC): cada venda vem com **seleção e preço** | TMD-0001… (esta especificação) |

O que é igual nas duas: ESP32, envio econômico e assinado (protocolo 2), servidor `tel-sync`, app (aba Telemetria › Pulso | MDB), QR só com o número da placa.

## 1. Referência: placa MDB da PagPlush (fotos de 23/11/2026)

Usada só como referência de funções. **Não copiamos a placa nem o programa deles.** O que dá para ver nas fotos:

- **ESP32-WROOM-32** ("Devkit esp32 v4.0" na serigrafia) e um conector de gravação "RECORD" (TX, RX, 3V3, IO0, GND, EN).
- **Dois conectores brancos de 6 vias (2×3)**, "MBD1" e "MBD2/DEX". A placa entra **no meio do chicote MDB**: um lado vai para a máquina e o outro segue para os outros aparelhos. Blocos de jumpers "MDB" e "DEX" escolhem se o 2º conector repassa o MDB ou faz a leitura de auditoria DEX.
- **Isolamento óptico** (componentes de 4 pernas perto dos capacitores) entre a placa e a linha MDB, como pede o padrão.
- **Fonte de 24–34 V para 5 V**: regulador chaveado (TO-263), indutor "470", diodo, 2× 470 µF 50 V e 2× 100 µF 35 V.
- **Relé Songle** com borne NA/C/NF e borne de 4 vias "INPUT / INPUT1" (GND/VIN), ou seja, a mesma placa também lê pulsos e solta crédito por pulso.
- **USB-A fêmea** com um chip ao lado, provavelmente para alimentar e/ou conversar com a maquininha [hipótese].
- Barra de pinos com GPIOs livres (05, 18, 19, 21, 22, 13, 14, 15, 26, 27, 34, 35, 36, 39), buzzer, botão e 2 LEDs.
- Etiqueta "PAGBOX-xxxxxx" com QR atrás.

Leitura: a PagPlush fez **uma placa que serve para pulso e para MDB**. Para nós, isso confirma o caminho de ter as duas linhas com a mesma base (ESP32, fonte, servidor e app) e mudar só a parte que conversa com a máquina.

### 1b. Referência 2: placa MDB_V33.0 da máquina de capacete (fotos de 23/11/2026)

- Placa preta "MDB_V33.0" com um **STM32**.
- Conectores: 6 vias (2×3) MDB/"GND TX RX"; alimentação 12/24 V; serial de 4 vias "GND RX TX 5V" para a placa principal; e "DIO-GND-CLK-3V3" para gravar.
- Funciona como **conversor MDB ↔ serial**. Isso confirma o caminho (B) deste documento: um STM32 cuida do MDB e o ESP32 cuida da internet.
- O programa é gravado com o **ST-LINK V2** ligado no notebook, usando o STM32CubeProgrammer (gratuito). Ligação: SWDIO→DIO, GND→GND, SWCLK→CLK, 3,3V→3V3.
- No verso alguém escreveu "Ruim PT" à mão [VALIDAR se a placa está com defeito].
- Registro completo e fotos: Drive › 06. Operação_MV Toy › "Referências de placas — Máquina de capacete (MDB) e PagPlush MDB · 23-11-2026".

## 2. O padrão MDB (o essencial)

- MDB/ICP (NAMA), versão 4.x. A placa da máquina (VMC) é a mestra e chama os aparelhos pelo endereço. Exemplos: moedeiro 08h, noteiro 30h, **leitor cashless nº 1: 10h**, cashless nº 2: 60h.
- Comunicação serial de **9.600 bps, 8 bits de dado + 1 "bit de modo" (9º bit)**, 1 start e 1 stop.
- Conector de 6 vias. Pinagem do padrão: 1 = +V (cerca de 34 V), 2 = retorno (GND), 3 = sem uso, 4 = Master Receive, 5 = Master Transmit, 6 = comum da comunicação. **[VALIDAR com multímetro na máquina SmartMach antes de ligar.]**
- Venda no leitor cashless: o VMC pede **VEND REQUEST (preço + número da seleção)**, o leitor responde VEND APPROVED ou DENIED, a máquina entrega e manda **VEND SUCCESS (seleção)**. É daqui que vem a telemetria por produto.

## 3. Nossa placa MDB: dois modos

**Modo 1 — Escuta (fase 1, recomendado começar por aqui).** A placa só **ouve** a linha MDB, isolada, sem responder nada. Ela registra cada venda (seleção, preço e forma: moeda, nota ou cartão) e manda ao servidor.
- Não muda nada na máquina e não substitui o leitor de cartão que já está nela.
- É a forma mais segura de colocar nas SmartMach sem mexer no sistema deles.

**Modo 2 — Leitor cashless (fase 2).** A placa vira o "leitor de cartão" da máquina (endereço 10h ou 60h): o cliente paga no Pix (QR) ou na maquininha, e a placa aprova a venda.
- Só depois do modo 1 validado.
- Só com o OK do contrato SmartMach: a máquina vem com a licença e o sistema deles, e trocar o leitor pode afetar garantia e suporte [VALIDAR no contrato].

## 4. Hardware proposto (v0.1, para protótipo de bancada)

- **ESP32** (o mesmo da linha pulso).
- **Fonte**: a entrada MDB chega a cerca de 34 V, então o conversor precisa aguentar mais que isso (ex.: LM2596**HV** ou outro buck de 60 V; o LM2596 comum vai só até 40 V). Fusível e diodo de proteção na entrada.
- **Interface MDB isolada**: optoacopladores rápidos na recepção (escuta das duas linhas) e, no modo 2, na transmissão.
- **2 conectores de 6 vias (2×3)** para entrar no meio do chicote, com o modelo exato a confirmar na máquina [VALIDAR medida e modelo].
- **9º bit no ESP32**: o ESP32 não tem 9 bits nativos. Dois caminhos, a testar em bancada:
  - (A) usar a paridade da serial como 9º bit, como fazem projetos abertos de MDB com ESP32;
  - (B) um microcontrolador pequeno só para o MDB (ex.: ATmega328 ou STM32, que têm 9 bits), ligado ao ESP32.
  Começar por (A); se perder bytes na escuta, ir para (B). A placa da máquina de capacete usa justamente o (B), com um STM32 gravado pelo ST-LINK V2.
- **Opcional**: relé e 2 entradas de pulso (como a PagPlush), para uma futura placa "universal".

## 5. Software

- **Servidor e banco já preparados (23/11)**: coluna `tipo` (pulso ou mdb) nas placas; placas MDB numeradas TMD-0001…; evento novo `venda` com `item` (seleção) e `valor`; o app mostra "Vendas hoje" na aba MDB.
- **Firmware MDB (próximo)**: mesmo protocolo 2 da linha pulso. O pacote leva `vendas:[{item, valor, meio}]` no lugar de moedas.
- **App**: aba Telemetria com "Máquinas de pulso" e "Vending MDB". Na MDB não aparece o botão Crédito, porque o crédito na MDB é a fase 2.

## 6. Próximos passos

1. **Na máquina SmartMach, com o montador:**
   - foto do conector MDB da placa da máquina, com régua;
   - tensão entre os pinos 1 e 2;
   - modelo do leitor de cartão que já vem instalado.
2. Protótipo de escuta na bancada: ESP32, 2 optos, buck HV, conectores. Teste ligado em paralelo, só ouvindo.
3. Firmware de escuta MDB e evento `venda` no tel-sync.
4. Ler o contrato SmartMach sobre a troca do leitor (para a fase 2).

Revisado pelo Supervisor de Qualidade: pendente.
