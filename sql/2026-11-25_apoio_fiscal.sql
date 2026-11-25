-- Apoio fiscal (C-0485 cont.): regime de cada franqueado/franqueadora, imposto estimado do mês e alertas.
-- Estimativa para gestão — não substitui a apuração do contador.

alter table public.mvt_fiscal_entidades
  add column if not exists folha_mensal numeric(12,2) not null default 0,   -- folha + pró-labore (Fator R)
  add column if not exists iss_pct numeric(5,2),                             -- Lucro Presumido
  add column if not exists anexo_maquinas text not null default 'III' check (anexo_maquinas in ('I','III','V')),
  add column if not exists mei_tipo text not null default 'servico' check (mei_tipo in ('servico','comercio','ambos'));

insert into public.mvt_config(chave, valor) values ('fiscal_tabelas', '{
 "ano": 2026,
 "fonte": "LC 123/2006 anexos I, III e V; DAS-MEI 2026 (salário mínimo R$ 1.621); limite MEI R$ 81 mil",
 "simples": {
  "I":  [[180000,0.04,0],[360000,0.073,5940],[720000,0.095,13860],[1800000,0.107,22500],[3600000,0.143,87300],[4800000,0.19,378000]],
  "III":[[180000,0.06,0],[360000,0.112,9360],[720000,0.135,17640],[1800000,0.16,35640],[3600000,0.21,125640],[4800000,0.33,648000]],
  "V":  [[180000,0.155,0],[360000,0.18,4500],[720000,0.195,9900],[1800000,0.205,17100],[3600000,0.23,62100],[4800000,0.305,540000]]
 },
 "limite_simples": 4800000, "sublimite_iss_icms": 3600000,
 "mei": {"limite_ano": 81000, "das": {"servico": 86.05, "comercio": 82.05, "ambos": 87.05}},
 "presumido_servicos_pct": 0.1133, "presumido_iss_padrao": 0.05,
 "fator_r": 0.28
}') on conflict (chave) do update set valor = excluded.valor;

-- receita de uma máquina num mês: leitura mensal (fechada) ou soma diária (telemetria)
create or replace function public.mvt_receita_mes(p_codigo text, p_mes date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select faturamento from public.mvt_leituras_mensais where codigo=p_codigo and mes=date_trunc('month',p_mes)::date and faturamento>0),
    (select sum(valor) from public.mvt_vendas_dia where codigo=p_codigo and dia>=date_trunc('month',p_mes)::date and dia<(date_trunc('month',p_mes)+interval '1 month')::date),
    0) $$;

-- alíquota efetiva do Simples
create or replace function public.mvt_simples_efetiva(p_anexo text, p_rbt12 numeric)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare t jsonb; f jsonb; r numeric := greatest(coalesce(p_rbt12,0),1);
begin
  select (valor::jsonb)->'simples'->p_anexo into t from public.mvt_config where chave='fiscal_tabelas';
  for f in select * from jsonb_array_elements(t) loop
    if r <= (f->>0)::numeric then return round(greatest((r*(f->>1)::numeric - (f->>2)::numeric)/r, 0), 5); end if;
  end loop;
  f := t->-1; return round((r*(f->>1)::numeric - (f->>2)::numeric)/r, 5);
end $$;

-- cálculo fiscal de uma entidade (franqueadora ou franqueado) no mês
create or replace function public.mvt_fiscal_calc(p_entidade uuid, p_mes date)
returns json language plpgsql stable security definer set search_path to 'public' as $$
declare e record; cfg jsonb; ini date := date_trunc('month',p_mes)::date; maq numeric := 0; roy numeric := 0;
  hist numeric := 0; meses int := 0; rbt12 numeric; i int; v numeric; vm numeric; vr numeric;
  aq_maq numeric := 0; aq_roy numeric := 0; imp numeric := 0; anexo_roy text := 'V'; fator numeric; alertas jsonb := '[]'::jsonb; obs text;
