-- 23/11/2026 · Telemetria MV Toy em DUAS linhas:
--   pulso = máquinas de pulso (garra, soco, basquete, fliperama): placas TMV-0001…
--   mdb   = vending machines (protocolo MDB): placas TMD-0001…
-- Vendas MDB entram em mvt_tel_eventos com tipo 'venda' (item = seleção da máquina, valor = preço).

alter table public.mvt_tel_placas add column if not exists tipo text not null default 'pulso';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mvt_tel_placas_tipo_chk') then
    alter table public.mvt_tel_placas add constraint mvt_tel_placas_tipo_chk check (tipo in ('pulso','mdb'));
  end if;
end $$;
alter table public.mvt_tel_eventos add column if not exists item text;   -- MDB: número da seleção (ex.: 12)

-- gerar placa nova: agora escolhe a linha (padrão pulso, como antes)
drop function if exists public.mvt_admin_nova_placa(uuid, uuid, numeric, numeric);
create or replace function public.mvt_admin_nova_placa(p_sessao uuid, p_dono uuid default null, p_implantacao numeric default 600,
  p_mensalidade numeric default 60, p_tipo text default 'pulso')
returns json language plpgsql security definer set search_path = public as $$
declare n int; pre text; novo text; seg text; t text := coalesce(nullif(lower(trim(p_tipo)),''),'pulso');
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if t not in ('pulso','mdb') then return json_build_object('erro','Tipo de placa inválido.'); end if;
  pre := case when t = 'mdb' then 'TMD-' else 'TMV-' end;
  perform pg_advisory_xact_lock(hashtext('mvt_tel_nova_placa'));
  select coalesce(max(substring(id from 5)::int),0)+1 into n from public.mvt_tel_placas where id ~ ('^'||pre||'[0-9]+$');
  novo := pre||lpad(n::text,4,'0');
  seg := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.mvt_tel_placas(id, segredo, dono_acesso, situacao, implantacao, mensalidade, tipo)
  values (novo, seg, p_dono, case when p_dono is null then 'estoque' else 'ativa' end, coalesce(p_implantacao,600), coalesce(p_mensalidade,60), t);
  return json_build_object('ok',true,'id',novo,'tipo',t,'segredo',seg,'gravar','CFG '||novo||' '||seg);
end $$;
grant execute on function public.mvt_admin_nova_placa(uuid,uuid,numeric,numeric,text) to anon, authenticated;

-- lista de placas: devolve a linha (tipo) e, para MDB, as vendas do dia
create or replace function public.mvt_admin_placas(p_sessao uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare eu uuid; pap text; d0 timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  select q.id, q.papel into eu, pap from public.mvt_tel_quem(p_sessao) q;
  if eu is null then return json_build_object('erro','Sessão expirada. Entre de novo.'); end if;
  return coalesce((select json_agg(json_build_object('id',p.id,'tipo',p.tipo,'codigo',p.codigo,'valor_pulso',p.valor_pulso,
    'online',p.ultimo_contato > now() - interval '11 minutes','ultimo_contato',p.ultimo_contato,'rssi',p.ultimo_rssi,'firmware',p.firmware,
    'situacao',p.situacao,'dono',(select a.nome from public.mvt_acessos a where a.id=p.dono_acesso),
    'mensalidade',case when pap='admin' then p.mensalidade end,
    'pendentes',(select count(*) from public.mvt_tel_creditos c where c.placa_id=p.id and c.status in ('pendente','enviado')),
    'moedas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo in ('moeda','nota') and e.criado_em >= d0),
    'notas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='nota' and e.criado_em >= d0),
    'premios_hoje',(select coalesce(sum(pulsos),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='premio' and e.criado_em >= d0),
    'vendas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='venda' and e.criado_em >= d0),
    'vendas_qtd_hoje',(select count(*) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='venda' and e.criado_em >= d0))
    order by p.tipo desc, p.id) from public.mvt_tel_placas p where pap='admin' or p.dono_acesso=eu),'[]'::json);
end $$;
