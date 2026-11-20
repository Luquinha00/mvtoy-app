-- migration mvt_produtos_e_composicao (completa, 19/11/2026)
create table if not exists public.mvt_produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  categoria text not null default 'Pelúcia',
  unidade text not null default 'un',
  custo numeric(12,2),
  ativo boolean not null default true,
  obs text,
  criado_em timestamptz not null default now());
alter table public.mvt_produtos enable row level security;

create table if not exists public.mvt_maquina_itens (
  codigo text not null references public.mvt_maquinas(codigo) on delete cascade,
  produto_id uuid not null references public.mvt_produtos(id) on delete cascade,
  qtd numeric(8,2) not null default 1 check (qtd > 0),
  primary key (codigo, produto_id));
alter table public.mvt_maquina_itens enable row level security;

insert into public.mvt_produtos(nome,categoria,custo) values
 ('Pelúcia Tradicional','Pelúcia',8.50),('Pelúcia Personagens','Pelúcia',13.00),('Pelúcia Warner','Pelúcia',39.90),
 ('Pelúcia Disney','Pelúcia',49.90),('Pelúcia Chaves','Pelúcia',39.90),('Pelúcia Licenciada','Pelúcia',null),
 ('Caixinha MV Caixa Surpresa','Embalagem',1.90),('Caixinha Petizzo Surpresa (pet)','Embalagem',1.90),
 ('Brinde para caixa surpresa','Conteúdo de caixa',null),('Cartas TCG','Carta colecionável',null)
on conflict (nome) do nothing;

insert into public.mvt_maquina_itens(codigo,produto_id,qtd)
select m.codigo, p.id, 1 from public.mvt_maquinas m join public.mvt_produtos p on p.nome = 'Pelúcia '||m.premio
where m.premio in ('Tradicional','Personagens','Warner','Disney','Chaves','Licenciada')
on conflict do nothing;

create or replace function public.mvt_estoque_json(a public.mvt_acessos) returns json
language sql security definer set search_path = public stable as $$
  with mov as (select * from public.mvt_estoque_mov),
  dep as (select produto, sum(case tipo when 'compra' then qtd when 'devolucao' then qtd when 'entrega' then -qtd when 'ajuste_deposito' then qtd else 0 end) qtd
          from mov group by produto),
  pes as (select pessoa_id, produto, sum(case tipo when 'entrega' then qtd when 'devolucao' then -qtd when 'ajuste_pessoa' then qtd else 0 end) qtd
          from mov where pessoa_id is not null group by pessoa_id, produto
          union all
          select v.acesso_id, p.nome, -sum(coalesce(v.premios_repostos,0)*i.qtd) from public.mvt_visitas v
            join public.mvt_maquina_itens i on i.codigo=v.codigo join public.mvt_produtos p on p.id=i.produto_id
          where v.acesso_id is not null group by v.acesso_id, p.nome),
  pes2 as (select pessoa_id, produto, sum(qtd) qtd from pes group by 1,2)
  select json_build_object(
    'produtos', coalesce((select json_agg(json_build_object('id',p.id,'nome',p.nome,'categoria',p.categoria,'unidade',p.unidade,
        'custo',case when a.papel<>'reabastecedor' then p.custo end,'ativo',p.ativo,'obs',p.obs,
        'deposito',case when a.papel in ('admin','socio') then coalesce((select qtd from dep where dep.produto=p.nome),0) end) order by p.categoria, p.nome)
        from public.mvt_produtos p),'[]'::json),
    'deposito', case when a.papel in ('admin','socio') then coalesce((select json_agg(json_build_object('produto',d.produto,'qtd',d.qtd,
        'custo_medio',(select custo from public.mvt_produtos where nome=d.produto)) order by d.produto) from dep d),'[]'::json) else '[]'::json end,
    'custos', coalesce((select json_object_agg(nome, custo) from public.mvt_produtos where custo is not null),'{}'::json),
    'pessoas', coalesce((select json_agg(json_build_object('pessoa_id',p.pessoa_id,'nome',x.nome,'produto',p.produto,'qtd',p.qtd) order by x.nome, p.produto)
        from pes2 p join public.mvt_acessos x on x.id=p.pessoa_id where p.qtd<>0 and (a.papel in ('admin','socio') or p.pessoa_id=a.id)),'[]'::json),
    'movimentos', case when a.papel='admin' then coalesce((select json_agg(json_build_object('id',m.id,'data',m.data,'tipo',m.tipo,'produto',m.produto,'qtd',m.qtd,
        'custo_unit',m.custo_unit,'pessoa',(select nome from public.mvt_acessos where id=m.pessoa_id),'obs',m.obs) order by m.data desc, m.criado_em desc)
        from (select * from mov order by data desc, criado_em desc limit 80) m),'[]'::json) else '[]'::json end) $$;
