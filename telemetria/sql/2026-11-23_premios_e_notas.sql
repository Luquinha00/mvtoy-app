-- 23/11/2026 · Telemetria MV Toy: app mostra notas e prêmios do dia (eventos 'nota' e 'premio' gravados pela tel-sync v4)
-- e apaga a placa provisória do teste do servidor v4.
create or replace function public.mvt_admin_placas(p_sessao uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare eu uuid; pap text; d0 timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  select q.id, q.papel into eu, pap from public.mvt_tel_quem(p_sessao) q;
  if eu is null then return json_build_object('erro','Sessão expirada. Entre de novo.'); end if;
  return coalesce((select json_agg(json_build_object('id',p.id,'codigo',p.codigo,'valor_pulso',p.valor_pulso,
    'online',p.ultimo_contato > now() - interval '11 minutes','ultimo_contato',p.ultimo_contato,'rssi',p.ultimo_rssi,'firmware',p.firmware,
    'situacao',p.situacao,'dono',(select a.nome from public.mvt_acessos a where a.id=p.dono_acesso),
    'mensalidade',case when pap='admin' then p.mensalidade end,
    'pendentes',(select count(*) from public.mvt_tel_creditos c where c.placa_id=p.id and c.status in ('pendente','enviado')),
    'moedas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo in ('moeda','nota') and e.criado_em >= d0),
    'notas_hoje',(select coalesce(sum(valor),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='nota' and e.criado_em >= d0),
    'premios_hoje',(select coalesce(sum(pulsos),0) from public.mvt_tel_eventos e where e.placa_id=p.id and e.tipo='premio' and e.criado_em >= d0))
    order by p.id) from public.mvt_tel_placas p where pap='admin' or p.dono_acesso=eu),'[]'::json);
end $$;
delete from public.mvt_tel_placas where id='TESTE-0002';
