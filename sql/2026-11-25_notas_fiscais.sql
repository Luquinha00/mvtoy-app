-- Notas fiscais automáticas (C-0485)
-- franqueadora -> franqueado: NFS-e (taxa de franquia, royalties, fundo) e NF-e (mercadoria)
-- franqueado -> comércio: NF-e (remessa em consignação, venda da consignação, venda)
-- Segredos (chave do Asaas, token da API fiscal, certificado A1) NUNCA ficam no banco:
-- ficam nos segredos das funções (Edge Function secrets) ou no próprio provedor.

-- 1) Quem emite e quem recebe nota (franqueadora, franqueados e comércios)
create table if not exists public.mvt_fiscal_entidades (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('franqueadora','franqueado','comercio')),
  nome text not null,                 -- nome fantasia
  razao_social text,
  documento text,                     -- CNPJ ou CPF, só números
  email_nf text,                      -- para onde vai a nota
  inscricao_municipal text,
  inscricao_estadual text,
  regime text check (regime in ('simples','mei','presumido','real') or regime is null),
  endereco jsonb not null default '{}'::jsonb, -- logradouro, numero, bairro, cep, cidade, uf, codigo_ibge
  marca text,                         -- MV Toy, Mini Loja MV, MV Play...
  acesso_id uuid references public.mvt_acessos(id),   -- login do franqueado no app (se tiver)
  local_id uuid references public.mvt_locais(id),     -- quando é um comércio parceiro
  emite boolean not null default false,               -- emite nota pelo app?
  provedor_nfse text check (provedor_nfse in ('asaas','focus') or provedor_nfse is null),
  provedor_nfe text check (provedor_nfe in ('focus') or provedor_nfe is null),
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao','producao')),
  provedor_cliente_id text,           -- id do cliente no Asaas (quando é destinatário)
  ativo boolean not null default true,
  obs text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists mvt_fiscal_entidades_doc on public.mvt_fiscal_entidades(tipo, documento) where documento is not null;
alter table public.mvt_fiscal_entidades enable row level security;

-- máquina -> franqueado dono da operação (para calcular royalties)
alter table public.mvt_maquinas add column if not exists franqueado_id uuid references public.mvt_fiscal_entidades(id);

-- 2) As notas
create table if not exists public.mvt_nf_notas (
  id uuid primary key default gen_random_uuid(),
  emitente_id uuid not null references public.mvt_fiscal_entidades(id),
  destinatario_id uuid not null references public.mvt_fiscal_entidades(id),
  modelo text not null check (modelo in ('nfse','nfe')),
  natureza text not null check (natureza in ('taxa_franquia','royalties','fundo_marketing','venda_mercadoria',
                                             'remessa_consignacao','venda_consignacao','venda_comercio','outro')),
  cfop text,                          -- NF-e: 5917, 5113/5114, 5102...
  competencia date,                   -- mês de referência (dia 1)
  valor numeric(12,2) not null check (valor >= 0),
  base_calculo numeric(12,2),         -- ex.: faturamento bruto usado nos royalties
  aliquota numeric(6,4),              -- ex.: 0.04
  descricao text not null,
  itens jsonb not null default '[]'::jsonb, -- NF-e: [{produto_id, nome, ncm, qtd, valor_unit}]
  ref_tipo text, ref_id text,         -- origem: pedido, visita, fechamento...
  nota_ref_id uuid references public.mvt_nf_notas(id), -- venda da consignação aponta para a remessa
  vencimento date,
  status text not null default 'rascunho'
    check (status in ('rascunho','aprovada','enviando','agendada','emitida','erro','cancelada')),
  provedor text,
  provedor_cobranca_id text, provedor_nota_id text,
  numero text, chave text, pdf_url text, xml_url text,
  erro_msg text,
  tentativas int not null default 0,
  criado_por uuid references public.mvt_acessos(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- não deixa gerar duas notas iguais do mesmo mês (royalties, fundo)
create unique index if not exists mvt_nf_notas_unica_mes on public.mvt_nf_notas(emitente_id, destinatario_id, natureza, competencia)
  where competencia is not null and status <> 'cancelada' and natureza in ('royalties','fundo_marketing');
create index if not exists mvt_nf_notas_status on public.mvt_nf_notas(status);
alter table public.mvt_nf_notas enable row level security;

-- 3) Histórico (cada envio, resposta e aviso do provedor)
create table if not exists public.mvt_nf_eventos (
  id bigint generated always as identity primary key,
  nota_id uuid references public.mvt_nf_notas(id),
  origem text not null,               -- app, asaas, focus, webhook
  evento text not null,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);
alter table public.mvt_nf_eventos enable row level security;

-- 4) Regras (contrato: royalties 4%, fundo 2%, nota até dia 5, vence dia 10)
insert into public.mvt_config(chave, valor) values
 ('nf_regras', '{"royalties_pct":0.04,"fundo_pct":0.02,"dia_emissao":5,"dia_vencimento":10,
   "servico_franquia":{"lc116":"17.08","codigo_municipal":null,"iss_pct":null,"validar":"contador"},
   "fundo_marketing_emite_nota":null,
   "texto_royalties":"Royalties de franquia {marca} - competência {mes} - {pct} sobre faturamento bruto de R$ {base} ({qtd} máquinas)",
   "texto_fundo":"Contribuição ao Fundo de Marketing {marca} - competência {mes} - {pct} sobre faturamento bruto de R$ {base}",
   "emissao_automatica":false}')