begin
  select * into e from public.mvt_fiscal_entidades where id=p_entidade;
  if e is null then return null; end if;
  select valor::jsonb into cfg from public.mvt_config where chave='fiscal_tabelas';
  -- receita do mês
  select coalesce(sum(public.mvt_receita_mes(m.codigo, ini)),0) into maq from public.mvt_maquinas m
   where (e.tipo='franqueado' and m.franqueado_id=e.id) or (e.tipo='franqueadora' and m.franqueado_id is null and coalesce(m.status,'')<>'Em estoque');
  select coalesce(sum(valor),0) into roy from public.mvt_nf_notas
   where emitente_id=e.id and natureza in ('royalties','taxa_franquia') and competencia=ini and status<>'cancelada';
  -- RBT12: 12 meses anteriores (com dado); proporcional quando há menos meses (regra de início de atividade)
  for i in 1..12 loop
    select coalesce(sum(public.mvt_receita_mes(m.codigo, (ini - make_interval(months=>i))::date)),0) into vm from public.mvt_maquinas m
     where (e.tipo='franqueado' and m.franqueado_id=e.id) or (e.tipo='franqueadora' and m.franqueado_id is null);
    select coalesce(sum(valor),0) into vr from public.mvt_nf_notas
     where emitente_id=e.id and natureza in ('royalties','taxa_franquia') and competencia=(ini - make_interval(months=>i))::date and status<>'cancelada';
    v := vm+vr; if v>0 then hist := hist+v; meses := meses+1; end if;
  end loop;
  rbt12 := case when meses=0 then (maq+roy)*12 when meses<12 then hist/meses*12 else hist end;
  if meses<12 then obs := format('RBT12 proporcional a %s mês(es) com dado', meses); end if;
  fator := case when rbt12>0 then (e.folha_mensal*12)/rbt12 else 0 end;

  if e.regime='mei' then
    imp := ((cfg->'mei'->'das'->>e.mei_tipo)::numeric);
    if rbt12 > (cfg->'mei'->>'limite_ano')::numeric*1.2 then
      alertas := alertas || jsonb_build_array('Faturamento passa 20% do limite do MEI: desenquadramento desde janeiro, com imposto como ME no ano todo — falar com o contador já.');
    elsif rbt12 > (cfg->'mei'->>'limite_ano')::numeric then
      alertas := alertas || jsonb_build_array('Faturamento acima do limite do MEI (R$ 81 mil/ano): precisa virar ME no próximo ano e paga o excesso.');
    elsif rbt12 > (cfg->'mei'->>'limite_ano')::numeric*0.8 then
      alertas := alertas || jsonb_build_array('Faturamento passou 80% do limite do MEI: planejar a mudança para ME.');
    end if;
    if roy>0 then alertas := alertas || jsonb_build_array('MEI não pode ser franqueadora (CNAE 7740-3/00).'); end if;
    aq_maq := case when maq>0 then imp/maq else 0 end;
  elsif e.regime='presumido' then
    aq_maq := (cfg->>'presumido_servicos_pct')::numeric + coalesce(e.iss_pct/100,(cfg->>'presumido_iss_padrao')::numeric);
    aq_roy := aq_maq; imp := round((maq+roy)*aq_maq,2);
  else -- Simples (padrão)
    if rbt12 > (cfg->>'limite_simples')::numeric then alertas := alertas || jsonb_build_array('Faturamento acima de R$ 4,8 milhões: sai do Simples.');
    elsif rbt12 > (cfg->>'sublimite_iss_icms')::numeric then alertas := alertas || jsonb_build_array('Acima de R$ 3,6 milhões: ISS e ICMS passam a ser pagos fora do Simples.'); end if;
    aq_maq := public.mvt_simples_efetiva(e.anexo_maquinas, rbt12);
    anexo_roy := case when fator >= (cfg->>'fator_r')::numeric then 'III' else 'V' end;
    aq_roy := public.mvt_simples_efetiva(anexo_roy, rbt12);
    imp := round(maq*aq_maq + roy*aq_roy, 2);
    if roy>0 and anexo_roy='V' then
      alertas := alertas || jsonb_build_array(format('Royalties no Anexo V (Fator R %s%%). Para o Anexo III a folha + pró-labore precisaria chegar a %s por mês.',
        replace(round(fator*100,1)::text,'.',','), 'R$ '||translate(to_char(round(rbt12*(cfg->>'fator_r')::numeric/12),'FM999,999,990'),',','.')));
    end if;
  end if;
  return json_build_object('entidade_id',e.id,'nome',e.nome,'tipo',e.tipo,'regime',coalesce(e.regime,'simples'),'mes',ini,
    'receita_maquinas',round(maq,2),'receita_royalties',round(roy,2),'rbt12',round(rbt12,2),'meses_rbt',meses,
    'aliq_maquinas',round(aq_maq,5),'aliq_royalties',round(aq_roy,5),'anexo_maquinas',e.anexo_maquinas,'anexo_royalties',anexo_roy,
    'fator_r',round(fator,4),'imposto',round(imp,2),'alertas',alertas,'obs',obs);
