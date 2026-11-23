-- 23/11/2026 · (1) Custos compartilhados por local (ex.: internet do ponto, dividida entre as máquinas dali)
--              (2) Estoque por produto dentro de cada máquina (o que tem, de qual tipo, quanto custa) via visitas

-- (1) custos do local ---------------------------------------------------------
create table if not exists public.mvt_custos_local (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                 -- ex.: Internet Lago Azul KM 58
  ponto_prefixo text not null,        -- máquinas cujo ponto começa com isso dividem o custo
  categoria text not null default 'Telemetria e internet',
  valor_mensal numeric(10,2) not null check (valor_mensal >= 0),
  desde date not null,
  ate date,
  criado_em timestamptz not null default now());
alter table public.mvt_custos_local enable row level security;
insert into public.mvt_custos_local(nome,ponto_prefixo,valor_mensal,desde)
select * from (values
  ('Internet Lago Azul KM 58','Lago Azul KM 58',99.90::numeric,date '2026-11-01'),
  ('Internet Lago Azul KM 64','Lago Azul KM 64',99.90,date '2026-11-01'),
  ('Internet Lago Azul KM 72','Lago Azul KM 72',99.90,date '2026-12-01'),
  ('Internet MV Play Shopping Passeio','MV Play — Shopping Passeio',99.90,date '2026-12-01'),
  ('Internet MV Play Shopping Jaraguá','MV Play — Shopping Jaraguá',99.90,date '2026-12-01')
) v(nome,ponto_prefixo,valor_mensal,desde)
where not exists (select 1 from public.mvt_custos_local c where c.nome=v.nome);