revoke all on function public.mvt_estoque_json(public.mvt_acessos) from public, anon, authenticated;

create or replace function public.mvt_itens_json(p_codigo text, p_din boolean) returns json
language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(json_build_object('produto_id',p.id,'nome',p.nome,'qtd',i.qtd,'custo',case when p_din then p.custo end) order by p.nome),'[]'::json)
  from public.mvt_maquina_itens i join public.mvt_produtos p on p.id=i.produto_id where i.codigo=p_codigo $$;
revoke all on function public.mvt_itens_json(text,boolean) from public, anon, authenticated;

create or replace function public.mvt_dados(p_sessao uuid) returns json
language plpgsql security definer set search_path = public as $function$
declare a public.mvt_acessos; cods text[]; din boolean; res json;
begin
  a := public.mvt_quem(p_sessao);
  if a.id is null then return json_build_object('erro','Sua sessão expirou. Entre de novo.'); end if;
  cods := public.mvt_cods(a);
  din := a.papel <> 'reabastecedor';
  select json_build_object(
    'eu', json_build_object('id',a.id,'nome',a.nome,'papel',a.papel,'email',a.email),
    'pode', json_build_object('editar',a.papel='admin','lancar',a.papel in ('admin','franqueado'),
                              'visitar',a.papel in ('admin','franqueado','reabastecedor'),'dinheiro',din,'acessos',a.papel='admin','estoque',a.papel='admin'),
    'maquinas', coalesce((select json_agg(json_build_object(
        'codigo',m.codigo,'tipo',m.tipo,'premio',m.premio,'ponto',m.ponto,'cidade',m.cidade,'jogada',m.jogada,
        'dono',case when din then m.dono end,'status',m.status,'capacidade',m.capacidade,
        'comissao_pct',case when din then m.comissao_pct end,'comissao_fixa',case when din then m.comissao_fixa end,'custo_premio',case when din then m.custo_premio end,
        'itens', public.mvt_itens_json(m.codigo, din),
        'leituras', case when din then (select coalesce(json_agg(json_build_object('mes',l.mes,'dinheiro',l.dinheiro,'pix',l.pix,'debito',l.debito,
              'credito',l.credito,'remoto',l.remoto,'premios',l.premios_qtd,'faturamento',l.faturamento,'fonte',l.fonte) order by l.mes),'[]'::json)
              from public.mvt_leituras_mensais l where l.codigo=m.codigo) else '[]'::json end,
        'ultima_visita',(select max(v.data) from public.mvt_visitas v where v.codigo=m.codigo),
        'pessoas', case when a.papel='admin' then (select coalesce(json_agg(json_build_object('nome',x.nome,'papel',x.papel)),'[]'::json)
              from public.mvt_vinculos vv join public.mvt_acessos x on x.id=vv.acesso_id where vv.codigo=m.codigo and x.ativo) end
      ) order by m.codigo) from public.mvt_maquinas m where m.codigo = any(cods)),'[]'::json),
    'lancamentos', case when din then coalesce((select json_agg(json_build_object('id',l.id,'codigo',l.codigo,'tipo',l.tipo,'categoria',l.categoria,
        'descricao',l.descricao,'valor',l.valor,'data',l.data,'competencia',l.competencia,'status',l.status,
        'meu', l.acesso_id=a.id) order by l.data desc)
        from public.mvt_lancamentos l where (a.papel in ('admin','socio') or l.codigo = any(cods))
          and l.competencia >= date_trunc('month', now()) - interval '13 months'),'[]'::json) else '[]'::json end,
    'visitas', coalesce((select json_agg(json_build_object('id',v.id,'codigo',v.codigo,'data',v.data,'repostos',v.premios_repostos,
        'visor',v.premios_no_visor,'recolhido',case when din then v.dinheiro_recolhido end,'limpeza',v.limpeza,'problema',v.problema,'produto',v.produto,
        'quem',(select nome from public.mvt_acessos where id=v.acesso_id),'meu',v.acesso_id=a.id) order by v.data desc, v.criado_em desc)
        from public.mvt_visitas v where v.codigo = any(cods) and v.data >= current_date - 400),'[]'::json),
    'resultados', case when din then coalesce((select json_agg(row_to_json(r) order by r.mes) from public.mvt_resultados_sociedade r
        where a.papel in ('admin','socio') or r.sociedade in (select distinct sociedade from public.mvt_vinculos where acesso_id=a.id)),'[]'::json) else '[]'::json end,
    'estoque', public.mvt_estoque_json(a),
    'pessoas_estoque', case when a.papel='admin' then coalesce((select json_agg(json_build_object('id',id,'nome',nome,'papel',papel) order by nome)
        from public.mvt_acessos where ativo and papel in ('admin','franqueado','reabastecedor')),'[]'::json) end
  ) into res;
  return res;
