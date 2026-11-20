# Telemetria própria MV (Placa MV) — piloto

Estudo e decisões: Drive › 05. MV Toy › 06. Operação_MV Toy › "Tecnologia — Telemetria própria MV Toy" (Central C-0393).

## Como funciona
1. A **Placa MV** (ESP32 + 2 isoladores PC817) fica entre o moedeiro e a placa da máquina.
2. A cada ~5 s ela chama `tel-sync` (Supabase Edge Function) com assinatura HMAC: manda as moedas lidas, recebe os créditos pagos.
3. Crédito pago (teste/remoto agora; Pix/cartão depois) entra em `mvt_tel_creditos`; a placa manda os pulsos e confirma. Cada crédito só é executado uma vez (a placa guarda os últimos 20 na memória).
4. Moedas lidas viram eventos em `mvt_tel_eventos` (tipo `moeda`), com o valor do pulso da máquina.

## Arquivos
- `firmware/placa_mv/placa_mv.ino` — programa da placa (Arduino IDE, ESP32, bibliotecas ArduinoJson 7 e WiFiManager 2). O mesmo programa serve para todas as placas: Wi-Fi, PLACA_ID e PLACA_SEGREDO são configurados pelo celular (rede "PLACA-MV-xxxx").
- `supabase/tel-sync/index.ts` — função do servidor.
- `sql/2026-11-20_mvt_telemetria.sql` — tabelas e funções (placas, créditos, eventos, parear, crédito remoto, status).

## Lista de peças do piloto (1 máquina) [VALIDAR preços]
- ESP32 DevKit V1 (30 pinos)
- 2× módulo optoacoplador PC817 (ou 2× PC817 + 2× resistor 1k)
- Conversor step-down 12 V → 5 V (ex.: LM2596 ou mini MP1584)
- Conectores/fios no padrão do moedeiro (12V · GND · SINAL), caixinha plástica, fita dupla-face
- Multímetro (para conferir o fio de sinal antes de ligar)

## Instalação (técnico)
1. Máquina desligada. Identificar no chicote do moedeiro: 12 V, GND e SINAL (CREDIT/COIN).
2. Ligar a Placa MV em paralelo com o moedeiro (o moedeiro continua funcionando).
3. Ligar a máquina. Placa nova: conectar o celular na rede "PLACA-MV-xxxx", escolher o Wi-Fi do ponto e colar PLACA_ID e PLACA_SEGREDO (app › Placas › Placa nova). Esperar o LED azul piscar (online). Trocar de Wi-Fi: segurar o botão BOOT 5 s ao ligar.
4. No app MV Toy: Placas › ler o QR da placa › escolher a máquina › valor do pulso.
5. Botão "crédito de teste (1)" → a máquina tem que mostrar 1 crédito. Só então a instalação está ok.

## Ainda falta
- Tela "Placas" no app (parear por QR, crédito de teste/remoto, online/offline).
- Pix pelo PagBank (QR dinâmico) gerando crédito automático; app da maquininha (PlugPag).
- Placa sem Wi-Fi do ponto: módulo 4G ou internet da maquininha [VALIDAR].
- Fixar o certificado do servidor no firmware (hoje `setInsecure` no piloto).
