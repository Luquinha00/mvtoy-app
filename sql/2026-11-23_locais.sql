-- 23/11/2026 · Cadastro de LOCAIS. Cada máquina aponta para um local; o local guarda a regra do ponto
-- (aluguel fixo por máquina ou %), o relatório (canal, frequência, destino/portal) e os custos compartilhados.
create table if not exists public.mvt_locais (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  grupo text,                                  -- ex.: Lago Azul (une KM 58/64/72 no mesmo relatório)
  tipo text not null default 'comercio' check (tipo in ('shopping','loja_propria','posto','comercio','estoque')),
  cidade text,
  regra text not null default 'percentual' check (regra in ('percentual','fixo','nenhuma')),
  comissao_pct numeric(5,2) not null default 0,
  aluguel_fixo numeric(10,2) not null default 0,  -- por máquina, por mês
  relatorio_canal text not null default 'nenhum' check (relatorio_canal in ('nenhum','email','portal')),
  relatorio_freq text check (relatorio_freq in ('semanal','mensal')),
  relatorio_para text,
  portal_url text,
  contato text,
  obs text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now());
alter table public.mvt_locais enable row level security;
alter table public.mvt_maquinas add column if not exists local_id uuid references public.mvt_locais(id);
alter table public.mvt_custos_local add column if not exists local_id uuid references public.mvt_locais(id);

