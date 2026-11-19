-- migration mvt_produtos_e_composicao (pendente de aprovação do Lucas, 18/11/2026)
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

-- mvt_dados: igual à versão v3, acrescentando 'itens', public.mvt_itens_json(m.codigo, din) em cada máquina
-- (copie a função atual com: select pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure); e acrescente a linha)

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

-- mvt_salvar_mov: passa a exigir produto cadastrado:
--   if not exists (select 1 from public.mvt_produtos where nome=trim(coalesce(p_produto,''))) then return json_build_object('erro','Escolha um produto cadastrado (aba Estoque › Produtos).'); end if;

revoke all on function public.mvt_admin_produto(uuid,uuid,text,text,text,numeric,boolean,text), public.mvt_admin_itens(uuid,text,jsonb) from public;
grant execute on function public.mvt_admin_produto(uuid,uuid,text,text,text,numeric,boolean,text), public.mvt_admin_itens(uuid,text,jsonb) to anon, authenticated;