create or replace function public.mvt_admin_custo_local(p_sessao uuid, p_id uuid, p_nome text, p_prefixo text, p_categoria text,
  p_valor numeric, p_desde date, p_ate date, p_apagar boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_apagar then delete from public.mvt_custos_local where id=p_id; return json_build_object('ok',true); end if;
  if coalesce(trim(p_nome),'')='' or coalesce(trim(p_prefixo),'')='' or p_valor is null or p_valor<0 or p_desde is null then
    return json_build_object('erro','Informe nome, local, valor e desde quando.'); end if;
  if p_id is null then
    insert into public.mvt_custos_local(nome,ponto_prefixo,categoria,valor_mensal,desde,ate)
    values (trim(p_nome),trim(p_prefixo),coalesce(nullif(trim(p_categoria),''),'Telemetria e internet'),p_valor,p_desde,p_ate);
  else
    update public.mvt_custos_local set nome=trim(p_nome),ponto_prefixo=trim(p_prefixo),categoria=coalesce(nullif(trim(p_categoria),''),categoria),
      valor_mensal=p_valor,desde=p_desde,ate=p_ate where id=p_id;
  end if;
  return json_build_object('ok',true);
end $$;
grant execute on function public.mvt_admin_custo_local(uuid,uuid,text,text,text,numeric,date,date,boolean) to anon, authenticated;

-- (2) o que tem dentro de cada máquina, por produto ----------------------------
create table if not exists public.mvt_visita_itens (
  visita_id uuid not null references public.mvt_visitas(id) on delete cascade,
  produto_id uuid not null references public.mvt_produtos(id),
  encontrei int not null default 0 check (encontrei >= 0),   -- contado ao chegar (antes de repor)
  repus int not null default 0 check (repus >= 0),           -- colocado na visita
  primary key (visita_id, produto_id));
alter table public.mvt_visita_itens enable row level security;

-- estoque atual na máquina = última visita com itens (encontrei + repus), a custo de hoje
create or replace function public.mvt_dentro_json(p_codigo text, p_din boolean)
returns json language sql stable security definer set search_path to 'public' as $$
  with ult as (select v.id, v.data from public.mvt_visitas v
               where v.codigo=p_codigo and exists (select 1 from public.mvt_visita_itens i where i.visita_id=v.id)
               order by v.data desc, v.criado_em desc limit 1)
  select coalesce(json_agg(json_build_object('produto_id',p.id,'nome',p.nome,'qtd',i.encontrei+i.repus,
           'custo',case when p_din then p.custo end,'data',u.data) order by p.custo desc nulls last, p.nome),'[]'::json)
  from ult u join public.mvt_visita_itens i on i.visita_id=u.id join public.mvt_produtos p on p.id=i.produto_id
  where i.encontrei+i.repus > 0 $$;

-- saídas por mês e por produto: (o que ficou na visita anterior) − (o que encontrei nesta)
create or replace function public.mvt_saidas_json(p_codigo text, p_din boolean)
returns json language sql stable security definer set search_path to 'public' as $$
  with vis as (select v.id, v.data, row_number() over (order by v.data, v.criado_em) n from public.mvt_visitas v
               where v.codigo=p_codigo and exists (select 1 from public.mvt_visita_itens i where i.visita_id=v.id)),
  par as (select b.data, p.id produto_id,
            greatest(0, coalesce(ia.encontrei+ia.repus,0) - coalesce(ib.encontrei,0)) saiu
          from vis a join vis b on b.n=a.n+1
          cross join public.mvt_produtos p
          left join public.mvt_visita_itens ia on ia.visita_id=a.id and ia.produto_id=p.id
          left join public.mvt_visita_itens ib on ib.visita_id=b.id and ib.produto_id=p.id
          where ia.produto_id is not null or ib.produto_id is not null)
  select coalesce(json_agg(json_build_object('mes',m.mes,'qtd',m.qtd,'custo',case when p_din then m.custo end,'sem_custo',m.sem_custo) order by m.mes),'[]'::json)
  from (select date_trunc('month',x.data)::date mes, sum(x.saiu)::int qtd, sum(x.saiu*coalesce(p.custo,0)) custo,
          bool_or(x.saiu>0 and p.custo is null) sem_custo
        from par x join public.mvt_produtos p on p.id=x.produto_id group by 1) m $$;

-- visita com itens por produto (o resto igual à visita normal)
create or replace function public.mvt_salvar_visita_itens(p_sessao uuid, p_codigo text, p_data date, p_recolhido numeric, p_limpeza boolean,
  p_problema text, p_parada boolean, p_itens json)
returns json language plpgsql security definer set search_path to 'public' as $$
declare a public.mvt_acessos; vid uuid; tot_enc int; tot_rep int; r record;
begin
  a := public.mvt_quem(p_sessao);
  if a.id is null then return json_build_object('erro','Sua sessão expirou. Entre de novo.'); end if;
  if a.papel not in ('admin','franqueado','reabastecedor') or not (p_codigo = any(public.mvt_cods(a))) then
    return json_build_object('erro','Você não pode registrar visita nesta máquina.'); end if;
  if coalesce(p_data,current_date) > current_date or coalesce(p_data,current_date) < current_date-60 then
    return json_build_object('erro','Data da visita inválida.'); end if;
  if coalesce(p_recolhido,0) < 0 then return json_build_object('erro','Os números não podem ser negativos.'); end if;
  select coalesce(sum(greatest(0,(x->>'encontrei')::int)),0), coalesce(sum(greatest(0,(x->>'repus')::int)),0) into tot_enc, tot_rep
    from json_array_elements(coalesce(p_itens,'[]'::json)) x;
  insert into public.mvt_visitas(codigo,data,acesso_id,premios_repostos,premios_no_visor,dinheiro_recolhido,limpeza,problema,produto)
  values (p_codigo,coalesce(p_data,current_date),a.id,tot_rep,tot_enc,p_recolhido,coalesce(p_limpeza,false),nullif(trim(p_problema),''),
    (select nullif(premio,'sem prêmio') from public.mvt_maquinas where codigo=p_codigo)) returning id into vid;
  for r in select (x->>'produto_id')::uuid pid, greatest(0,coalesce((x->>'encontrei')::int,0)) enc, greatest(0,coalesce((x->>'repus')::int,0)) rep
           from json_array_elements(coalesce(p_itens,'[]'::json)) x where nullif(x->>'produto_id','') is not null loop
    insert into public.mvt_visita_itens(visita_id,produto_id,encontrei,repus) values (vid,r.pid,r.enc,r.rep)
    on conflict (visita_id,produto_id) do update set encontrei=public.mvt_visita_itens.encontrei+excluded.encontrei, repus=public.mvt_visita_itens.repus+excluded.repus;
  end loop;
  if p_parada then update public.mvt_maquinas set status='Manutenção', atualizado_em=now() where codigo=p_codigo; end if;
  return json_build_object('ok',true);
end $$;
grant execute on function public.mvt_salvar_visita_itens(uuid,text,date,numeric,boolean,text,boolean,json) to anon, authenticated;

-- estoque com a pessoa: visita com itens desconta o que ela repôs, produto a produto
do $$ declare d text; begin
  select pg_get_functiondef('public.mvt_estoque_json(public.mvt_acessos)'::regprocedure) into d;
  if position('mvt_visita_itens' in d) = 0 then
    d := replace(d, 'where v.acesso_id is not null group by v.acesso_id, p.nome)',
      'where v.acesso_id is not null and not exists (select 1 from public.mvt_visita_itens vi where vi.visita_id=v.id) group by v.acesso_id, p.nome
          union all
          select v.acesso_id, p.nome, -sum(vi.repus) from public.mvt_visitas v join public.mvt_visita_itens vi on vi.visita_id=v.id
            join public.mvt_produtos p on p.id=vi.produto_id where v.acesso_id is not null group by v.acesso_id, p.nome)');
    execute d;
  end if;
end $$;

-- mvt_dados: devolve o que tem dentro de cada máquina, as saídas por mês e os custos do local
do $$ declare d text; begin
  select pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure) into d;
  if position('mvt_dentro_json' in d) = 0 then
    d := replace(d, '''ultima_visita'',(select max(v.data) from public.mvt_visitas v where v.codigo=m.codigo),',
      '''ultima_visita'',(select max(v.data) from public.mvt_visitas v where v.codigo=m.codigo),''dentro'',public.mvt_dentro_json(m.codigo, din),''saidas'',public.mvt_saidas_json(m.codigo, din),');
    d := replace(d, '''estoque'', public.mvt_estoque_json(a),',
      '''custos_local'', case when din then coalesce((select json_agg(json_build_object(''id'',c.id,''nome'',c.nome,''prefixo'',c.ponto_prefixo,''categoria'',c.categoria,''valor'',c.valor_mensal,''desde'',c.desde,''ate'',c.ate) order by c.nome) from public.mvt_custos_local c),''[]''::json) else ''[]''::json end,
    ''estoque'', public.mvt_estoque_json(a),');
    execute d;
  end if;
end $$;

select (select count(*) from public.mvt_custos_local) custos,
  position('mvt_dentro_json' in pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure))>0 dados_dentro,
  position('custos_local' in pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure))>0 dados_custos,
  position('mvt_visita_itens' in pg_get_functiondef('public.mvt_estoque_json(public.mvt_acessos)'::regprocedure))>0 estoque_ok;