on conflict (chave) do nothing;

-- ===================== funções =====================

-- cadastro (criar/editar) de franqueadora, franqueado ou comércio
create or replace function public.mvt_admin_fiscal_entidade(p_sessao uuid, p_id uuid, p_dados json)
returns json language plpgsql security definer set search_path to 'public' as $$
declare eid uuid := p_id; d json := p_dados; doc text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if coalesce(trim(d->>'nome'),'')='' then return json_build_object('erro','Informe o nome.'); end if;
  if coalesce(d->>'tipo','') not in ('franqueadora','franqueado','comercio') then return json_build_object('erro','Tipo inválido.'); end if;
  doc := nullif(regexp_replace(coalesce(d->>'documento',''),'\D','','g'),'');
  if doc is not null and length(doc) not in (11,14) then return json_build_object('erro','CNPJ/CPF inválido.'); end if;
  if eid is null then
    insert into public.mvt_fiscal_entidades(tipo,nome) values (d->>'tipo', trim(d->>'nome')) returning id into eid;
  end if;
  update public.mvt_fiscal_entidades set
    tipo=d->>'tipo', nome=trim(d->>'nome'), razao_social=nullif(trim(d->>'razao_social'),''), documento=doc,
    email_nf=nullif(lower(trim(d->>'email_nf')),''), inscricao_municipal=nullif(trim(d->>'inscricao_municipal'),''),
    inscricao_estadual=nullif(trim(d->>'inscricao_estadual'),''), regime=nullif(d->>'regime',''),
    endereco=coalesce((d->'endereco')::jsonb,'{}'::jsonb), marca=nullif(trim(d->>'marca'),''),
    acesso_id=nullif(d->>'acesso_id','')::uuid, local_id=nullif(d->>'local_id','')::uuid,
    emite=coalesce((d->>'emite')::boolean,false), provedor_nfse=nullif(d->>'provedor_nfse',''),
    provedor_nfe=nullif(d->>'provedor_nfe',''), ambiente=coalesce(nullif(d->>'ambiente',''),'homologacao'),
    ativo=coalesce((d->>'ativo')::boolean,true), obs=nullif(trim(d->>'obs'),''), atualizado_em=now()
  where id=eid;
  return json_build_object('ok',true,'id',eid);
exception when unique_violation then return json_build_object('erro','Já existe um cadastro com esse CNPJ/CPF.');
end $$;

