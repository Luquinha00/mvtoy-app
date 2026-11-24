-- 23/11/2026 · valor da máquina (retorno em meses) — valores da planilha "Resultado por máquina set-2026 (v0)" e investimento da capinha (R$ 85.000)
alter table public.mvt_maquinas add column if not exists valor_maquina numeric(12,2);
-- função mvt_admin_valor_maquina e 'valor_maquina' no mvt_dados aplicados direto no banco em 23/11
