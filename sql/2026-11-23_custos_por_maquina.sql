-- 23/11/2026 · custos fixos mensais também por máquina (ex.: licença Print My Case R$ 590 e VM Pay R$ 120 na MVT-0034)
alter table public.mvt_custos_local add column if not exists codigo text references public.mvt_maquinas(codigo);
-- (função mvt_admin_custo_local com p_codigo e mvt_dados com 'codigo' aplicados direto no banco em 23/11)