-- liga máquinas a um franqueado
create or replace function public.mvt_admin_maquina_franqueado(p_sessao uuid, p_codigos text[], p_franqueado uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_franqueado is not null and not exists(select 1 from public.mvt_fiscal_entidades where id=p_franqueado and tipo='franqueado') then
    return json_build_object('erro','Franqueado não encontrado.'); end if;
  update public.mvt_maquinas set franqueado_id=p_franqueado, atualizado_em=now() where codigo = any(p_codigos);
  get diagnostics n = row_count;
  return json_build_object('ok',true,'maquinas',n);
end $$;

-- fechamento do mês: gera as notas de royalties e fundo (em rascunho) de cada franqueado
create or replace function public.mvt_nf_preparar_royalties(p_competencia date)
returns json language plpgsql security definer set search_path to 'public' as $$
declare r json; cfg jsonb; emit uuid; ini date := date_trunc('month',p_competencia)::date; fim date;
  f record; base numeric; qtd int; criadas int := 0; puladas int := 0; mes text; venc date; marca text;
begin
  fim := (ini + interval '1 month')::date;
  select valor::jsonb into cfg from public.mvt_config where chave='nf_regras';
  select id into emit from public.mvt_fiscal_entidades where tipo='franqueadora' and ativo order by criado_em limit 1;
  if emit is null then return json_build_object('erro','Cadastre a franqueadora (CNPJ) antes.'); end if;
  mes := to_char(ini,'MM/YYYY');
  venc := make_date(extract(year from fim)::int, extract(month from fim)::int, (cfg->>'dia_vencimento')::int);
  for f in select e.* from public.mvt_fiscal_entidades e where e.tipo='franqueado' and e.ativo loop
    select coalesce(sum(v.valor),0), count(distinct m.codigo) into base, qtd
      from public.mvt_maquinas m left join public.mvt_vendas_dia v on v.codigo=m.codigo and v.dia>=ini and v.dia<fim
      where m.franqueado_id=f.id;
    if qtd=0 then puladas := puladas+1; continue; end if;
    marca := coalesce(f.marca,'MV Toy');
    begin
      insert into public.mvt_nf_notas(emitente_id,destinatario_id,modelo,natureza,competencia,valor,base_calculo,aliquota,descricao,vencimento,ref_tipo)
      values (emit,f.id,'nfse','royalties',ini,round(base*(cfg->>'royalties_pct')::numeric,2),base,(cfg->>'royalties_pct')::numeric,
        replace(replace(replace(replace(replace(cfg->>'texto_royalties','{marca}',marca),'{mes}',mes),'{pct}',((cfg->>'royalties_pct')::numeric*100)::int||'%'),
          '{base}',translate(to_char(base,'FM999,999,990.00'),',.','.,')),'{qtd}',qtd::text), venc,'fechamento');
      criadas := criadas+1;
    exception when unique_violation then puladas := puladas+1; end;
    begin
      insert into public.mvt_nf_notas(emitente_id,destinatario_id,modelo,natureza,competencia,valor,base_calculo,aliquota,descricao,vencimento,ref_tipo)
      values (emit,f.id,'nfse','fundo_marketing',ini,round(base*(cfg->>'fundo_pct')::numeric,2),base,(cfg->>'fundo_pct')::numeric,
        replace(replace(replace(replace(cfg->>'texto_fundo','{marca}',marca),'{mes}',mes),'{pct}',((cfg->>'fundo_pct')::numeric*100)::int||'%'),
          '{base}',translate(to_char(base,'FM999,999,990.00'),',.','.,')), venc,'fechamento');
      criadas := criadas+1;
    exception when unique_violation then null; end;
  end loop;
  insert into public.mvt_nf_eventos(origem,evento,detalhe) values ('app','fechamento_royalties',json_build_object('competencia',ini,'criadas',criadas,'puladas',puladas)::jsonb);
  return json_build_object('ok',true,'competencia',ini,'criadas',criadas,'puladas',puladas);
end $$;
revoke all on function public.mvt_nf_preparar_royalties(date) from public, anon, authenticated;

create or replace function public.mvt_admin_nf_fechamento(p_sessao uuid, p_competencia date)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return public.mvt_nf_preparar_royalties(p_competencia);
end $$;

-- nota avulsa (taxa de franquia, venda de mercadoria, consignação...)
create or replace function public.mvt_admin_nf_nova(p_sessao uuid, p_dados json)
returns json language plpgsql security definer set search_path to 'public' as $$
declare d json := p_dados; nid uuid; quem uuid; mdl text; nat text; tot numeric;
begin
  quem := public.mvt_admin_de(p_sessao);
  if quem is null then return json_build_object('erro','Só o franqueador.'); end if;
  nat := d->>'natureza';
  mdl := case when nat in ('taxa_franquia','royalties','fundo_marketing') then 'nfse' else 'nfe' end;
  if mdl='nfe' then
    select coalesce(sum((i->>'qtd')::numeric*(i->>'valor_unit')::numeric),0) into tot from json_array_elements(coalesce(d->'itens','[]'::json)) i;
    if tot=0 then return json_build_object('erro','Nota de produto precisa de itens com quantidade e valor.'); end if;
  else tot := (d->>'valor')::numeric; end if;
  if coalesce(tot,0)<=0 then return json_build_object('erro','Valor inválido.'); end if;
  insert into public.mvt_nf_notas(emitente_id,destinatario_id,modelo,natureza,cfop,competencia,valor,descricao,itens,ref_tipo,ref_id,nota_ref_id,vencimento,criado_por)
  values ((d->>'emitente_id')::uuid,(d->>'destinatario_id')::uuid,mdl,nat,
    coalesce(nullif(d->>'cfop',''), case nat when 'remessa_consignacao' then '5917' when 'venda_consignacao' then '5114'
      when 'venda_mercadoria' then '5102' when 'venda_comercio' then '5102' end),
    nullif(d->>'competencia','')::date, tot, coalesce(nullif(trim(d->>'descricao'),''),nat),
    coalesce((d->'itens')::jsonb,'[]'::jsonb), nullif(d->>'ref_tipo',''), nullif(d->>'ref_id',''),
    nullif(d->>'nota_ref_id','')::uuid, nullif(d->>'vencimento','')::date, quem)
  returning id into nid;
  insert into public.mvt_nf_eventos(nota_id,origem,evento) values (nid,'app','criada');
  return json_build_object('ok',true,'id',nid,'valor',tot);
exception when foreign_key_violation then return json_build_object('erro','Emitente ou destinatário não cadastrado.');
end $$;

-- aprovar (manda para a fila de emissão), cancelar rascunho, corrigir valor
create or replace function public.mvt_admin_nf_acao(p_sessao uuid, p_ids uuid[], p_acao text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_acao='aprovar' then
    update public.mvt_nf_notas set status='aprovada', atualizado_em=now() where id=any(p_ids) and status in ('rascunho','erro');
  elsif p_acao='cancelar' then
    -- só rascunho/aprovada/erro: nota já emitida se cancela no provedor (passo manual, Nível B)
    update public.mvt_nf_notas set status='cancelada', atualizado_em=now() where id=any(p_ids) and status in ('rascunho','aprovada','erro');
  else return json_build_object('erro','Ação inválida.'); end if;
  get diagnostics n = row_count;
  insert into public.mvt_nf_eventos(nota_id,origem,evento) select unnest(p_ids),'app',p_acao;
  return json_build_object('ok',true,'alteradas',n);
end $$;

-- lista para a tela "Notas fiscais"
create or replace function public.mvt_admin_nf_dados(p_sessao uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return json_build_object(
    'regras',(select valor::json from public.mvt_config where chave='nf_regras'),
    'entidades',(select coalesce(json_agg(e order by e.tipo,e.nome),'[]') from (
        select id,tipo,nome,razao_social,documento,email_nf,inscricao_municipal,inscricao_estadual,regime,endereco,marca,
               local_id,emite,provedor_nfse,provedor_nfe,ambiente,ativo,obs,
               (select count(*) from public.mvt_maquinas m where m.franqueado_id=x.id) maquinas
        from public.mvt_fiscal_entidades x) e),
    'notas',(select coalesce(json_agg(n order by n.criado_em desc),'[]') from (
        select n.id,n.modelo,n.natureza,n.cfop,n.competencia,n.valor,n.base_calculo,n.aliquota,n.descricao,n.status,n.numero,
               n.pdf_url,n.xml_url,n.erro_msg,n.vencimento,n.criado_em,n.emitente_id,n.destinatario_id,
               ee.nome emitente, ed.nome destinatario
        from public.mvt_nf_notas n join public.mvt_fiscal_entidades ee on ee.id=n.emitente_id
        join public.mvt_fiscal_entidades ed on ed.id=n.destinatario_id
        order by n.criado_em desc limit 300) n));
end $$;

-- usada pela função de emissão (service role) para registrar o resultado
create or replace function public.mvt_nf_registrar(p_id uuid, p_dados jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.mvt_nf_notas set
    status=coalesce(p_dados->>'status',status), provedor=coalesce(p_dados->>'provedor',provedor),
    provedor_cobranca_id=coalesce(p_dados->>'provedor_cobranca_id',provedor_cobranca_id),
    provedor_nota_id=coalesce(p_dados->>'provedor_nota_id',provedor_nota_id),
    numero=coalesce(p_dados->>'numero',numero), chave=coalesce(p_dados->>'chave',chave),
    pdf_url=coalesce(p_dados->>'pdf_url',pdf_url), xml_url=coalesce(p_dados->>'xml_url',xml_url),
    erro_msg=case when p_dados ? 'erro_msg' then p_dados->>'erro_msg' else erro_msg end,
    tentativas=tentativas+case when p_dados->>'status' in ('enviando') then 1 else 0 end, atualizado_em=now()
  where id=p_id;
  insert into public.mvt_nf_eventos(nota_id,origem,evento,detalhe) values (p_id,coalesce(p_dados->>'origem','emissor'),coalesce(p_dados->>'status','atualizada'),p_dados);
end $$;

revoke all on function public.mvt_nf_registrar(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mvt_admin_fiscal_entidade(uuid,uuid,json), public.mvt_admin_maquina_franqueado(uuid,text[],uuid),
  public.mvt_admin_nf_fechamento(uuid,date), public.mvt_admin_nf_nova(uuid,json), public.mvt_admin_nf_acao(uuid,uuid[],text),
  public.mvt_admin_nf_dados(uuid) to anon;
