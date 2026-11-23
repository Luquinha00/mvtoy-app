# Telemetria MV Toy (telemetria própria) — v0.4 · protocolo 2 · 20/11/2026

> **Duas linhas (23/11/2026):** **Pulso** (garra, soco, basquete, fliperama · placas TMV-…, tudo abaixo) e **MDB** (vending machines · placas TMD-…, ver `mdb/ESPECIFICACAO.md`). Mesmo app, servidor e banco; o banco guarda a linha na coluna `tipo` e as vendas MDB como evento `venda` (seleção + preço).


Produto para as máquinas próprias, para a rede de franquia e para venda a operadores de fora
(modelo PagPlush: implantação R$ 600 + R$ 60/mês por máquina). Estudo: Drive › 06. Operação_MV Toy (Central C-0393).

## Arquitetura (regra do Lucas)
- **A maquininha é a central** (modo operador com senha de 4 dígitos: Wi-Fi, ligar placa pelo QR, jogadas, crédito de teste).
  A placa só encaixa no chicote do moedeiro: sem botão, sem configuração pelo celular.
- Placa ↔ maquininha: **Bluetooth (BLE)** — `firmware/telemetria_mvtoy_ble/` (v0.4).
- Maquininha ↔ servidor: internet da própria maquininha → `tel-sync` (Supabase Edge Function, v3).
- Versão Wi-Fi (`firmware/telemetria_mvtoy_wifi/`, v0.3): **só piloto/plano B**, a placa fala direto com o servidor.
- Gravação na bancada (uma vez): `CFG TMV-0001 <chave>` no Monitor Serial (app › Telemetria › Placa nova gera a linha).

## Segurança (protocolo 2)
- A placa assina cada pacote: `x-sig = HMAC-SHA256(chave, ts.corpo)`; o servidor recusa assinatura errada ou relógio > 10 min.
- O servidor assina a confirmação `a = HMAC(chave, "ok.<agora>.<lote>")[0:32]` → só ela zera as moedas enviadas
  (ninguém por perto apaga moedas da telemetria escrevendo uma resposta falsa no Bluetooth/rede).
- Cada crédito vem assinado com a hora do servidor: `s = HMAC(chave, "<id>.<pulsos>.<agora>")[0:32]`;
  a placa recusa crédito com hora mais antiga que o último aceito (resposta antiga repetida não solta jogada).
- Conexão Bluetooth sem resposta assinada em 90 s é derrubada (ninguém "prende" a placa).
- Moedas ainda não enviadas ficam guardadas na memória da placa (queda de energia não apaga).

## Economia de servidor (rede inteira)
A placa só fala quando tem moeda (agrupa 20 s no Bluetooth / 10 s no Wi-Fi), confirmação de crédito, ou a cada `envio_s`
(o servidor manda: Bluetooth 300 s, Wi-Fi 20 s). Antes era a cada 5 s = ~518 mil chamadas/mês por placa.
Com Bluetooth: ~12 mil chamadas/mês por placa → 500 máquinas ≈ 6 milhões/mês (plano Pro inclui 2 milhões; excedente US$ 2/milhão).
Crédito remoto/Pix chega na hora porque a **maquininha** chama o servidor logo após a venda (e escuta o Realtime para crédito remoto).

## Regras para o app da maquininha (a fazer, PlugPag/Android)
1. Achar a placa pelo serviço BLE `6d760001-4d56-4d56-a001-6d76706c6163`; conferir INFO (`id` = QR).
2. A cada aviso (notify) da característica PACOTE: enviar ao `tel-sync` com `x-placa`, `x-ts`, `x-sig` e o `corpo` **sem alterar**.
3. Escrever a resposta inteira, sem alterar, na característica RESPOSTA.
4. Depois de uma venda (Pix/cartão): criar o crédito no servidor e já ler PACOTE e enviar (crédito na hora).

## Rede e clientes externos (banco)
`sql/2026-11-20_telemetria_rede.sql`: cada placa tem dono (franqueado ou `cliente_telemetria`), situação
(estoque/ativa/suspensa/cancelada), implantação e mensalidade. O dono vê e controla só as dele.
Suspensa: continua contando moedas e entregando o que o cliente final já pagou; só não aceita crédito remoto novo.

## Arquivos
- `firmware/telemetria_mvtoy_ble/telemetria_mvtoy_ble.ino` — placa Bluetooth (rede).
- `firmware/telemetria_mvtoy_wifi/telemetria_mvtoy_wifi.ino` — placa Wi-Fi (piloto).
- `supabase/tel-sync/index.ts` — servidor v3 (no ar).
- `sql/` — tabelas e funções. `simulacao/` — testes elétricos e do programa (ver LEIA.md).
- `hardware/` — placa de teste, placa final v1 (`telemetria-mvtoy-v1/ESPECIFICACAO.md`), caixa 3D (`caixa/`).
- `MONTAGEM.md` — guia do montador (peças, ligação, gravação, testes).

## Ainda falta
- App da maquininha (PlugPag, modo operador) e confirmação do PagBank para app próprio na Moderninha Smart.
- Pix PagBank gerando crédito automático.
- Fotos/medições reais do chicote → ajustar caixa e placa final; homologação Anatel antes de vender a placa.
