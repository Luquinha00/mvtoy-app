-- Nota fiscal DIRETO no governo (sem intermediário):
--  NFS-e → Sistema Nacional NFS-e (Sefin Nacional, API gratuita; obrigatório p/ Simples em Araraquara desde 01/11/2026)
--  NF-e  → Sefaz-SP (web service NFeAutorizacao4, gratuito)
-- Certificado A1 de cada CNPJ fica SÓ como segredo do servidor (NFCERT_<cnpj> e NFSENHA_<cnpj>), nunca no banco.

alter table public.mvt_fiscal_entidades drop constraint if exists mvt_fiscal_entidades_provedor_nfse_check;
alter table public.mvt_fiscal_entidades drop constraint if exists mvt_fiscal_entidades_provedor_nfe_check;
alter table public.mvt_fiscal_entidades
  add constraint mvt_fiscal_entidades_provedor_nfse_check check (provedor_nfse is null or provedor_nfse in ('nacional','asaas','focus')),
  add constraint mvt_fiscal_entidades_provedor_nfe_check check (provedor_nfe is null or provedor_nfe in ('sefaz','focus')),
  add column if not exists telefone text,
  add column if not exists crt int;              -- NF-e: 1 Simples, 2 Simples excesso, 3 normal, 4 MEI (calculado se vazio)
alter table public.mvt_fiscal_entidades alter column provedor_nfse set default 'nacional';
alter table public.mvt_fiscal_entidades alter column provedor_nfe set default 'sefaz';
update public.mvt_fiscal_entidades set provedor_nfse='nacional' where provedor_nfse is null or provedor_nfse='asaas';
update public.mvt_fiscal_entidades set provedor_nfe='sefaz' where provedor_nfe is null;

alter table public.mvt_nf_notas
  add column if not exists serie text,
  add column if not exists numero_doc bigint,       -- nDPS (NFS-e) ou nNF (NF-e)
  add column if not exists protocolo text,
  add column if not exists xml text;                -- XML autorizado (guardar 5 anos)

create table if not exists public.mvt_nf_sequencias (
  emitente_id uuid not null references public.mvt_fiscal_entidades(id),
  modelo text not null check (modelo in ('nfse','nfe')),
  ambiente text not null check (ambiente in ('homologacao','producao')),
  serie text not null,
  ultimo bigint not null default 0,
  primary key (emitente_id, modelo, ambiente, serie)
);
alter table public.mvt_nf_sequencias enable row level security;

-- próximo número (DPS ou NF-e) — reaproveita o número da própria nota se ela já tiver um (reenvio após erro)
create or replace function public.mvt_nf_numerar(p_nota uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare n record; e record; s text; num bigint;
begin
  select * into n from public.mvt_nf_notas where id=p_nota for update;
  if n.numero_doc is not null then return json_build_object('serie',n.serie,'numero',n.numero_doc); end if;
  select * into e from public.mvt_fiscal_entidades where id=n.emitente_id;
  s := '1';
  insert into public.mvt_nf_sequencias(emitente_id,modelo,ambiente,serie,ultimo) values (e.id,n.modelo,e.ambiente,s,1)
  on conflict (emitente_id,modelo,ambiente,serie) do update set ultimo=mvt_nf_sequencias.ultimo+1
  returning ultimo into num;
  update public.mvt_nf_notas set serie=s, numero_doc=num where id=p_nota;
  return json_build_object('serie',s,'numero',num);
end $$;

-- registrar passa a gravar protocolo e XML
create or replace function public.mvt_nf_registrar(p_id uuid, p_dados jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.mvt_nf_notas set
    status=coalesce(p_dados->>'status',status), provedor=coalesce(p_dados->>'provedor',provedor),
    provedor_cobranca_id=coalesce(p_dados->>'provedor_cobranca_id',provedor_cobranca_id),
    provedor_nota_id=coalesce(p_dados->>'provedor_nota_id',provedor_nota_id),
    numero=coalesce(p_dados->>'numero',numero), chave=coalesce(p_dados->>'chave',chave),
    protocolo=coalesce(p_dados->>'protocolo',protocolo), xml=coalesce(p_dados->>'xml',xml),
    pdf_url=coalesce(p_dados->>'pdf_url',pdf_url), xml_url=coalesce(p_dados->>'xml_url',xml_url),
    erro_msg=case when p_dados ? 'erro_msg' then p_dados->>'erro_msg' else erro_msg end,
    tentativas=tentativas+case when p_dados->>'status' in ('enviando') then 1 else 0 end, atualizado_em=now()
  where id=p_id;
  insert into public.mvt_nf_eventos(nota_id,origem,evento,detalhe)
  values (p_id,coalesce(p_dados->>'origem','emissor'),coalesce(p_dados->>'status','atualizada'),p_dados - 'xml');
end $$;

revoke all on function public.mvt_nf_numerar(uuid), public.mvt_nf_registrar(uuid,jsonb) from public, anon, authenticated;

-- regras do serviço de franquia para o padrão nacional
update public.mvt_config set valor = (valor::jsonb || jsonb_build_object(
  'servico_franquia', (valor::jsonb->'servico_franquia') || '{"c_trib_nac":"170801"}'::jsonb,
  'nfe', coalesce(valor::jsonb->'nfe','{"serie":"1"}'::jsonb)
))::text where chave='nf_regras';
grant execute on function public.mvt_nf_numerar(uuid), public.mvt_nf_registrar(uuid,jsonb), public.mvt_fiscal_calc(uuid,date), public.mvt_admin_de(uuid) to service_role;

-- aplicado também (substituição de texto no banco):
--  * mvt_admin_nf_dados: notas trazem chave, protocolo, tem_xml; entidades trazem telefone
--  * mvt_admin_fiscal_entidade: grava telefone; provedor padrão 'nacional' (NFS-e) e 'sefaz' (NF-e)
create or replace function public.mvt_admin_nf_xml(p_sessao uuid, p_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return (select json_build_object('xml',xml,'chave',chave,'modelo',modelo) from public.mvt_nf_notas where id=p_id);
end $$;
grant execute on function public.mvt_admin_nf_xml(uuid,uuid) to anon;