end $function$;

create or replace function public.mvt_admin_produto(p_sessao uuid, p_id uuid, p_nome text, p_categoria text, p_unidade text, p_custo numeric, p_ativo boolean, p_obs text) returns json
language plpgsql security definer set search_path = public as $$
declare antigo text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if coalesce(trim(p_nome),'')='' then return json_build_object('erro','Informe o nome do produto.'); end if;
  if p_custo is not null and p_custo < 0 then return json_build_object('erro','Custo inválido.'); end if;
  if exists (select 1 from public.mvt_produtos where lower(nome)=lower(trim(p_nome)) and id is distinct from p_id) then return json_build_object('erro','Já existe um produto com esse nome.'); end if;
  if p_id is null then
    insert into public.mvt_produtos(nome,categoria,unidade,custo,ativo,obs) values (trim(p_nome),coalesce(nullif(trim(p_categoria),''),'Outros'),coalesce(nullif(trim(p_unidade),''),'un'),p_custo,coalesce(p_ativo,true),nullif(trim(p_obs),''));
  else
    select nome into antigo from public.mvt_produtos where id=p_id;
    update public.mvt_produtos set nome=trim(p_nome),categoria=coalesce(nullif(trim(p_categoria),''),'Outros'),unidade=coalesce(nullif(trim(p_unidade),''),'un'),
      custo=p_custo,ativo=coalesce(p_ativo,true),obs=nullif(trim(p_obs),'') where id=p_id;
    if antigo is distinct from trim(p_nome) then update public.mvt_estoque_mov set produto=trim(p_nome) where produto=antigo; end if;
  end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.mvt_admin_itens(p_sessao uuid, p_codigo text, p_itens jsonb) returns json
language plpgsql security definer set search_path = public as $$
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if not exists (select 1 from public.mvt_maquinas where codigo=p_codigo) then return json_build_object('erro','Máquina não encontrada.'); end if;
  delete from public.mvt_maquina_itens where codigo=p_codigo;
  insert into public.mvt_maquina_itens(codigo,produto_id,qtd)
    select p_codigo, (x->>'produto_id')::uuid, greatest(coalesce((x->>'qtd')::numeric,1),0.01)
    from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) x
    where exists (select 1 from public.mvt_produtos where id=(x->>'produto_id')::uuid)
    on conflict (codigo,produto_id) do update set qtd=excluded.qtd;
  return json_build_object('ok',true);
end $$;

create or replace function public.mvt_salvar_mov(p_sessao uuid, p_tipo text, p_produto text, p_qtd integer, p_custo numeric, p_pessoa uuid, p_data date, p_obs text) returns json
language plpgsql security definer set search_path = public as $function$
declare a public.mvt_acessos;
begin
  a := public.mvt_quem(p_sessao);
  if a.id is null then return json_build_object('erro','Sua sessão expirou.'); end if;
  if a.papel <> 'admin' then return json_build_object('erro','Só o franqueador movimenta o estoque.'); end if;
  if p_tipo not in ('compra','entrega','devolucao','ajuste_deposito','ajuste_pessoa') then return json_build_object('erro','Tipo inválido.'); end if;
  if coalesce(trim(p_produto),'')='' then return json_build_object('erro','Informe o produto.'); end if;
  if not exists (select 1 from public.mvt_produtos where nome=trim(p_produto)) then return json_build_object('erro','Escolha um produto cadastrado (aba Estoque › Produtos).'); end if;
  if coalesce(p_qtd,0)=0 or (p_tipo in ('compra','entrega','devolucao') and p_qtd<0) then return json_build_object('erro','Informe a quantidade.'); end if;
  if p_tipo in ('entrega','devolucao','ajuste_pessoa') and p_pessoa is null then return json_build_object('erro','Escolha a pessoa.'); end if;
  insert into public.mvt_estoque_mov(data,tipo,produto,qtd,custo_unit,pessoa_id,obs,acesso_id)
  values (coalesce(p_data,current_date),p_tipo,trim(p_produto),p_qtd,case when p_tipo='compra' then p_custo end,
          case when p_tipo in ('entrega','devolucao','ajuste_pessoa') then p_pessoa end,nullif(trim(p_obs),''),a.id);
  return json_build_object('ok',true);
end $function$;

revoke all on function public.mvt_admin_produto(uuid,uuid,text,text,text,numeric,boolean,text), public.mvt_admin_itens(uuid,text,jsonb) from public;
grant execute on function public.mvt_admin_produto(uuid,uuid,text,text,text,numeric,boolean,text), public.mvt_admin_itens(uuid,text,jsonb) to anon, authenticated;
