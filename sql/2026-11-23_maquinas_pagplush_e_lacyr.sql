-- 23/11/2026 · Cadastro das máquinas conforme o app PagPlush (prints do Lucas) + lote SmartMach da Parceria Lacyr.
-- Máquinas que já existem: só atualiza tipo/ponto/cidade/prêmio (não mexe em dono, comissão, custos).
insert into public.mvt_maquinas(codigo,tipo,premio,ponto,cidade,dono,status) values
 ('MVT-0031','Garra','Personagens','MV Play — Shopping Jaraguá (em frente à academia)','Araraquara','MV Toy','Ativa'),
 ('MVT-0032','Garra','Pelúcias Chaves','Estoque Matriz — Sede','Araraquara','MV Toy','Em estoque'),
 ('MVT-0033','Limpa Capacete',null,'Lago Azul KM 58 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0034','Capinha personalizada',null,'Shopping Jaraguá — em frente à Fair Play Diversões','Araraquara','MV Toy','Ativa'),
 ('MVT-0035','Fliperama',null,'MV Play — Shopping Jaraguá (em frente à academia)','Araraquara','MV Toy','Ativa'),
 ('MVT-0036','Garra','Tradicionais','MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0037','Garra','Personagens','MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0038','Air Hockey',null,'MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0039','Tesoura',null,'MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0040','Tesoura',null,'MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0041','Cartinhas',null,'MV Play — Shopping Passeio (embaixo da escada rolante)','São Carlos','MV Toy','Ativa'),
 ('MVT-0042','Soco',null,'Lago Azul KM 58 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0043','Soco',null,'Lago Azul KM 72 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0044','Cartinhas',null,'Lago Azul KM 64 — posto de gasolina','—','MV Toy','Ativa'),
 ('MVT-0045','Cartinhas',null,'Lago Azul KM 58 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0046','Cartinhas',null,'Lago Azul KM 72 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0047','Capinha personalizada',null,'Estoque Matriz — Sede','Araraquara','MV Toy','Em estoque'),
 ('MVT-0048','Capinha personalizada',null,'Estoque Matriz — Sede','Araraquara','MV Toy','Em estoque'),
 ('MVT-0049','Tesoura',null,'Lago Azul KM 64 — posto de gasolina','—','MV Toy','Ativa'),
 ('MVT-0050','Tesoura',null,'Lago Azul KM 58 — corredor externo','—','MV Toy','Ativa'),
 ('MVT-0052','Tesoura',null,'Lago Azul KM 72 — corredor externo','—','MV Toy','Ativa'),
 -- Parceria Lacyr · lote SmartMach (Lacyr 40% · irmãos Marques 30% · MV Toy 30%) — chegando, ponto a definir
 ('MVT-0051','Caixa Surpresa · Splendor (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque'),
 ('MVT-0053','Caixa Surpresa · Locker 12 portas (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque'),
 ('MVT-0054','MV Cards · Elegance Ambient (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque'),
 ('MVT-0055','Pula Pula snacks e bebidas · Elegance Cool (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque'),
 ('MVT-0056','Trostdorf Parfums · Elegance Max (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque'),
 ('MVT-0057','Petizzo Surpresa · Splendor Pet (SmartMach)',null,'A definir — lote SmartMach','—','Projeto SmartMach (Lacyr 40% · Marques 30% · MV Toy 30%)','Em estoque')
on conflict (codigo) do update set tipo=excluded.tipo, ponto=excluded.ponto, cidade=excluded.cidade,
  premio=coalesce(excluded.premio, public.mvt_maquinas.premio), status=excluded.status, atualizado_em=now();

-- relatório semanal: máquinas de cada KM do Lago Azul; shoppings preenchidos no portal (semanal)
update public.mvt_config set valor = (
  jsonb_set(jsonb_set(jsonb_set(valor::jsonb,
   '{locais,0,unidades,0,maquinas}','["MVT-0033","MVT-0042","MVT-0045","MVT-0050"]'),
   '{locais,0,unidades,1,maquinas}','["MVT-0044","MVT-0049"]'),
   '{locais,0,unidades,2,maquinas}','["MVT-0043","MVT-0046","MVT-0052"]')
  || jsonb_build_object('atualizado','2026-11-23','canal_shoppings','portal do shopping (semanal); prévia por e-mail ao Lucas até configurar'))::text
where chave='relatorio_semanal_locais';
