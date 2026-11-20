-- Cobranças do Grupo MV pelo Asaas (CNPJ único Mundo Virtual Franchising). PENDENTE de aprovação.
-- Padrão: Drive › Hub de Comandos › "Padrão de cobrança Asaas — Grupo MV (v2)".
-- Etiquetas obrigatórias: marca (MVT/MVP/MLM/MVF) e natureza (FRANQUEADOR/PROPRIA) + tipo.

create table if not exists public.mv_clientes_cobranca (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (marca in ('MVT','MVP','MLM','MVF')),
  acesso_id uuid references public.mvt_acessos(id) on delete set null,  -- franqueado no app (se tiver)
  nome text not null,
  cpf_cnpj text not null,
  email text,
  telefone text,
  asaas_id text unique,                         -- cus_… criado no Asaas
  criado_em timestamptz not null default now(),
  unique (marca, cpf_cnpj));
alter table public.mv_clientes_cobranca enable row level security;

create table if not exists public.mv_cobrancas (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (marca in ('MVT','MVP','MLM','MVF')),
  natureza text not null check (natureza in ('FRANQUEADOR','PROPRIA')),
  tipo text not null check (tipo in ('ROY','TAXA','FMK','PED','REP','TEL','OPR','OUT')),
  cliente_id uuid not null references public.mv_clientes_cobranca(id),
  codigo text,                                  -- máquina (MVT-xxxx), quando for o caso
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 5),   -- Asaas: mínimo R$ 5 [VALIDAR]
  vencimento date not null,
  forma text not null default 'ESCOLHA' check (forma in ('PIX','BOLETO','ESCOLHA')),
  competencia date,
  origem text,                                  -- ex.: pedido:<id>, fechamento:2026-11, telemetria:MVT-0012
  status text not null default 'criando',       -- criando | aberta | paga | vencida | cancelada | erro
  asaas_id text unique,
  link_fatura text, link_boleto text, pix_copia_cola text,
  valor_liquido numeric(12,2),
  pago_em timestamptz,
  erro text,
  criado_por uuid references public.mvt_acessos(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now());
alter table public.mv_cobrancas enable row level security;
create index if not exists mv_cobrancas_marca on public.mv_cobrancas(marca, natureza, tipo, competencia);

-- Painel: quanto entrou por marca × natureza × tipo no mês
create or replace view public.mv_entradas_mes with (security_invoker = true) as
  select date_trunc('month', pago_em)::date mes, marca, natureza, tipo,
         count(*) qtd, sum(valor) bruto, sum(coalesce(valor_liquido, valor)) liquido
  from public.mv_cobrancas where status='paga' group by 1,2,3,4;

-- Franqueador cadastra o cliente (franqueado) que vai receber cobranças
create or replace function public.mv_admin_cliente(p_sessao uuid, p_marca text, p_nome text, p_cpf_cnpj text, p_email text, p_telefone text, p_acesso uuid) returns json
language plpgsql security definer set search_path = public as $$
declare doc text := regexp_replace(coalesce(p_cpf_cnpj,''),'\D','','g'); r public.mv_clientes_cobranca;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if length(doc) not in (11,14) then return json_build_object('erro','CPF ou CNPJ inválido.'); end if;
  insert into public.mv_clientes_cobranca(marca,nome,cpf_cnpj,email,telefone,acesso_id)
  values (upper(p_marca),trim(p_nome),doc,nullif(trim(p_email),''),nullif(trim(p_telefone),''),p_acesso)
  on conflict (marca,cpf_cnpj) do update set nome=excluded.nome,email=excluded.email,telefone=excluded.telefone,acesso_id=excluded.acesso_id
  returning * into r;
  return json_build_object('ok',true,'id',r.id);
end $$;

create or replace function public.mv_admin_clientes(p_sessao uuid) returns json
language plpgsql security definer set search_path = public stable as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return coalesce((select json_agg(json_build_object('id',id,'marca',marca,'nome',nome) order by nome) from public.mv_clientes_cobranca),'[]'::json);
end $$;
revoke all on function public.mv_admin_clientes(uuid) from public;
grant execute on function public.mv_admin_clientes(uuid) to anon, authenticated;

-- Franqueador cria a cobrança (o app chama depois a função asaas para registrar no Asaas)
create or replace function public.mv_admin_cobranca(p_sessao uuid, p_cliente uuid, p_natureza text, p_tipo text, p_codigo text, p_descricao text,
  p_valor numeric, p_vencimento date, p_forma text, p_competencia date, p_origem text) returns json
language plpgsql security definer set search_path = public as $$
declare adm uuid; c public.mv_clientes_cobranca; novo uuid;
begin
  adm := public.mvt_admin_de(p_sessao);
  if adm is null then return json_build_object('erro','Só o franqueador.'); end if;
  select * into c from public.mv_clientes_cobranca where id=p_cliente;
  if c.id is null then return json_build_object('erro','Cliente não encontrado.'); end if;
  if coalesce(p_valor,0) < 5 then return json_build_object('erro','Valor mínimo R$ 5,00.'); end if;
  if p_vencimento < current_date then return json_build_object('erro','Vencimento no passado.'); end if;
  insert into public.mv_cobrancas(marca,natureza,tipo,cliente_id,codigo,descricao,valor,vencimento,forma,competencia,origem,criado_por)
  values (c.marca,upper(p_natureza),upper(p_tipo),c.id,nullif(p_codigo,''),trim(p_descricao),p_valor,p_vencimento,coalesce(upper(p_forma),'ESCOLHA'),p_competencia,p_origem,adm)
  returning id into novo;
  return json_build_object('ok',true,'id',novo);
end $$;

-- Lista para a tela Cobranças (franqueador vê tudo; franqueado vê só as dele)
create or replace function public.mv_cobrancas_lista(p_sessao uuid) returns json
language plpgsql security definer set search_path = public stable as $$
declare a public.mvt_acessos;
begin
  a := public.mvt_quem(p_sessao);
  if a.id is null then return json_build_object('erro','Sua sessão expirou.'); end if;
  return coalesce((select json_agg(json_build_object('id',b.id,'marca',b.marca,'natureza',b.natureza,'tipo',b.tipo,'cliente',c.nome,'codigo',b.codigo,
      'descricao',b.descricao,'valor',b.valor,'vencimento',b.vencimento,'status',b.status,'link_fatura',b.link_fatura,'link_boleto',b.link_boleto,
      'pix',b.pix_copia_cola,'pago_em',b.pago_em,'erro',b.erro) order by b.vencimento desc)
    from public.mv_cobrancas b join public.mv_clientes_cobranca c on c.id=b.cliente_id
    where a.papel in ('admin','socio') or c.acesso_id=a.id),'[]'::json);
end $$;

revoke all on function public.mv_admin_cliente(uuid,text,text,text,text,text,uuid), public.mv_admin_cobranca(uuid,uuid,text,text,text,text,numeric,date,text,date,text), public.mv_cobrancas_lista(uuid) from public;
grant execute on function public.mv_admin_cliente(uuid,text,text,text,text,text,uuid), public.mv_admin_cobranca(uuid,uuid,text,text,text,text,numeric,date,text,date,text), public.mv_cobrancas_lista(uuid) to anon, authenticated;
