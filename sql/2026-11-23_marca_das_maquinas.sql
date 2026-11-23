-- 23/11/2026 · Campo "Marca" na máquina. O código MVT continua sendo a máquina física (operação MV Toy);
-- a marca é o que a máquina vende e como se apresenta. Regra do Lucas: manter tudo no MVT.
alter table public.mvt_maquinas add column if not exists marca text not null default 'MV Toy';
update public.mvt_maquinas set marca='Print My Case (licenciado)' where tipo ilike '%capinha%';
update public.mvt_maquinas set marca='MV Cards' where codigo='MVT-0054';
update public.mvt_maquinas set marca='Pula Pula' where codigo='MVT-0055';
update public.mvt_maquinas set marca='Trostdorf Parfums' where codigo='MVT-0056';
update public.mvt_maquinas set marca='Petizzo Surpresa' where codigo='MVT-0057';

-- mvt_dados passa a devolver a marca
do $$ declare d text; begin
  select pg_get_functiondef('public.mvt_dados(uuid)'::regprocedure) into d;
  if position('''marca'',m.marca' in d) = 0 then
    execute replace(d, '''jogada'',m.jogada,', '''jogada'',m.jogada,''marca'',m.marca,');
  end if;
end $$;

-- salvar máquina com marca
drop function if exists public.mvt_admin_maquina(uuid,boolean,text,text,text,text,text,text,text,text,numeric,numeric,numeric,integer);
create or replace function public.mvt_admin_maquina(p_sessao uuid, p_novo boolean, p_codigo text, p_tipo text, p_ponto text, p_cidade text,
  p_jogada text, p_premio text, p_dono text, p_status text, p_comissao_pct numeric, p_comissao_fixa numeric, p_custo_premio numeric,
  p_capacidade integer, p_marca text default null)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare c text := upper(trim(p_codigo)); mk text := coalesce(nullif(trim(p_marca),''),'MV Toy');
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  if coalesce(c,'')='' or coalesce(trim(p_tipo),'')='' then return json_build_object('erro','Informe código e tipo.'); end if;
  if p_status not in ('Ativa','Parada','Manutenção','Em estoque') then return json_build_object('erro','Situação inválida.'); end if;
  if coalesce(p_comissao_pct,0) not between 0 and 100 then return json_build_object('erro','Comissão em % deve ficar entre 0 e 100.'); end if;
  if p_novo then
    if exists (select 1 from public.mvt_maquinas where codigo=c) then return json_build_object('erro','Já existe máquina com esse código.'); end if;
    insert into public.mvt_maquinas(codigo,tipo,ponto,cidade,jogada,premio,dono,status,comissao_pct,comissao_fixa,custo_premio,capacidade,marca,atualizado_em)
    values (c,trim(p_tipo),trim(p_ponto),trim(p_cidade),trim(p_jogada),trim(p_premio),trim(p_dono),p_status,coalesce(p_comissao_pct,0),coalesce(p_comissao_fixa,0),p_custo_premio,p_capacidade,mk,now());
  else
    update public.mvt_maquinas set tipo=trim(p_tipo),ponto=trim(p_ponto),cidade=trim(p_cidade),jogada=trim(p_jogada),premio=trim(p_premio),dono=trim(p_dono),
      status=p_status,comissao_pct=coalesce(p_comissao_pct,0),comissao_fixa=coalesce(p_comissao_fixa,0),custo_premio=p_custo_premio,capacidade=p_capacidade,
      marca=case when p_marca is null then marca else mk end,atualizado_em=now() where codigo=c;
    if not found then return json_build_object('erro','Máquina não encontrada.'); end if;
  end if;
  return json_build_object('ok',true);
end $function$;
grant execute on function public.mvt_admin_maquina(uuid,boolean,text,text,text,text,text,text,text,text,numeric,numeric,numeric,integer,text) to anon, authenticated;
select marca, count(*) from public.mvt_maquinas group by marca order by 2 desc;
