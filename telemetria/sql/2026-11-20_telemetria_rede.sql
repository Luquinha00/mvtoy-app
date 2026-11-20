-- Telemetria MV Toy para a rede inteira e venda externa (20/11/2026). Substitui 2026-11-20_mvt_tel_nova_placa.sql.
-- 1) cada placa tem um DONO (franqueado ou cliente externo) e um plano (implantação + mensalidade);
-- 2) o dono vê e controla só as placas dele; o franqueador (admin) vê tudo;
-- 3) placa suspensa (mensalidade atrasada) continua contando moedas e entregando o que o cliente já pagou,
--    só não aceita crédito remoto novo;
-- 4) número novo das placas: TMV-0001… ("MVP" é o código da MV Play no Asaas);
-- 5) "online" = falou nos últimos 11 min (a placa agora dá sinal a cada 5 min para economizar servidor);
-- 6) tira a placa de teste do banco.

alter table public.mvt_acessos drop constraint if exists mvt_acessos_papel_check;
alter table public.mvt_acessos add constraint mvt_acessos_papel_check
  check (papel = any (array['admin','socio','franqueado','investidor','reabastecedor','cliente_telemetria']));

alter table public.mvt_tel_placas
  add column if not exists dono_acesso uuid references public.mvt_acessos(id),
  add column if not exists situacao text not null default 'ativa' check (situacao in ('estoque','ativa','suspensa','cancelada')),
  add column if not exists implantacao numeric(10,2) not null default 600,
  add column if not exists mensalidade numeric(10,2) not null default 60,
  add column if not exists ativada_em timestamptz;
create index if not exists mvt_tel_placas_dono on public.mvt_tel_placas(dono_acesso);
create unique index if not exists mvt_tel_placas_codigo_un on public.mvt_tel_placas(codigo) where codigo is not null;

delete from public.mvt_tel_placas where id = 'TESTE-0001';

-- quem pode mexer nesta placa? admin: todas; dono: as dele
create or replace function public.mvt_tel_pode(p_sessao uuid, p_placa text)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.mvt_sessoes s join public.mvt_acessos a on a.id = s.acesso_id
  where s.sessao = p_sessao and s.expira_em > now() and a.ativo
    and (a.papel = 'admin' or exists (select 1 from public.mvt_tel_placas p where p.id = upper(trim(p_placa)) and p.dono_acesso = a.id))
$$;

create or replace function public.mvt_tel_quem(p_sessao uuid)
returns table(id uuid, papel text) language sql stable security definer set search_path = public as $$
  select a.id, a.papel from public.mvt_sessoes s join public.mvt_acessos a on a.id = s.acesso_id
  where s.sessao = p_sessao and s.expira_em > now() and a.ativo
$$;

-- placa nova (só o franqueador): número sequencial + chave; dono e plano opcionais
create or replace function public.mvt_admin_nova_placa(p_sessao uuid, p_dono uuid default null, p_implantacao numeric default 600, p_mensalidade numeric default 60)
returns json language plpgsql security definer set search_path = public as $$
declare n int; novo text; seg text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  perform pg_advisory_xact_lock(hashtext('mvt_tel_nova_placa'));
  select coalesce(max(substring(id from 5)::int),0)+1 into n from public.mvt_tel_placas where id ~ '^TMV-[0-9]+$';
  novo := 'TMV-'||lpad(n::text,4,'0');
  seg := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.mvt_tel_placas(id, segredo, dono_acesso, situacao, implantacao, mensalidade)
  values (novo, seg, p_dono, case when p_dono is null then 'estoque' else 'ativa' end, coalesce(p_implantacao,600), coalesce(p_mensalidade,60));
  return json_build_object('ok',true,'id',novo,'segredo',seg,'gravar','CFG '||novo||' '||seg);
end $$;

