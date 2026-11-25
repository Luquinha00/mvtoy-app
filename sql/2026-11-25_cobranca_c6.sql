-- Cobrança de royalties/taxa/fundo pelo C6 Bank (Pix com vencimento, padrão Banco Central "cobv").
-- Conta no CNPJ da Mundo Virtual Franchising (decisão do Lucas, 25/11/2026). Custo: Pix grátis no C6 PJ.
-- Credenciais (client id/secret + certificado do C6) ficam SÓ nos segredos do servidor: <PREFIXO>_CLIENT_ID,
-- <PREFIXO>_CLIENT_SECRET, <PREFIXO>_CERT (PEM), <PREFIXO>_KEY (PEM). O banco guarda só o prefixo.

create table if not exists public.mvt_contas_receb (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                         -- ex.: "C6 · Mundo Virtual Franchising"
  banco text not null default 'c6' check (banco in ('c6')),
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox','producao')),
  chave_pix text,                             -- chave aleatória (EVP) da conta
  segredo_prefixo text not null,              -- ex.: C6_MVF
  marcas text[] not null default '{}',        -- marcas que recebem nesta conta (vazio = todas)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.mvt_contas_receb enable row level security;

create table if not exists public.mvt_cobrancas (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid references public.mvt_nf_notas(id),
  conta_id uuid not null references public.mvt_contas_receb(id),
  marca text not null default 'MV Toy',
  origem text not null default 'franchising' check (origem in ('franchising','operacao_propria','outro')),
  natureza text,                              -- royalties, taxa_franquia, fundo_marketing...
  pagador_id uuid not null references public.mvt_fiscal_entidades(id),
  descricao text,
  valor numeric(12,2) not null check (valor > 0),
  vencimento date not null,
  txid text not null unique check (txid ~ '^[a-zA-Z0-9]{26,35}$'),
  status text not null default 'criada' check (status in ('criada','ativa','paga','cancelada','erro')),
  pix_copia_cola text,
  valor_pago numeric(12,2),
  pago_em timestamptz,
  e2eid text,
  erro_msg text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists mvt_cobrancas_nota_ativa on public.mvt_cobrancas(nota_id) where status in ('criada','ativa','paga');
alter table public.mvt_cobrancas enable row level security;

-- gera cobranças (status 'criada') para notas de franquia; o servidor registra no banco
create or replace function public.mvt_admin_cobranca_gerar(p_sessao uuid, p_notas uuid[])
returns json language plpgsql security definer set search_path to 'public' as $$
declare n record; c uuid; criadas int := 0; puladas int := 0; mc text; tx text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  for n in select x.*, e.marca emarca from public.mvt_nf_notas x join public.mvt_fiscal_entidades e on e.id=x.destinatario_id
           where x.id = any(p_notas) and x.status <> 'cancelada'
             and x.natureza in ('royalties','taxa_franquia','fundo_marketing','outro') loop
    if exists (select 1 from public.mvt_cobrancas where nota_id=n.id and status in ('criada','ativa','paga')) then puladas := puladas+1; continue; end if;
    mc := coalesce(nullif(n.emarca,''),'MV Toy');
    select id into c from public.mvt_contas_receb where ativo and (marcas='{}' or mc = any(marcas)) order by (marcas='{}') limit 1;
    if c is null then return json_build_object('erro','Cadastre a conta de recebimento (C6) primeiro.'); end if;
    tx := upper(left(regexp_replace(mc,'[^a-zA-Z0-9]','','g'),6)) || upper(left(regexp_replace(n.natureza,'[^a-z]','','g'),3))
          || to_char(coalesce(n.competencia,current_date),'YYYYMM') || replace(gen_random_uuid()::text,'-','');
    tx := left(tx, 35);
    insert into public.mvt_cobrancas(nota_id,conta_id,marca,origem,natureza,pagador_id,descricao,valor,vencimento,txid)
    values (n.id,c,mc,'franchising',n.natureza,n.destinatario_id,n.descricao,n.valor,
            coalesce(n.vencimento, current_date + 5), tx);
    criadas := criadas+1;
  end loop;
  return json_build_object('ok',true,'criadas',criadas,'puladas',puladas);
end $$;

create or replace function public.mvt_admin_cobranca_acao(p_sessao uuid, p_id uuid, p_acao text)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_acao='cancelar' then
    update public.mvt_cobrancas set status='cancelada', atualizado_em=now() where id=p_id and status in ('criada','erro');
    if not found then return json_build_object('erro','Cobrança já registrada no banco: cancele pelo botão do servidor.'); end if;
  elsif p_acao='baixa_manual' then
    update public.mvt_cobrancas set status='paga', pago_em=now(), valor_pago=valor, erro_msg='baixa manual', atualizado_em=now()
     where id=p_id and status in ('criada','ativa','erro');
  else return json_build_object('erro','Ação inválida.'); end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.mvt_admin_cobrancas(p_sessao uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return json_build_object(
    'contas', (select coalesce(json_agg(json_build_object('id',id,'nome',nome,'banco',banco,'ambiente',ambiente,'chave_pix',chave_pix,'segredo_prefixo',segredo_prefixo,'marcas',marcas,'ativo',ativo) order by nome),'[]') from public.mvt_contas_receb),
    'cobrancas', (select coalesce(json_agg(x order by x.vencimento desc),'[]') from (
       select c.id,c.nota_id,c.marca,c.origem,c.natureza,c.descricao,c.valor,c.vencimento,c.status,c.pix_copia_cola,c.valor_pago,c.pago_em,c.erro_msg,c.txid,
              e.nome pagador, r.nome conta
       from public.mvt_cobrancas c join public.mvt_fiscal_entidades e on e.id=c.pagador_id join public.mvt_contas_receb r on r.id=c.conta_id
       order by c.vencimento desc limit 300) x),
    'resumo', (select json_build_object(
       'recebido_mes', coalesce(sum(valor_pago) filter (where status='paga' and pago_em >= date_trunc('month',now())),0),
       'em_aberto', coalesce(sum(valor) filter (where status in ('criada','ativa')),0),
       'vencido', coalesce(sum(valor) filter (where status in ('criada','ativa') and vencimento < current_date),0)) from public.mvt_cobrancas));
end $$;

create or replace function public.mvt_admin_conta_receb(p_sessao uuid, p_id uuid, p_dados json)
returns json language plpgsql security definer set search_path to 'public' as $$
declare cid uuid := p_id; d json := p_dados; pre text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  pre := upper(regexp_replace(coalesce(d->>'segredo_prefixo',''),'[^A-Za-z0-9_]','','g'));
  if pre='' or coalesce(trim(d->>'nome'),'')='' then return json_build_object('erro','Informe nome e prefixo dos segredos.'); end if;
  if cid is null then insert into public.mvt_contas_receb(nome,segredo_prefixo) values (trim(d->>'nome'),pre) returning id into cid; end if;
  update public.mvt_contas_receb set nome=trim(d->>'nome'), segredo_prefixo=pre, ambiente=coalesce(nullif(d->>'ambiente',''),'sandbox'),
    chave_pix=nullif(trim(d->>'chave_pix'),''), marcas=coalesce((select array_agg(trim(m)) from json_array_elements_text(d->'marcas') m where trim(m)<>''),'{}'),
    ativo=coalesce((d->>'ativo')::boolean,true) where id=cid;
  return json_build_object('ok',true,'id',cid);
end $$;

-- usado só pelo servidor
create or replace function public.mvt_cobranca_registrar(p_id uuid, p_dados jsonb)
returns void language sql security definer set search_path to 'public' as $$
  update public.mvt_cobrancas set
    status=coalesce(p_dados->>'status',status), pix_copia_cola=coalesce(p_dados->>'pix_copia_cola',pix_copia_cola),
    valor_pago=coalesce((p_dados->>'valor_pago')::numeric,valor_pago), pago_em=coalesce((p_dados->>'pago_em')::timestamptz,pago_em),
    e2eid=coalesce(p_dados->>'e2eid',e2eid),
    erro_msg=case when p_dados ? 'erro_msg' then p_dados->>'erro_msg' else erro_msg end, atualizado_em=now()
  where id=p_id $$;

revoke all on function public.mvt_cobranca_registrar(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mvt_cobranca_registrar(uuid,jsonb) to service_role;
grant execute on function public.mvt_admin_cobranca_gerar(uuid,uuid[]), public.mvt_admin_cobranca_acao(uuid,uuid,text),
  public.mvt_admin_cobrancas(uuid), public.mvt_admin_conta_receb(uuid,uuid,json) to anon;

-- conta do C6 já cadastrada (sandbox até o Lucas subir as credenciais)
insert into public.mvt_contas_receb(nome,banco,ambiente,segredo_prefixo)
select 'C6 · Mundo Virtual Franchising','c6','sandbox','C6_MVF'
where not exists (select 1 from public.mvt_contas_receb where segredo_prefixo='C6_MVF');

-- (aplicado depois) base para outros bancos: lista aberta; conector no servidor só para C6 por enquanto
alter table public.mvt_contas_receb drop constraint if exists mvt_contas_receb_banco_check;
alter table public.mvt_contas_receb add constraint mvt_contas_receb_banco_check check (banco in ('c6','inter','pagbank','itau','bb','sicoob','outro'));
-- mvt_admin_conta_receb passou a gravar 'banco'
