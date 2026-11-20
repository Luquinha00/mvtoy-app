-- Gera placa nova (número sequencial MVP-0001…) e a chave dela; tira a placa de teste do banco.
create or replace function public.mvt_admin_nova_placa(p_sessao uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare n int; novo text; seg text;
begin
  if public.mvt_admin_de(p_sessao) is null then return json_build_object('erro','Só o franqueador.'); end if;
  select coalesce(max(substring(id from 5)::int),0)+1 into n from public.mvt_tel_placas where id ~ '^MVP-[0-9]+$';
  novo := 'MVP-'||lpad(n::text,4,'0');
  seg := encode(gen_random_bytes(24),'hex');
  insert into public.mvt_tel_placas(id,segredo) values (novo,seg);
  return json_build_object('id',novo,'segredo',seg);
end $$;
revoke all on function public.mvt_admin_nova_placa(uuid) from public;
grant execute on function public.mvt_admin_nova_placa(uuid) to anon, authenticated;
delete from public.mvt_tel_placas where id='TESTE-0001';