-- franqueador entrega a placa a um dono (franqueado/cliente) ou muda a situação
create or replace function public.mvt_admin_placa_dono(p_sessao uuid, p_placa text, p_dono uuid, p_situacao text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  update public.mvt_tel_placas set dono_acesso = p_dono,
    situacao = coalesce(p_situacao, case when p_dono is not null and situacao = 'estoque' then 'ativa' else situacao end),
    ativada_em = coalesce(ativada_em, case when p_dono is not null then now() end)
  where id = upper(trim(p_placa));
  if not found then return json_build_object('erro','Placa não encontrada.'); end if;
  return json_build_object('ok',true);
end $$;

-- lista: admin vê todas; dono vê as dele
create or replace function public.mvt_admin_placas(p_sessao uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare eu uuid; pap text;
begin
  select q.id, q.papel into eu, pap from public.mvt_tel_quem(p_sessao) q;
  if eu is null then return json_build_object('erro','Sessão expirada. Entre de novo.'); end if;
  return coalesce((select json_agg(json_build_object('id',p.id,'codigo',p.codigo,'valor_pulso',p.valor_pulso,
    'online',p.ultimo_contato > now() - interval '11 minutes','ultimo_contato',p.ultimo_contato,'rssi',p.ultimo_rssi,'firmware',p.firmware,
    'situacao',p.situacao,'dono',(select a.nome from public.mvt_acessos a where a.id=p.dono_acesso),
    'mensalidade',case when pap='admin' then p.mensalidade end,
    'pendentes',(select count(*) from public.mvt_tel_creditos c where c.placa_id=p.id and c.status in ('pendente','enviado')),
    'moedas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='moeda' and e.criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'))
    order by p.id) from public.mvt_tel_placas p where pap='admin' or p.dono_acesso=eu),'[]'::json);
end $$;

-- ligar placa à máquina: admin qualquer; dono só a placa dele e numa máquina vinculada a ele
create or replace function public.mvt_admin_parear(p_sessao uuid, p_placa text, p_codigo text, p_valor_pulso numeric)
returns json language plpgsql security definer set search_path = public as $$
declare eu uuid; pap text; pl text := upper(trim(p_placa));
begin
  select q.id, q.papel into eu, pap from public.mvt_tel_quem(p_sessao) q;
  if eu is null then return json_build_object('erro','Sessão expirada. Entre de novo.'); end if;
  if public.mvt_tel_pode(p_sessao, pl) is null then return json_build_object('erro','Placa não encontrada na sua conta. Confira o QR.'); end if;
  if not exists (select 1 from public.mvt_maquinas where codigo=p_codigo) then return json_build_object('erro','Máquina não encontrada.'); end if;
  if pap <> 'admin' and not exists (select 1 from public.mvt_vinculos v where v.acesso_id=eu and v.codigo=p_codigo) then
    return json_build_object('erro','Essa máquina não é da sua conta.'); end if;
  if coalesce(p_valor_pulso,1) not between 0.10 and 100 then return json_build_object('erro','Valor do pulso entre R$ 0,10 e R$ 100.'); end if;
  update public.mvt_tel_placas set codigo=null where codigo=p_codigo and id<>pl;
  update public.mvt_tel_placas set codigo=p_codigo, valor_pulso=coalesce(p_valor_pulso,valor_pulso), pareado_por=eu, pareado_em=now(),
    situacao = case when situacao='estoque' then 'ativa' else situacao end where id=pl;
  return json_build_object('ok',true);
end $$;

-- crédito remoto/teste: admin ou dono; placa suspensa não aceita crédito novo
create or replace function public.mvt_admin_credito(p_sessao uuid, p_codigo text, p_pulsos integer, p_origem text)
returns json language plpgsql security definer set search_path = public as $$
declare eu uuid; pl public.mvt_tel_placas;
begin
  select * into pl from public.mvt_tel_placas where codigo=p_codigo;
  if pl.id is null then return json_build_object('erro','Esta máquina não tem Telemetria MV Toy.'); end if;
  eu := public.mvt_tel_pode(p_sessao, pl.id);
  if eu is null then return json_build_object('erro','Sem permissão para esta máquina.'); end if;
  if pl.situacao in ('suspensa','cancelada') then return json_build_object('erro','Telemetria suspensa: regularize a mensalidade para liberar crédito remoto.'); end if;
  if coalesce(p_pulsos,0) not between 1 and 20 then return json_build_object('erro','Pulsos de 1 a 20.'); end if;
  if (select count(*) from public.mvt_tel_creditos c where c.placa_id=pl.id and c.status in ('pendente','enviado')) >= 10 then
    return json_build_object('erro','Já há 10 créditos esperando a placa. Confira se ela está online.'); end if;
  insert into public.mvt_tel_creditos(placa_id,codigo,pulsos,valor,origem,criado_por)
  values (pl.id,p_codigo,p_pulsos,p_pulsos*pl.valor_pulso,case when p_origem in ('teste','remoto') then p_origem else 'teste' end,eu);
  return json_build_object('ok',true);
end $$;

revoke all on function public.mvt_tel_pode(uuid,text), public.mvt_tel_quem(uuid) from public, anon, authenticated;
grant execute on function public.mvt_admin_nova_placa(uuid,uuid,numeric,numeric), public.mvt_admin_placa_dono(uuid,text,uuid,text) to anon, authenticated;
