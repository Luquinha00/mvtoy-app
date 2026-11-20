# Cobranças Asaas — Grupo MV (pendente)

Branch `pendente-asaas`. Padrão: Drive › Hub de Comandos › "Padrão de cobrança Asaas — Grupo MV (v2)". Central C-0383/0384/0385.

## Para ligar (na ordem)
1. Amanda gera a chave da API no Asaas (Integrações › Chaves de API) e ela é colada direto em Supabase › Edge Functions › Secrets:
   `ASAAS_API_KEY` = a chave · `ASAAS_AMBIENTE` = `producao` (ou `sandbox` para teste) · `ASAAS_WEBHOOK_TOKEN` = um texto longo aleatório (o agente gera) · `ASAAS_WEBHOOK_EMAIL` = e-mail que recebe aviso se o webhook falhar.
2. Aplicar `sql/mvt_cobrancas_asaas.sql` (aprovação do Lucas no Supabase).
3. Publicar a função `supabase/asaas` com verify_jwt = false (a função confere a sessão do app e o token do webhook).
4. Chamar `?acao=webhook-config` uma vez (franqueador logado) → o Asaas passa a avisar os pagamentos.
5. Tela "Cobranças" no app (cadastrar franqueado, criar cobrança, ver link/Pix, filtros por marca × natureza).
6. Teste de verdade: uma cobrança de R$ 5 para um franqueado de confiança; conferir que o app marca "paga" sozinho.

## Etiquetas
`externalReference` no Asaas = `MARCA|NATUREZA|TIPO|id` (ex.: `MVT|FRANQUEADOR|TEL|…`). O painel por marca sai da view `mv_entradas_mes`.
Tipos: ROY royalty · TAXA taxa de franquia · FMK fundo de marketing · PED pedido de compra · REP repasse · TEL telemetria (R$ 600 + R$ 60/mês) · OPR operação própria · OUT outros.