end $$;

create or replace function public.mvt_fiscal_resumo(p_mes date)
returns json language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(public.mvt_fiscal_calc(id, p_mes) order by tipo desc, nome),'[]')
  from public.mvt_fiscal_entidades where ativo and tipo in ('franqueadora','franqueado') $$;

create or replace function public.mvt_admin_fiscal(p_sessao uuid, p_mes date)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  return json_build_object('resumo', public.mvt_fiscal_resumo(p_mes),
    'tabelas', (select valor::json from public.mvt_config where chave='fiscal_tabelas'));
end $$;

revoke all on function public.mvt_receita_mes(text,date), public.mvt_simples_efetiva(text,numeric),
  public.mvt_fiscal_calc(uuid,date), public.mvt_fiscal_resumo(date) from public, anon, authenticated;
grant execute on function public.mvt_admin_fiscal(uuid,date) to anon;

-- cadastro passa a gravar os campos fiscais novos
create or replace function public.mvt_admin_fiscal_entidade(p_sessao uuid, p_id uuid, p_dados json)
returns json language plpgsql security definer set search_path to 'public' as $$
declare eid uuid := p_id; d json := p_dados; doc text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if coalesce(trim(d->>'nome'),'')='' then return json_build_object('erro','Informe o nome.'); end if;
  if coalesce(d->>'tipo','') not in ('franqueadora','franqueado','comercio') then return json_build_object('erro','Tipo inválido.'); end if;
  doc := nullif(regexp_replace(coalesce(d->>'documento',''),'\D','','g'),'');
  if doc is not null and length(doc) not in (11,14) then return json_build_object('erro','CNPJ/CPF inválido.'); end if;
  if d->>'regime'='mei' and d->>'tipo'='franqueadora' then return json_build_object('erro','Franqueadora não pode ser MEI (CNAE 7740-3/00).'); end if;
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
    folha_mensal=coalesce(nullif(d->>'folha_mensal','')::numeric,0), iss_pct=nullif(d->>'iss_pct','')::numeric,
    anexo_maquinas=coalesce(nullif(d->>'anexo_maquinas',''),'III'), mei_tipo=coalesce(nullif(d->>'mei_tipo',''),'servico'),
    ativo=coalesce((d->>'ativo')::boolean,true), obs=nullif(trim(d->>'obs'),''), atualizado_em=now()
  where id=eid;
  return json_build_object('ok',true,'id',eid);
exception when unique_violation then return json_build_object('erro','Já existe um cadastro com esse CNPJ/CPF.');
end $$;

-- aplicado também (direto no banco, por substituição de texto):
--  * mvt_dados: nova chave 'fiscal' = mvt_fiscal_resumo(current_date) para quem vê dinheiro (alíquota por franqueado/franqueadora)
--  * mvt_admin_nf_dados: entidades trazem folha_mensal, iss_pct, anexo_maquinas, mei_tipo
