-- Telemetria própria MV (placa MV) — piloto. 20/11/2026.
-- Placas, eventos (batimento e pulsos lidos) e créditos digitais enviados para a placa.
create table if not exists public.mvt_tel_placas (
  id text primary key,                         -- serial da placa (ex.: MVP-0001), vai no QR
  segredo text not null,                       -- chave HMAC da placa (só o servidor lê)
  codigo text references public.mvt_maquinas(codigo) on delete set null,  -- máquina onde está instalada
  valor_pulso numeric(10,2) not null default 1.00, -- quanto vale 1 pulso nesta máquina (R$)
  pulso_ms int not null default 60,            -- duração do pulso de crédito
  intervalo_ms int not null default 80,        -- intervalo entre pulsos
  ultimo_contato timestamptz,
  ultimo_rssi int,
  pulsos_lidos_total bigint not null default 0,
  firmware text,
  ultimo_lote bigint,                          -- nº do último envio de moedas aceito (evita contar duas vezes)
  pareado_por uuid references public.mvt_acessos(id),
  pareado_em timestamptz,
  criado_em timestamptz not null default now());
alter table public.mvt_tel_placas enable row level security;

create table if not exists public.mvt_tel_creditos (
  id uuid primary key default gen_random_uuid(),
  placa_id text not null references public.mvt_tel_placas(id) on delete cascade,
  codigo text,
  pulsos int not null check (pulsos between 1 and 50),
  valor numeric(10,2),
  origem text not null default 'teste',        -- teste | remoto | pix | debito | credito
  referencia text unique,                      -- id do pagamento (impede crédito em dobro)
  status text not null default 'pendente',     -- pendente | enviado | executado | falhou
  criado_por uuid references public.mvt_acessos(id),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  executado_em timestamptz);
alter table public.mvt_tel_creditos enable row level security;
create index if not exists mvt_tel_creditos_pend on public.mvt_tel_creditos(placa_id) where status in ('pendente','enviado');

create table if not exists public.mvt_tel_eventos (
  id bigint generated always as identity primary key,
  placa_id text not null references public.mvt_tel_placas(id) on delete cascade,
  codigo text,
  tipo text not null,                          -- moeda (pulsos lidos) | online | reinicio
  pulsos int,
  valor numeric(10,2),
  criado_em timestamptz not null default now());
alter table public.mvt_tel_eventos enable row level security;
create index if not exists mvt_tel_eventos_placa on public.mvt_tel_eventos(placa_id, criado_em desc);

-- Franqueador: liga a placa (QR) a uma máquina
create or replace function public.mvt_admin_parear(p_sessao uuid, p_placa text, p_codigo text, p_valor_pulso numeric) returns json
language plpgsql security definer set search_path = public as $$
declare adm uuid;
begin
  adm := public.mvt_admin_de(p_sessao);
  if adm is null then return json_build_object('erro','Só o franqueador.'); end if;
  if not exists (select 1 from public.mvt_tel_placas where id=upper(trim(p_placa))) then return json_build_object('erro','Placa não encontrada. Confira o QR.'); end if;
  if not exists (select 1 from public.mvt_maquinas where codigo=p_codigo) then return json_build_object('erro','Máquina não encontrada.'); end if;
  update public.mvt_tel_placas set codigo=null where codigo=p_codigo and id<>upper(trim(p_placa));
  update public.mvt_tel_placas set codigo=p_codigo, valor_pulso=coalesce(p_valor_pulso,valor_pulso), pareado_por=adm, pareado_em=now()
   where id=upper(trim(p_placa));
  return json_build_object('ok',true);
end $$;

-- Franqueador: crédito remoto / de teste
create or replace function public.mvt_admin_credito(p_sessao uuid, p_codigo text, p_pulsos int, p_origem text) returns json
language plpgsql security definer set search_path = public as $$
declare adm uuid; pl public.mvt_tel_placas;
begin
  adm := public.mvt_admin_de(p_sessao);
  if adm is null then return json_build_object('erro','Só o franqueador.'); end if;
  select * into pl from public.mvt_tel_placas where codigo=p_codigo;
  if pl.id is null then return json_build_object('erro','Esta máquina não tem placa MV.'); end if;
  if coalesce(p_pulsos,0) not between 1 and 20 then return json_build_object('erro','Pulsos de 1 a 20.'); end if;
  insert into public.mvt_tel_creditos(placa_id,codigo,pulsos,valor,origem,criado_por)
  values (pl.id,p_codigo,p_pulsos,p_pulsos*pl.valor_pulso,case when p_origem in ('teste','remoto') then p_origem else 'teste' end,adm);
  return json_build_object('ok',true);
end $$;

-- Status das placas para a tela do app
create or replace function public.mvt_admin_placas(p_sessao uuid) returns json
language plpgsql security definer set search_path = public stable as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return coalesce((select json_agg(json_build_object('id',p.id,'codigo',p.codigo,'valor_pulso',p.valor_pulso,
    'online',p.ultimo_contato > now() - interval '2 minutes','ultimo_contato',p.ultimo_contato,'rssi',p.ultimo_rssi,'firmware',p.firmware,
    'pendentes',(select count(*) from public.mvt_tel_creditos c where c.placa_id=p.id and c.status in ('pendente','enviado')),
    'moedas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='moeda' and e.criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'))
    order by p.id) from public.mvt_tel_placas p),'[]'::json);
end $$;

revoke all on function public.mvt_admin_parear(uuid,text,text,numeric), public.mvt_admin_credito(uuid,text,int,text), public.mvt_admin_placas(uuid) from public;
grant execute on function public.mvt_admin_parear(uuid,text,text,numeric), public.mvt_admin_credito(uuid,text,int,text), public.mvt_admin_placas(uuid) to anon, authenticated;