insert into public.mvt_locais(nome,grupo,tipo,cidade,regra,comissao_pct,aluguel_fixo,relatorio_canal,relatorio_freq,relatorio_para,contato) values
 ('Lago Azul KM 58','Lago Azul','posto',null,'fixo',0,1000,'email','semanal','Loja58@redelagoazul.com.br','Roberto (gerente, KM 58)'),
 ('Lago Azul KM 64','Lago Azul','posto',null,'fixo',0,1000,'email','semanal','Loja58@redelagoazul.com.br','Roberto (gerente, KM 58)'),
 ('Lago Azul KM 72','Lago Azul','posto',null,'fixo',0,1000,'email','semanal','Loja58@redelagoazul.com.br','Roberto (gerente, KM 58)'),
 ('MV Play — Shopping Jaraguá','MV Play','loja_propria','Araraquara','nenhuma',0,0,'nenhum',null,null,null),
 ('MV Play — Shopping Passeio','MV Play','loja_propria','São Carlos','nenhuma',0,0,'nenhum',null,null,null),
 ('Shopping Passeio São Carlos',null,'shopping','São Carlos','percentual',20,0,'portal','semanal',null,null),
 ('Shopping Jaraguá Araraquara',null,'shopping','Araraquara','percentual',20,0,'portal','semanal',null,null),
 ('Shopping Jaraguá Indaiatuba',null,'shopping','Indaiatuba','percentual',20,0,'portal','semanal',null,null),
 ('Shopping Franco da Rocha',null,'shopping','Franco da Rocha','percentual',20,0,'portal','semanal',null,null),
 ('Jaboticabal Shopping',null,'shopping','Jaboticabal','percentual',20,0,'portal','semanal',null,null),
 ('Limeira Shopping',null,'shopping','Limeira','percentual',20,0,'portal','semanal',null,null),
 ('Assis Plaza Shopping',null,'shopping','Assis','percentual',20,0,'nenhum',null,null,null),
 ('RC Comércio de Bebidas',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Posto Shalom',null,'posto',null,'percentual',20,0,'nenhum',null,null,null),
 ('The Passion Burguer',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Mercado Hiperlar',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Distribuidora Adega GM',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Minas Pães e Café',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Conveniência Pena Verde',null,'comercio',null,'percentual',20,0,'nenhum',null,null,null),
 ('Sorveteria Maria Pitanga',null,'comercio','Araraquara','percentual',30,0,'nenhum',null,null,null),
 ('Estoque Matriz — Sede',null,'estoque','Araraquara','nenhuma',0,0,'nenhum',null,null,null),
 ('Lote SmartMach — a definir',null,'estoque',null,'nenhuma',0,0,'nenhum',null,null,'Máquinas da parceria Lacyr chegando')
on conflict (nome) do nothing;

-- liga cada máquina ao seu local (o texto "ponto" continua como a posição dentro do local)
update public.mvt_maquinas m set local_id = l.id from public.mvt_locais l where m.local_id is null and (
  (l.nome='Lago Azul KM 58' and m.codigo in ('MVT-0033','MVT-0042','MVT-0045','MVT-0050')) or
  (l.nome='Lago Azul KM 64' and m.codigo in ('MVT-0034','MVT-0044','MVT-0049')) or
  (l.nome='Lago Azul KM 72' and m.codigo in ('MVT-0043','MVT-0046','MVT-0052')) or
  (l.nome='MV Play — Shopping Jaraguá' and m.codigo in ('MVT-0006','MVT-0012','MVT-0027','MVT-0029','MVT-0031','MVT-0035')) or
  (l.nome='MV Play — Shopping Passeio' and m.codigo in ('MVT-0036','MVT-0037','MVT-0038','MVT-0039','MVT-0040','MVT-0041')) or
  (l.nome='Shopping Passeio São Carlos' and m.codigo in ('MVT-0005','MVT-0009','MVT-0010','MVT-0011','MVT-0018','MVT-0019','MVT-0020','MVT-0028','MVT-0030')) or
  (l.nome='Shopping Jaraguá Araraquara' and m.codigo='MVT-0001') or
  (l.nome='Shopping Jaraguá Indaiatuba' and m.codigo='MVT-0024') or
  (l.nome='Shopping Franco da Rocha' and m.codigo='MVT-0023') or
  (l.nome='Jaboticabal Shopping' and m.codigo='MVT-0025') or
  (l.nome='Limeira Shopping' and m.codigo in ('MVT-0015','MVT-0026')) or
  (l.nome='Assis Plaza Shopping' and m.codigo='MVT-0021') or
  (l.nome='RC Comércio de Bebidas' and m.codigo='MVT-0003') or
  (l.nome='Posto Shalom' and m.codigo='MVT-0007') or
  (l.nome='The Passion Burguer' and m.codigo='MVT-0008') or
  (l.nome='Mercado Hiperlar' and m.codigo='MVT-0013') or
  (l.nome='Distribuidora Adega GM' and m.codigo='MVT-0014') or
  (l.nome='Minas Pães e Café' and m.codigo='MVT-0016') or
  (l.nome='Conveniência Pena Verde' and m.codigo='MVT-0017') or
  (l.nome='Sorveteria Maria Pitanga' and m.codigo='MVT-0022') or
  (l.nome='Estoque Matriz — Sede' and m.codigo in ('MVT-0032','MVT-0047','MVT-0048')) or
  (l.nome='Lote SmartMach — a definir' and m.codigo in ('MVT-0051','MVT-0053','MVT-0054','MVT-0055','MVT-0056','MVT-0057')));

-- custos compartilhados passam a apontar para o local
update public.mvt_custos_local c set local_id=l.id from public.mvt_locais l where c.local_id is null and (
  (c.nome='Internet Lago Azul KM 58' and l.nome='Lago Azul KM 58') or (c.nome='Internet Lago Azul KM 64' and l.nome='Lago Azul KM 64') or
  (c.nome='Internet Lago Azul KM 72' and l.nome='Lago Azul KM 72') or (c.nome='Internet MV Play Shopping Passeio' and l.nome='MV Play — Shopping Passeio') or
  (c.nome='Internet MV Play Shopping Jaraguá' and l.nome='MV Play — Shopping Jaraguá'));

-- salvar local (e, se pedido, aplicar a regra às máquinas do local)
create or replace function public.mvt_admin_local(p_sessao uuid, p_id uuid, p_dados json, p_aplicar boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $$
declare lid uuid := p_id; d json := p_dados; n int := 0;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if coalesce(trim(d->>'nome'),'')='' then return json_build_object('erro','Informe o nome do local.'); end if;
  if lid is null then
    insert into public.mvt_locais(nome) values (trim(d->>'nome')) returning id into lid;
  end if;
  update public.mvt_locais set nome=trim(d->>'nome'), grupo=nullif(trim(d->>'grupo'),''), tipo=coalesce(nullif(d->>'tipo',''),tipo),
    cidade=nullif(trim(d->>'cidade'),''), regra=coalesce(nullif(d->>'regra',''),regra),
    comissao_pct=coalesce((d->>'comissao_pct')::numeric,0), aluguel_fixo=coalesce((d->>'aluguel_fixo')::numeric,0),
    relatorio_canal=coalesce(nullif(d->>'relatorio_canal',''),'nenhum'), relatorio_freq=nullif(d->>'relatorio_freq',''),
    relatorio_para=nullif(trim(d->>'relatorio_para'),''), portal_url=nullif(trim(d->>'portal_url'),''),
    contato=nullif(trim(d->>'contato'),''), obs=nullif(trim(d->>'obs'),''), ativo=coalesce((d->>'ativo')::boolean,true)
  where id=lid;
  if p_aplicar then
    update public.mvt_maquinas m set
      comissao_pct=case l.regra when 'percentual' then l.comissao_pct else 0 end,
      comissao_fixa=case l.regra when 'fixo' then l.aluguel_fixo else 0 end, atualizado_em=now()
    from public.mvt_locais l where l.id=lid and m.local_id=lid;
    get diagnostics n = row_count;
  end if;
  return json_build_object('ok',true,'id',lid,'aplicado',n);
exception when unique_violation then return json_build_object('erro','Já existe um local com esse nome.');
end $$;
grant execute on function public.mvt_admin_local(uuid,uuid,json,boolean) to anon, authenticated;

-- mover máquina de local (copia a regra do local para a máquina)
create or replace function public.mvt_admin_maquina_local(p_sessao uuid, p_codigo text, p_local_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare l public.mvt_locais;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_local_id is null then update public.mvt_maquinas set local_id=null, atualizado_em=now() where codigo=upper(trim(p_codigo)); return json_build_object('ok',true); end if;
  select * into l from public.mvt_locais where id=p_local_id;
  if not found then return json_build_object('erro','Local não encontrado.'); end if;
  update public.mvt_maquinas set local_id=l.id,
    cidade=coalesce(l.cidade,cidade),
    comissao_pct=case l.regra when 'percentual' then l.comissao_pct when 'nenhuma' then 0 else 0 end,
    comissao_fixa=case l.regra when 'fixo' then l.aluguel_fixo else 0 end, atualizado_em=now()
  where codigo=upper(trim(p_codigo)) and local_id is distinct from l.id;
  return json_build_object('ok',true);
end $$;
grant execute on function public.mvt_admin_maquina_local(uuid,text,uuid) to anon, authenticated;

-- custo do local passa a aceitar o local escolhido
create or replace function public.mvt_admin_custo_local(p_sessao uuid, p_id uuid, p_nome text, p_prefixo text, p_categoria text,
  p_valor numeric, p_desde date, p_ate date, p_apagar boolean default false, p_local_id uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if p_apagar then delete from public.mvt_custos_local where id=p_id; return json_build_object('ok',true); end if;
  if coalesce(trim(p_nome),'')='' or (p_local_id is null and coalesce(trim(p_prefixo),'')='') or p_valor is null or p_valor<0 or p_desde is null then
    return json_build_object('erro','Informe nome, local, valor e desde quando.'); end if;
  if p_id is null then
    insert into public.mvt_custos_local(nome,ponto_prefixo,categoria,valor_mensal,desde,ate,local_id)
    values (trim(p_nome),coalesce(nullif(trim(p_prefixo),''),'—'),coalesce(nullif(trim(p_categoria),''),'Telemetria e internet'),p_valor,p_desde,p_ate,p_local_id);
  else
    update public.mvt_custos_local set nome=trim(p_nome),ponto_prefixo=coalesce(nullif(trim(p_prefixo),''),ponto_prefixo),
      categoria=coalesce(nullif(trim(p_categoria),''),categoria),valor_mensal=p_valor,desde=p_desde,ate=p_ate,local_id=p_local_id where id=p_id;
  end if;
  return json_build_object('ok',true);
end $$;
drop function if exists public.mvt_admin_custo_local(uuid,uuid,text,text,text,numeric,date,date,boolean);
grant execute on function public.mvt_admin_custo_local(uuid,uuid,text,text,text,numeric,date,date,boolean,uuid) to anon, authenticated;

-- mvt_dados devolve local_id da máquina, a lista de locais e o local de cada custo
do $$ declare d text; begin
  select pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure) into d;
  if position('''local_id'',m.local_id' in d) = 0 then
    d := replace(d, '''marca'',m.marca,', '''marca'',m.marca,''local_id'',m.local_id,');
    d := replace(d, '''prefixo'',c.ponto_prefixo,', '''prefixo'',c.ponto_prefixo,''local_id'',c.local_id,');
    d := replace(d, '''estoque'', public.mvt_estoque_json(a),',
      '''locais'', case when din then coalesce((select json_agg(row_to_json(l) order by l.grupo nulls last, l.nome) from public.mvt_locais l),''[]''::json) else ''[]''::json end,
    ''estoque'', public.mvt_estoque_json(a),');
    execute d;
  end if;
end $$;

-- conferência (levanta exceção de propósito; não grava nada)
do $$ declare s uuid := gen_random_uuid(); a uuid; r json; begin
  select id into a from public.mvt_acessos where papel='admin' and ativo limit 1;
  insert into public.mvt_sessoes(sessao,acesso_id,expira_em) values (s,a,now()+interval '1 minute');
  r := public.mvt_dados(s);
  raise notice 'OK locais=% maq_com_local=% sem_local=%', json_array_length(r->'locais'),
    (select count(*) from public.mvt_maquinas where local_id is not null), (select string_agg(codigo,',') from public.mvt_maquinas where local_id is null);
  delete from public.mvt_sessoes where sessao=s;
end $$;
