// MV Toy · app de gestão das máquinas (franqueador, sócio, franqueado, investidor, reabastecedor)
const URL_SB='https://koxormltidkmdwxgqbsm.supabase.co', KEY='sb_publishable_J7Ps1yZ4BPvFMof7coAAuQ_xO4I5QIe';
const SESS='mvt_sess';
const MESES_N=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PAPEIS={admin:'Franqueador',socio:'Sócio',franqueado:'Franqueado',investidor:'Investidor',reabastecedor:'Reabastecedor',cliente_telemetria:'Cliente Telemetria'};
const CAT_SAIDA=['Prêmios e pelúcias','Aluguel ou comissão do ponto','Manutenção e peças','Frete e deslocamento','Energia','Taxas de pagamento','Telemetria e internet','Royalties','Repasse ao investidor','Impostos','Outras saídas'];
const CAT_ENTRADA=['Venda de máquina ou peça','Aporte','Reembolso','Outras entradas'];
const STATUS=['Ativa','Manutenção','Parada','Em estoque'];
const PAGTO=[['pix','Pix','#4A37B5'],['debito','Débito','#52C4EA'],['credito','Crédito','#FFC61C'],['dinheiro','Dinheiro','#14653A'],['remoto','Remoto','#E23A2D']];

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0);
const brl=v=>'R$ '+num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl0=v=>'R$ '+num(v).toLocaleString('pt-BR',{maximumFractionDigits:0});
const nomeMes=m=>{const [y,mm]=String(m).slice(0,7).split('-');return MESES_N[+mm-1]+'/'+y.slice(2)};
const dataBR=d=>{if(!d)return '—';const [y,m,dd]=String(d).slice(0,10).split('-');return dd+'/'+m+'/'+y.slice(2)};
const hojeISO=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
const mesAtual=()=>hojeISO().slice(0,7)+'-01';
const diasDesde=d=>d?Math.floor((new Date(hojeISO())-new Date(String(d).slice(0,10)))/864e5):null;
const ls={get:k=>{try{return localStorage.getItem(k)}catch(_){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}},del:k=>{try{localStorage.removeItem(k)}catch(_){}}};
const rpc=async(fn,body)=>{const r=await fetch(URL_SB+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({erro:'Resposta inválida do servidor.'}));if(!r.ok&&!j.erro)return {erro:j.message||'Erro no servidor.'};return j};
const S=()=>ls.get(SESS);

let D=null, MES=null;

// ---------- cálculos ----------
const leit=(m,mes)=>m.leituras.find(l=>String(l.mes).slice(0,10)===mes);
const CAT_PREMIO='Prêmios e pelúcias', CAT_COM='Aluguel ou comissão do ponto';
// dinheiro: vale a contagem do cofre; sem contagem no mês, usa a telemetria (nunca soma os dois)
function dinheiroContado(m,mes){const vs=D.visitas.filter(v=>v.codigo===m.codigo&&String(v.data).slice(0,7)===mes.slice(0,7)&&v.recolhido!=null);return vs.length?vs.reduce((s,v)=>s+num(v.recolhido),0):null}
function receita(m,mes){const l=leit(m,mes),c=dinheiroContado(m,mes);if(!l)return c;return num(l.faturamento)-num(l.dinheiro)+(c!==null?c:num(l.dinheiro))}
const fat=(m,mes)=>receita(m,mes);
function visitasMaq(cod){return D.visitas.filter(v=>v.codigo===cod).sort((a,b)=>String(a.data).localeCompare(String(b.data)))}
function premiosSaidos(m,mes){const l=leit(m,mes);if(l&&num(l.premios)>0)return {qtd:num(l.premios),fonte:'telemetria'};
  const vs=visitasMaq(m.codigo);let q=0,ok=false;
  for(let i=1;i<vs.length;i++){const p=vs[i-1],v=vs[i];if(String(v.data).slice(0,7)!==mes.slice(0,7)||v.visor==null||(p.visor==null&&p.repostos==null))continue;
    q+=Math.max(0,num(p.visor)+num(p.repostos)-num(v.visor));ok=true}
  return ok?{qtd:q,fonte:'contagem nas visitas'}:null}
function estoqueMaq(m){const vs=visitasMaq(m.codigo);const u=vs[vs.length-1];if(!u||(u.visor==null&&u.repostos==null))return null;return {qtd:num(u.visor)+num(u.repostos),data:u.data}}
function custoPremio(m){if(m.itens&&m.itens.length){if(m.itens.some(i=>i.custo==null))return null;return m.itens.reduce((s,i)=>s+num(i.custo)*num(i.qtd),0)}
  if(m.custo_premio!=null)return num(m.custo_premio);const c=D.estoque&&D.estoque.custos;return c&&m.premio&&c[m.premio]!=null?num(c[m.premio]):null}
const semPremio=m=>!(m.itens&&m.itens.length)&&(!m.premio||/sem pr/i.test(m.premio));
const descItens=m=>(m.itens||[]).map(i=>`${String(num(i.qtd)).replace('.',',')}× ${esc(i.nome)}${i.custo!=null&&D.pode.dinheiro?' ('+brl(i.custo)+')':''}`).join(' + ');
function lucro(m,mes){const rec=receita(m,mes);if(rec===null)return null;const l=leit(m,mes),cont=dinheiroContado(m,mes);
  const ps=premiosSaidos(m,mes),cp=custoPremio(m),lm=lancMes(mes,m.codigo);
  const lancPremio=lm.filter(x=>x.tipo==='saida'&&x.categoria===CAT_PREMIO).reduce((s,x)=>s+num(x.valor),0);
  let custoP=semPremio(m)?0:(ps&&cp!==null?ps.qtd*cp:(lancPremio||null));
  const pagaCom=lm.filter(x=>x.tipo==='saida'&&x.categoria===CAT_COM).reduce((s,x)=>s+num(x.valor),0);
  const devida=rec*num(m.comissao_pct)/100+num(m.comissao_fixa),com=pagaCom>0?pagaCom:devida;
  const outras=lm.filter(x=>x.tipo==='saida'&&x.categoria!==CAT_COM&&x.categoria!==CAT_PREMIO).reduce((s,x)=>s+num(x.valor),0);
  const ent=lm.filter(x=>x.tipo==='entrada').reduce((s,x)=>s+num(x.valor),0);
  return {rec,eletr:l?num(l.faturamento)-num(l.dinheiro):0,dinTel:l?num(l.dinheiro):null,dinCont:cont,ps,cp,custoP,devida,pagaCom,com,outras,ent,
    lucro:rec-(custoP||0)-com-outras+ent,semCusto:custoP===null,semComissao:!num(m.comissao_pct)&&!num(m.comissao_fixa)&&!pagaCom}}
function lucroRede(mes){let t=0,rec=0,falta=0;D.maquinas.forEach(m=>{const x=lucro(m,mes);if(x){t+=x.lucro;rec+=x.rec;if(x.semCusto)falta++}});
  const ger=lancMes(mes).filter(l=>!l.codigo);t+=ger.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+num(l.valor),0)-ger.filter(l=>l.tipo==='saida').reduce((s,l)=>s+num(l.valor),0);
  return {lucro:t,rec,falta}}
function mesesComDado(){const s=new Set();D.maquinas.forEach(m=>m.leituras.forEach(l=>s.add(String(l.mes).slice(0,10))));
  D.lancamentos.forEach(l=>s.add(String(l.competencia).slice(0,10)));s.add(mesAtual());return [...s].sort()}
const lancMes=(mes,cod)=>D.lancamentos.filter(l=>String(l.competencia).slice(0,10)===mes&&(cod===undefined||l.codigo===cod));
function contas(mes,cod){const ls_=lancMes(mes,cod);const soma=(t,st)=>ls_.filter(l=>l.tipo===t&&(!st||l.status===st)).reduce((s,l)=>s+num(l.valor),0);
  const maqs=cod?D.maquinas.filter(m=>m.codigo===cod):D.maquinas;
  const f=maqs.reduce((s,m)=>s+(fat(m,mes)||0),0);
  return {fat:f,entradas:soma('entrada'),saidasPagas:soma('saida','pago'),saidasPrev:soma('saida','previsto'),saidas:soma('saida'),
    resultado:f+soma('entrada')-soma('saida')}}
function mesAnterior(mes){const d=new Date(mes+'T12:00:00');d.setMonth(d.getMonth()-1);return d.toISOString().slice(0,7)+'-01'}
function media3(m,mes){let v=[],x=mes;for(let i=0;i<3;i++){x=mesAnterior(x);const f=fat(m,x);if(f!==null)v.push(f)}return v.length?v.reduce((a,b)=>a+b,0)/v.length:null}
function ultimoMesFechado(){const ms=mesesComDado().filter(x=>x<mesAtual());return ms[ms.length-1]||mesAtual()}
function situacao(m){
  if(m.status&&m.status!=='Ativa')return {t:m.status,c:m.status==='Em estoque'?'b':'off'};
  if(!D.pode.dinheiro)return {t:'Ativa',c:''};
  const mf=ultimoMesFechado(),f=fat(m,mf),med=media3(m,mf);
  if(f===null)return {t:'Sem dado',c:'b'};
  if(med&&f<med*0.7)return {t:'Em queda',c:'off'};
  const vals=D.maquinas.map(x=>fat(x,mf)).filter(v=>v!==null).sort((a,b)=>a-b);const mid=vals.length?vals[Math.floor(vals.length/2)]:0;
  if(f>=mid*1.3)return {t:'Forte',c:''};
  if(f<mid*0.5)return {t:'Fraca',c:'y'};
  return {t:'Média',c:'b'}}
const stTag=m=>{const s=situacao(m);return `<span class="st ${s.c}">${esc(s.t)}</span>`};
const maq=c=>D.maquinas.find(m=>m.codigo===c);

// ---------- login ----------
function limpaLink(){ls.del('mvt_k');if(location.search)history.replaceState(null,'',location.pathname+location.hash)}
function semMenu(){$('#who').innerHTML='';$('#tabs').innerHTML='';$('#tabs').style.display='none'}
function telaLogin(email,msg){semMenu();
  $('#app').innerHTML=`<div class="card"><div class="login"><img src="marca/mestrinho.png" alt="" style="width:110px">
  <h2>Entrar no painel MV Toy</h2><p class="sub">Acompanhe as suas máquinas com e-mail e senha.</p>
  <form id="fLogin"><div><label>E-mail</label><input id="lEmail" type="email" autocomplete="username" required value="${esc(email||'')}"></div>
  <div><label>Senha</label><input id="lSenha" type="password" autocomplete="current-password" required></div>
  <div class="msg" id="lMsg">${esc(msg||'')}</div><button type="submit">Entrar</button></form>
  <p class="dica"><b>Primeiro acesso ou esqueceu a senha?</b><br><a href="#" id="lPrim">Receber um código no meu e-mail</a> e criar a senha.</p></div></div>`;
  $('#fLogin').onsubmit=async e=>{e.preventDefault();const m=$('#lMsg');m.textContent='Entrando…';
    try{const d=await rpc('mvt_login',{p_email:$('#lEmail').value,p_senha:$('#lSenha').value});
      if(d.erro){m.textContent=d.erro;return}ls.set(SESS,d.sessao);carregar()}catch(_){m.textContent='Sem conexão. Tente de novo.'}};
  $('#lPrim').onclick=e=>{e.preventDefault();telaCodigo($('#lEmail').value)}}
function telaCodigo(email){semMenu();
  $('#app').innerHTML=`<div class="card"><div class="login"><img src="marca/mestrinho.png" alt="" style="width:110px">
  <h2>Primeiro acesso ou nova senha</h2><p class="sub">Digite o e-mail liberado pela MV Toy. Vamos mandar um código de 6 números para ele.</p>
  <form id="fPed"><div><label>E-mail</label><input id="pEmail" type="email" autocomplete="username" required value="${esc(email||'')}"></div>
  <div class="msg" id="pMsg"></div><button type="submit">Enviar código</button></form>
  <form id="fCod" style="display:none;margin-top:6px"><div><label>Código recebido no e-mail</label><input id="kCod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>
  <div><label>Nova senha (mínimo 8 caracteres)</label><input id="kSenha" type="password" autocomplete="new-password" minlength="8" required></div>
  <div><label>Repita a senha</label><input id="kSenha2" type="password" autocomplete="new-password" minlength="8" required></div>
  <div class="msg" id="kMsg"></div><button type="submit">Salvar senha e entrar</button></form>
  <p class="dica"><a href="#" id="pVolta">Voltar para o login</a></p></div></div>`;
  const em=()=>$('#pEmail').value.trim();
  $('#pVolta').onclick=e=>{e.preventDefault();telaLogin(em())};
  $('#fPed').onsubmit=async e=>{e.preventDefault();const m=$('#pMsg');m.style.color='';m.textContent='Enviando…';
    try{const d=await rpc('mvt_pedir_codigo',{p_email:em()});if(d.erro){m.textContent=d.erro;return}
      m.style.color='var(--vd)';m.textContent='Se este e-mail tiver acesso liberado, o código chega em instantes (veja também o spam). Ele vale 15 minutos.';
      $('#pEmail').readOnly=true;const f=$('#fCod');f.style.display='flex';f.style.flexDirection='column';f.style.gap='10px';
      e.target.querySelector('button').textContent='Reenviar código';$('#kCod').focus()}catch(_){m.textContent='Sem conexão. Tente de novo.'}};
  $('#fCod').onsubmit=async e=>{e.preventDefault();const m=$('#kMsg');const a=$('#kSenha').value,b=$('#kSenha2').value;
    if(a!==b){m.textContent='As duas senhas não são iguais.';return}m.textContent='Salvando…';
    try{const d=await rpc('mvt_confirmar_codigo',{p_email:em(),p_codigo:$('#kCod').value,p_senha:a});if(d.erro){m.textContent=d.erro;return}
      ls.set(SESS,d.sessao);carregar()}catch(_){m.textContent='Sem conexão. Tente de novo.'}}}
async function sair(){const s=S();ls.del(SESS);try{if(s)await rpc('mvt_logout',{p_sessao:s})}catch(_){}D=null;MES=null;location.hash='';telaLogin('')}

async function carregar(manterMes){
  if(!S()){telaLogin('');return}
  let d;try{d=await rpc('mvt_dados',{p_sessao:S()})}catch(_){vazio('Não foi possível carregar agora. Tente de novo em instantes.');return}
  if(!d||d.erro){ls.del(SESS);telaLogin('',d&&d.erro);return}
  D=d;if(!manterMes||!MES){const ms=mesesComDado();MES=ultimoMesFechado();if(!ms.includes(MES))MES=ms[ms.length-1]}
  topo();rota()}
function vazio(msg){$('#app').innerHTML=`<div class="card empty"><img src="marca/mestrinho.png" alt=""><p>${msg}</p></div>`}

// ---------- topo e navegação ----------
function topo(){
  $('#who').innerHTML=`Olá,<b>${esc(D.eu.nome)}</b><span class="badge">${PAPEIS[D.eu.papel]||esc(D.eu.papel)}</span><button class="sair" id="btnSair">Sair</button>`;
  $('#btnSair').onclick=sair;
  const t=[['inicio','Início']];if(D.pode.dinheiro)t.push(['maquinas','Máquinas']);
  if(D.pode.dinheiro)t.push(['financeiro','Financeiro']);
  t.push(['visitas','Visitas']);if(D.pode.estoque)t.push(['estoque','Estoque']);if(D.pode.acessos||['franqueado','cliente_telemetria'].includes(D.eu.papel))t.push(['placas','Telemetria']);if(D.pode.acessos)t.push(['acessos','Acessos']);
  const tabs=$('#tabs');tabs.style.display='';tabs.innerHTML=t.map(([k,n])=>`<a href="#${k}" data-k="${k}">${n}</a>`).join('')}
function rota(){if(!D)return;const h=decodeURIComponent(location.hash.slice(1))||'inicio';
  const k=h.startsWith('m/')?'maquinas':h;document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.k===k));
  window.scrollTo(0,0);
  if(h.startsWith('m/'))return telaMaquina(h.slice(2));
  if(h==='placas'&&!(D.pode.acessos||['franqueado','cliente_telemetria'].includes(D.eu.papel)))return telaInicio();
  if(h==='acessos'&&!D.pode.acessos)return telaInicio();
  ({inicio:telaInicio,maquinas:telaMaquinas,financeiro:telaFinanceiro,visitas:telaVisitas,estoque:telaEstoque,placas:telaPlacas,acessos:telaAcessos}[h]||telaInicio)()}
window.addEventListener('hashchange',rota);
function seletorMes(){const ms=mesesComDado().slice(-13);
  return `<div class="meses">${ms.map(m=>`<button data-mes="${m}" class="${m===MES?'on':''}">${nomeMes(m)}${m===mesAtual()?' •':''}</button>`).join('')}</div>`}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-mes]');if(b){MES=b.dataset.mes;rota()}
  const tr=e.target.closest('tr[data-cod]');if(tr&&!e.target.closest('button,a'))location.hash='m/'+tr.dataset.cod});
const parcial=()=>MES===mesAtual()?'<span class="st y">mês em andamento</span>':'';

// ---------- início ----------
function telaInicio(){
  if(!D.maquinas.length){vazio('Olá, '+esc(D.eu.nome)+'! Ainda não há máquinas ligadas ao seu acesso.<br>Fale com a MV Toy para liberar.');return}
  if(!D.pode.dinheiro)return telaRota('inicio');
  const c=contas(MES),ant=contas(mesAnterior(MES));const ativas=D.maquinas.filter(m=>m.status==='Ativa').length;
  const varp=(MES!==mesAtual()&&ant.fat>0)?(c.fat/ant.fat-1)*100:null;
  let h=seletorMes()+`<div class="kpis">
   <div class="kpi"><div class="l">Receita ${nomeMes(MES)}</div><div class="v">${brl(c.fat)}</div><div class="s">${MES===mesAtual()?'parcial do mês':varp===null?'—':(varp>=0?'▲ ':'▼ ')+Math.abs(varp).toFixed(0)+'% vs mês anterior'}</div></div>
   <div class="kpi"><div class="l">Máquinas</div><div class="v">${D.maquinas.length}</div><div class="s">${ativas} ativas</div></div>
   <div class="kpi ${lucroRede(MES).lucro>=0?'g':'r'}"><div class="l">Lucro estimado</div><div class="v">${brl(lucroRede(MES).lucro)}</div><div class="s">${lucroRede(MES).falta?lucroRede(MES).falta+' máquina(s) sem custo de pelúcia':'faturamento − pelúcias − comissão − despesas'}</div></div>`;
  const res=D.resultados.filter(r=>String(r.mes).slice(0,10)===MES);
  if(D.eu.papel==='investidor')res.forEach(r=>{h+=`<div class="kpi g"><div class="l">Sua parte · ${nomeMes(MES)}</div><div class="v">${brl(r.parte_investidor)}</div><div class="s">rendimento ${String(r.rendimento_pct).replace('.',',')}% no mês</div></div>`});
  h+=`</div>`;
  // alertas
  const al=[];const mf=ultimoMesFechado();
  D.maquinas.forEach(m=>{if(m.status&&m.status!=='Ativa'&&m.status!=='Em estoque')al.push(['r','!',`<a class="mvt" href="#m/${m.codigo}">${m.codigo}</a> está <b>${esc(m.status)}</b> · ${esc(m.ponto)}`]);
    else if(m.status==='Ativa'){const f=fat(m,mf),md=media3(m,mf);if(f!==null&&md&&f<md*0.7)al.push(['y','▼',`<a class="mvt" href="#m/${m.codigo}">${m.codigo}</a> caiu ${Math.round((1-f/md)*100)}% em ${nomeMes(mf)} (${brl0(f)} vs média ${brl0(md)})`]);}});
  if(D.pode.visitar||D.eu.papel==='admin'){const sem=D.maquinas.filter(m=>m.status==='Ativa'&&(!m.ultima_visita||diasDesde(m.ultima_visita)>7));
    if(sem.length)al.push(['b','i',`${sem.length} máquina(s) ativas sem visita registrada nos últimos 7 dias. <a href="#visitas">Ver rota</a>`])}
  const baixo=D.maquinas.filter(m=>m.status==='Ativa'&&!semPremio(m)).map(m=>({m,e:estoqueMaq(m)})).filter(o=>o.e&&(o.m.capacidade?o.e.qtd<o.m.capacidade*0.3:o.e.qtd<10));
  if(baixo.length)al.push(['y','↓',`Pouca pelúcia: ${baixo.map(o=>`<a class="mvt" href="#m/${o.m.codigo}">${o.m.codigo}</a> (${o.e.qtd})`).join(', ')}`]);
  if(D.eu.papel==='admin'){const semCom=D.maquinas.filter(m=>m.status==='Ativa'&&!num(m.comissao_pct)&&!num(m.comissao_fixa)).length;
    const semCusto=D.maquinas.filter(m=>m.status==='Ativa'&&!semPremio(m)&&custoPremio(m)===null).length;
    if(semCom||semCusto)al.push(['b','i',`Para o lucro ficar real: ${semCom?semCom+' máquina(s) sem comissão do ponto':''}${semCom&&semCusto?' e ':''}${semCusto?semCusto+' sem custo de pelúcia':''}. Cadastre em Editar na ficha da máquina${semCusto?' ou registre a compra no Estoque':''}.`])}
  const semCont=D.maquinas.filter(m=>m.status==='Ativa'&&num((leit(m,ultimoMesFechado())||{}).dinheiro)>0&&!D.visitas.some(v=>v.codigo===m.codigo&&v.recolhido!=null&&diasDesde(v.data)<=31));
  if(semCont.length&&D.pode.visitar)al.push(['y','R$',`${semCont.length} máquina(s) recebem dinheiro e estão sem contagem do cofre há mais de 30 dias.`]);
  const prev=D.lancamentos.filter(l=>l.status==='previsto'&&l.tipo==='saida');
  if(prev.length)al.push(['y','$',`${prev.length} conta(s) previstas a pagar, total ${brl(prev.reduce((s,l)=>s+num(l.valor),0))}. <a href="#financeiro">Abrir financeiro</a>`]);
  h+=`<div class="grid2"><div class="card"><h2>Alertas</h2>${al.length?al.map(([c,i,t])=>`<div class="alerta"><i class="${c}">${i}</i><div>${t}</div></div>`).join(''):'<p class="sub">Tudo em ordem por aqui.</p>'}</div>`;
  const lin=D.maquinas.map(m=>({m,f:fat(m,MES)})).filter(x=>x.f!==null).sort((a,b)=>b.f-a.f);
  const mx=Math.max(1,...lin.map(x=>x.f));
  const linha=x=>`<tr class="clic" data-cod="${x.m.codigo}"><td><span class="mvt">${x.m.codigo}</span><small>${esc(x.m.tipo)} · ${esc(x.m.ponto)}</small></td><td class="r">${brl(x.f)}<div class="bar"><i style="width:${Math.round(x.f/mx*100)}%"></i></div></td></tr>`;
  h+=`<div class="card"><h2>Mais fortes · ${nomeMes(MES)} ${parcial()}</h2><table>${lin.slice(0,5).map(linha).join('')||'<tr><td class="sub">Sem dados no mês.</td></tr>'}</table>
   ${lin.length>5?`<h2 style="margin-top:14px">Mais fracas</h2><table>${lin.slice(-3).reverse().map(linha).join('')}</table>`:''}</div></div>`;
  h+=`<p class="nota y"><b>Sobre os dados:</b> cartão, Pix e remoto vêm da telemetria PagPlush; o dinheiro vale a contagem do cofre (sem contagem, usa a telemetria). O lucro desconta pelúcias, comissão do ponto e despesas lançadas.</p>`;
  $('#app').innerHTML=h}

// ---------- rota do reabastecedor ----------
function telaRota(){
  const ord=[...D.maquinas].sort((a,b)=>(a.ultima_visita||'0').localeCompare(b.ultima_visita||'0'));
  $('#app').innerHTML=meuEstoque()+`<div class="card"><h2>Minha rota <span class="sub">${ord.length} máquina(s)</span></h2>
   <p class="sub" style="margin-bottom:6px">As que estão há mais tempo sem visita aparecem primeiro.</p>
   ${ord.map(m=>{const d=diasDesde(m.ultima_visita);return `<div class="rotai"><div class="clic" data-ir="${m.codigo}"><span class="mvt">${m.codigo}</span> <span class="sub">${esc(m.tipo)} · ${esc(m.premio||'')}</span>${m.status!=='Ativa'?` <span class="st off">${esc(m.status)}</span>`:''}
   <div>${esc(m.ponto)} <span class="sub">· ${esc(m.cidade)}</span></div>
   <div class="sub">Última visita: ${m.ultima_visita?dataBR(m.ultima_visita)+(d===0?' (hoje)':' (há '+d+' dia(s))'):'<span class="st y">nunca</span>'}</div></div>
   <button class="btn" data-visita="${m.codigo}">Registrar visita</button></div>`}).join('')}</div>`}
document.addEventListener('click',e=>{const x=e.target.closest('[data-ir]');if(x)location.hash='m/'+x.dataset.ir});
document.addEventListener('click',e=>{const b=e.target.closest('button[data-visita]');if(b)formVisita(b.dataset.visita)});

// ---------- lista de máquinas ----------
let FILTRO={q:'',st:''};
function telaMaquinas(){
  if(!D.pode.dinheiro)return telaRota();
  const lista=()=>{const q=FILTRO.q.toLowerCase();
    const ms=D.maquinas.filter(m=>(!FILTRO.st||situacao(m).t===FILTRO.st||m.status===FILTRO.st)&&(!q||[m.codigo,m.tipo,m.ponto,m.cidade,m.dono,m.premio].join(' ').toLowerCase().includes(q)))
      .map(m=>({m,f:fat(m,MES),ant:fat(m,mesAnterior(MES)),c:contas(MES,m.codigo)})).sort((a,b)=>(b.f??-1)-(a.f??-1));
    const mx=Math.max(1,...ms.map(x=>x.f||0));const tot=ms.reduce((s,x)=>s+(x.f||0),0);
    return `<p class="sub" style="margin-bottom:6px">${ms.length} máquina(s) · ${brl(tot)} em ${nomeMes(MES)}</p><div class="wrap"><table><tr><th>Máquina</th><th class="cj">Ponto</th><th>Situação</th><th class="r">Faturamento</th><th class="r cj">Resultado</th></tr>`+
    ms.map(({m,f,ant,c})=>{const dv=(MES!==mesAtual()&&f!==null&&ant>0)?(f/ant-1)*100:null;
     return `<tr class="clic" data-cod="${m.codigo}"><td><a class="mvt" href="#m/${m.codigo}">${m.codigo}</a><small>${esc(m.tipo)}${m.premio&&m.premio!=='sem prêmio'?' · '+esc(m.premio):''}${m.jogada?' · '+esc(m.jogada):''} · ${LINHAS[linhaDe(m.tipo)].nome}</small><small class="so-mob">${esc(m.ponto)}</small></td>
     <td class="cj">${esc(m.ponto)}<small>${esc(m.cidade)}${D.eu.papel!=='investidor'?' · '+esc(m.dono||''):''}</small></td><td>${stTag(m)}</td>
     <td class="r">${f===null?'<small>sem dado</small>':brl(f)+(dv===null?'':`<small style="color:${dv>=0?'var(--vd)':'var(--rt)'}">${dv>=0?'▲':'▼'} ${Math.abs(dv).toFixed(0)}%</small>`)}<div class="bar"><i style="width:${f?Math.round(f/mx*100):0}%"></i></div></td>
     <td class="r cj">${c.saidas||c.entradas?brl(c.resultado):'<small>—</small>'}</td></tr>`}).join('')+`</table></div>`};
  $('#app').innerHTML=seletorMes()+`<div class="card"><h2>Máquinas ${parcial()}${D.pode.editar?'<button class="btn acao" id="novaMaq">+ Nova máquina</button>':''}</h2>
   <div class="busca"><input id="fq" placeholder="Buscar por código, ponto, cidade, prêmio…" value="${esc(FILTRO.q)}">
   <select id="fst"><option value="">Todas as situações</option>${['Forte','Média','Fraca','Em queda','Sem dado',...STATUS.filter(s=>s!=='Ativa')].map(s=>`<option ${FILTRO.st===s?'selected':''}>${s}</option>`).join('')}</select></div>
   <div id="lista">${lista()}</div></div>`;
  $('#fq').oninput=e=>{FILTRO.q=e.target.value;$('#lista').innerHTML=lista()};
  $('#fst').onchange=e=>{FILTRO.st=e.target.value;$('#lista').innerHTML=lista()};
  if($('#novaMaq'))$('#novaMaq').onclick=()=>formMaquina(null)}

// ---------- ficha da máquina ----------
function grafico(m){const ms=mesesComDado().slice(-12);const vals=ms.map(x=>fat(m,x));const mx=Math.max(1,...vals.map(v=>v||0));
  const W=620,H=170,bw=W/ms.length;
  return `<svg viewBox="0 0 ${W} ${H+34}" style="width:100%;height:auto;max-height:240px;display:block" role="img" aria-label="Faturamento dos últimos meses">`+
  ms.map((x,i)=>{const v=vals[i]||0,h=Math.round(v/mx*H),sel=x===MES;
    return `<g data-gmes="${x}" style="cursor:pointer"><rect x="${i*bw+6}" y="0" width="${bw-12}" height="${H}" fill="transparent"/>
    <rect x="${i*bw+6}" y="${H-h}" width="${bw-12}" height="${Math.max(h,vals[i]===null?0:2)}" rx="5" fill="${sel?'#FFC61C':'#4A37B5'}" opacity="${x===mesAtual()?.55:1}"/>
    <text x="${i*bw+bw/2}" y="${H+14}" font-size="11" text-anchor="middle" fill="#6B6596" font-family="Poppins">${nomeMes(x)}</text>
    ${sel&&vals[i]!==null?`<text x="${i*bw+bw/2}" y="${H+30}" font-size="11" font-weight="700" text-anchor="middle" fill="#211C5E" font-family="Poppins">${brl0(v)}</text>`:''}</g>`}).join('')+`</svg>`}
document.addEventListener('click',e=>{const g=e.target.closest('[data-gmes]');if(g){MES=g.dataset.gmes;rota()}});
function linhasLucro(x){const L=(t,v,cl,sub)=>`<tr><td>${t}${sub?`<small>${sub}</small>`:''}</td><td class="r" style="${cl||''}">${v}</td></tr>`;
  return `<table>${L('Cartão, Pix e remoto',brl(x.eletr))}
  ${L('Dinheiro',x.dinCont!==null?brl(x.dinCont):x.dinTel!==null?brl(x.dinTel):'—','',x.dinCont!==null?`contado no cofre · telemetria ${brl(x.dinTel||0)} · diferença ${(x.dinCont-num(x.dinTel))>=0?'+':''}${brl(x.dinCont-num(x.dinTel))}`:'telemetria (ainda sem contagem no mês)')}
  ${L('<b>Receita</b>','<b>'+brl(x.rec)+'</b>')}
  ${L('− Prêmios que saíram (produtos)',x.custoP===null?'<span class="st y">falta custo</span>':brl(x.custoP),'color:var(--rt)',x.ps?`${x.ps.qtd} un. (${x.ps.fonte})${x.cp!==null?' × '+brl(x.cp):''}`:'sem contagem de prêmios')}
  ${L('− Comissão / aluguel do ponto',brl(x.com),'color:var(--rt)',x.pagaCom?`paga (devida pelo combinado: ${brl(x.devida)})`:x.devida?'devida pelo combinado (ainda não lançada como paga)':'comissão não cadastrada')}
  ${x.outras?L('− Outras despesas da máquina',brl(x.outras),'color:var(--rt)'):''}${x.ent?L('+ Outras entradas',brl(x.ent),'color:var(--vd)'):''}
  ${L('<b>Lucro da máquina</b>','<b>'+brl(x.lucro)+'</b>',x.lucro>=0?'color:var(--vd)':'color:var(--rt)')}</table>`}
function telaMaquina(cod){const m=maq(cod);if(!m){vazio('Máquina não encontrada no seu acesso. <a href="#maquinas">Voltar</a>');return}
  const din=D.pode.dinheiro,est=estoqueMaq(m);
  let h=`<a class="voltar" href="#${din?'maquinas':'inicio'}">‹ Voltar</a><div class="card"><div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
   <div><h1 class="tit">${esc(m.codigo)} · ${esc(m.tipo)}</h1><p class="sub">${esc(m.ponto)} · ${esc(m.cidade)}</p>
   <div class="tags">${stTag(m)}<span>Jogada ${esc(m.jogada||'—')}</span><span>Prêmio: ${esc(m.premio||'—')}</span>${din&&m.dono?`<span>${esc(m.dono)}</span>`:''}
   ${din&&(num(m.comissao_pct)||num(m.comissao_fixa))?`<span>Comissão ${num(m.comissao_pct)?String(num(m.comissao_pct)).replace('.',',')+'%':''}${num(m.comissao_pct)&&num(m.comissao_fixa)?' + ':''}${num(m.comissao_fixa)?brl(m.comissao_fixa):''}</span>`:''}
   <span>Última visita: ${m.ultima_visita?dataBR(m.ultima_visita):'nenhuma'}</span>
   ${m.itens&&m.itens.length?`<span>Cada prêmio: ${descItens(m)}</span>`:''}
   ${!semPremio(m)?`<span>Na máquina: ${est?est.qtd+' pelúcias'+(m.capacidade?' de '+m.capacidade:'')+' (contagem '+dataBR(est.data)+')':'sem contagem'}</span>`:''}</div></div>
   <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${D.pode.visitar?`<button class="btn" data-visita="${m.codigo}">Registrar visita</button>`:''}
   ${D.pode.lancar?`<button class="btn s" id="lancM">Lançar valor</button>`:''}${D.pode.editar?`<button class="btn s" id="editM">Editar</button>`:''}</div></div></div>`;
  if(din){const x=lucro(m,MES),l=leit(m,MES),md=media3(m,MES);
    h+=seletorMes()+`<div class="kpis"><div class="kpi"><div class="l">Receita ${nomeMes(MES)}</div><div class="v">${x?brl(x.rec):'—'}</div><div class="s">${MES===mesAtual()?'parcial':md?'média 3 meses: '+brl0(md):'—'}</div></div>
     <div class="kpi"><div class="l">Prêmios que saíram</div><div class="v">${x&&x.ps?x.ps.qtd:semPremio(m)?'—':'?'}</div><div class="s">${x&&x.ps?x.ps.fonte:semPremio(m)?'máquina sem prêmio':'registre a contagem na visita'}</div></div>
     <div class="kpi r"><div class="l">Comissão do ponto</div><div class="v">${x?brl(x.com):'—'}</div><div class="s">${x&&x.pagaCom?'paga':'devida pelo combinado'}</div></div>
     <div class="kpi ${x&&x.lucro>=0?'g':'r'}"><div class="l">Lucro da máquina</div><div class="v">${x?brl(x.lucro):'—'}</div><div class="s">${x&&x.semCusto?'falta o custo das pelúcias':x&&x.rec?Math.round(x.lucro/x.rec*100)+'% da receita':''}</div></div></div>`;
    h+=`<div class="grid2"><div class="card"><h2>Lucro · ${nomeMes(MES)} ${parcial()}</h2>${x?linhasLucro(x):'<p class="sub">Sem dados no mês.</p>'}</div>`;
    h+=`<div class="card"><h2>Receita por mês <span class="sub">toque na barra</span></h2>${grafico(m)}`;
    if(l){const tot=PAGTO.reduce((s,[k])=>s+num(l[k]),0)||1;
      h+=`<h2 style="margin-top:12px">Como pagaram (telemetria)</h2><div class="pag">${PAGTO.map(([k,n,c])=>num(l[k])?`<i style="width:${num(l[k])/tot*100}%;background:${c}" title="${n}"></i>`:'').join('')}</div>
      <div class="leg">${PAGTO.filter(([k])=>num(l[k])).map(([k,n,c])=>`<span style="--c:${c}">${n} ${brl(l[k])}</span>`).join('')}</div><p class="mini" style="margin-top:6px">Fonte: ${esc(l.fonte||'telemetria')}</p>`}
    h+=`</div></div>`;
    h+=`<div class="card"><h2>Lançamentos · ${nomeMes(MES)}</h2>${tabelaLanc(lancMes(MES,m.codigo),false)}</div>`}
  const vs=D.visitas.filter(v=>v.codigo===m.codigo).slice(0,15);
  h+=`<div class="card"><h2>Visitas e contagens</h2>${tabelaVisitas(vs,false)}</div>`;
  if(D.pode.acessos&&m.pessoas)h+=`<div class="card"><h2>Quem acompanha esta máquina</h2>${m.pessoas.length?`<div class="tags">${m.pessoas.map(p=>`<span>${esc(p.nome)} · ${PAPEIS[p.papel]||p.papel}</span>`).join('')}</div>`:'<p class="sub">Só o franqueador e os sócios. Ligue pessoas em Acessos.</p>'}</div>`;
  $('#app').innerHTML=h;
  if(D.pode.acessos)(PLACAS?Promise.resolve(PLACAS):buscarPlacas()).then(ps=>{const p=ps.find(x=>x.codigo===m.codigo);const tg=document.querySelector('#app .tags');
    if(p&&tg&&location.hash==='#m/'+m.codigo)tg.insertAdjacentHTML('beforeend',`<span>Placa ${esc(p.id)}</span>${stPlaca(p)}<button class="btn s" data-cred="${esc(m.codigo)}" style="padding:2px 10px">Crédito remoto</button>`)});
  if($('#lancM'))$('#lancM').onclick=()=>formLanc(null,m.codigo);
  if($('#editM'))$('#editM').onclick=()=>formMaquina(m)}

// ---------- financeiro ----------
function tabelaLanc(ls_,comMaq){if(!ls_.length)return '<p class="sub">Nenhum lançamento.</p>';
  return `<div class="wrap"><table><tr><th>Data</th>${comMaq?'<th>Máquina</th>':''}<th>Categoria</th><th class="r">Valor</th><th></th></tr>`+ls_.map(l=>{
    const pode=D.pode.editar||(D.pode.lancar&&l.meu);
    return `<tr><td>${dataBR(l.data)}${l.status==='previsto'?' <span class="st y">a pagar</span>':''}</td>${comMaq?`<td>${l.codigo?`<a class="mvt" href="#m/${l.codigo}">${l.codigo}</a>`:'<small>geral</small>'}</td>`:''}
    <td>${esc(l.categoria)}<small>${esc(l.descricao||'')}</small></td><td class="r" style="color:${l.tipo==='saida'?'var(--rt)':'var(--vd)'}">${l.tipo==='saida'?'− ':'+ '}${brl(l.valor)}</td>
    <td class="r">${pode?`<button class="lnk" data-elanc="${l.id}">editar</button>`:''}</td></tr>`}).join('')+`</table></div>`}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-elanc]');if(b)formLanc(D.lancamentos.find(l=>l.id===b.dataset.elanc))});
function telaFinanceiro(){const c=contas(MES);const lm=lancMes(MES);const LR=lucroRede(MES);
  const cats={};lm.filter(l=>l.tipo==='saida').forEach(l=>cats[l.categoria]=(cats[l.categoria]||0)+num(l.valor));
  const xs=D.maquinas.map(m=>({m,x:lucro(m,MES)})).filter(o=>o.x);
  const dTel=xs.filter(o=>o.x.dinCont!==null).reduce((s,o)=>s+num(o.x.dinTel),0),dCont=xs.reduce((s,o)=>s+(o.x.dinCont||0),0),nCont=xs.filter(o=>o.x.dinCont!==null).length;
  const dTelTot=xs.reduce((s,o)=>s+num(o.x.dinTel),0),dinRec=xs.reduce((s,o)=>s+(o.x.dinCont!==null?o.x.dinCont:num(o.x.dinTel)),0);
  const comDev=xs.reduce((s,o)=>s+o.x.devida,0),comPaga=xs.reduce((s,o)=>s+o.x.pagaCom,0),semCom=xs.filter(o=>o.x.semComissao).length;
  let h=seletorMes()+`<div class="kpis"><div class="kpi"><div class="l">Receita das máquinas</div><div class="v">${brl(LR.rec)}</div><div class="s">cartão/Pix + dinheiro ${nomeMes(MES)}</div></div>
   <div class="kpi"><div class="l">Recebido em dinheiro</div><div class="v">${brl(dinRec)}</div><div class="s">${nCont?nCont+' máq. pela contagem, demais pela telemetria':'pela telemetria (sem contagem no mês)'}</div></div>
   <div class="kpi r"><div class="l">Comissões dos pontos</div><div class="v">${brl(comPaga||comDev)}</div><div class="s">${comPaga?'pagas · devidas '+brl(comDev):'devidas pelo combinado'}${semCom?' · '+semCom+' sem comissão cadastrada':''}</div></div>
   <div class="kpi ${LR.lucro>=0?'g':'r'}"><div class="l">Lucro estimado</div><div class="v">${brl(LR.lucro)}</div><div class="s">${LR.falta?LR.falta+' máquina(s) sem custo de pelúcia':LR.rec?Math.round(LR.lucro/LR.rec*100)+'% da receita':''}</div></div></div>`;
  h+=`<div class="grid2"><div class="card"><h2>Dinheiro: telemetria × contagem</h2>${nCont?`<table><tr><td>Telemetria (máquinas contadas)</td><td class="r">${brl(dTel)}</td></tr><tr><td>Contado no cofre</td><td class="r">${brl(dCont)}</td></tr>
     <tr><td><b>Diferença</b></td><td class="r"><b style="color:${dCont-dTel>=0?'var(--vd)':'var(--rt)'}">${dCont-dTel>=0?'+':''}${brl(dCont-dTel)}</b></td></tr></table>
     <p class="mini" style="margin-top:6px">Vale o contado. A telemetria do dinheiro (${brl(dTelTot)} no mês) só é usada nas máquinas ainda sem contagem — os dois nunca somam.</p>`
     :`<p class="sub">Nenhuma contagem de dinheiro registrada em ${nomeMes(MES)}. Ao registrar a visita, informe o dinheiro contado no cofre.</p>`}</div>
   <div class="card"><h2>Saídas lançadas por categoria</h2>${Object.keys(cats).length?`<table>${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}<div class="bar"><i style="width:${Math.round(v/c.saidas*100)}%;background:var(--verm)"></i></div></td><td class="r">${brl(v)}</td></tr>`).join('')}</table>`:'<p class="sub">Nenhuma saída lançada no mês.</p>'}</div></div>`;
  const res=D.resultados.filter(r=>String(r.mes).slice(0,10)===MES);
  if(res.length)h+=`<div class="card"><h2>Fechamento das sociedades · ${nomeMes(MES)}</h2><div class="wrap"><table><tr><th>Sociedade</th><th class="r">Faturamento</th><th class="r">Resultado</th><th class="r">Parte do investidor</th><th class="r cj">Rendimento</th></tr>`+
    res.map(r=>`<tr><td>${esc(r.sociedade)}<small>${esc(r.documento||'')}</small></td><td class="r">${brl(r.faturamento)}</td><td class="r">${brl(r.resultado)}</td><td class="r"><b style="color:var(--vd)">${brl(r.parte_investidor)}</b></td><td class="r cj">${String(r.rendimento_pct).replace('.',',')}%</td></tr>`).join('')+`</table></div><p class="mini" style="margin-top:6px">O fechamento completo, com os comprovantes, é enviado todo dia 10.</p></div>`;
  h+=`<div class="card"><h2>Lucro por máquina · ${nomeMes(MES)} ${parcial()}<button class="btn s acao" id="csv">Baixar planilha</button></h2><div class="wrap"><table><tr><th>Máquina</th><th class="r">Receita</th><th class="r cj">Pelúcias</th><th class="r cj">Comissão</th><th class="r cj">Outras</th><th class="r">Lucro</th></tr>`+
    xs.sort((a,b)=>b.x.lucro-a.x.lucro).map(({m,x})=>`<tr class="clic" data-cod="${m.codigo}"><td><span class="mvt">${m.codigo}</span><small>${esc(m.ponto)}</small></td><td class="r">${brl0(x.rec)}</td>
    <td class="r cj">${x.custoP===null?'<span class="st y">?</span>':x.custoP?brl0(x.custoP):'—'}</td><td class="r cj">${x.com?brl0(x.com):'—'}</td><td class="r cj">${x.outras?brl0(x.outras):'—'}</td>
    <td class="r" style="color:${x.lucro>=0?'var(--vd)':'var(--rt)'}"><b>${brl0(x.lucro)}</b></td></tr>`).join('')+`</table></div>
    <p class="mini" style="margin-top:6px">Lucro = receita − pelúcias que saíram × custo − comissão (paga ou, se não lançada, a combinada) − outras despesas da máquina. “?” = falta o custo da pelúcia (cadastre na máquina ou registre a compra no Estoque).</p></div>`;
  h+=`<div class="card"><h2>Lançamentos · ${nomeMes(MES)}${D.pode.lancar?'<button class="btn acao" id="novoL">+ Novo lançamento</button>':''}</h2>${tabelaLanc(lm,true)}</div>`;
  const prev=D.lancamentos.filter(l=>l.status==='previsto').sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  if(prev.length)h+=`<div class="card"><h2>Contas a pagar (todos os meses)</h2>${tabelaLanc(prev,true)}</div>`;
  h+=`<p class="nota">Cartão, Pix e remoto vêm da telemetria; o dinheiro vale a contagem do cofre. Compras de pelúcias entram no Estoque (não precisa lançar de novo aqui). Os meses fechados antes de nov/26 estão nos PDFs de fechamento.</p>`;
  $('#app').innerHTML=h;if($('#novoL'))$('#novoL').onclick=()=>formLanc(null);
  $('#csv').onclick=()=>{const f=v=>String(Math.round(num(v)*100)/100).replace('.',',');
    const linhas=[['Máquina','Ponto','Cidade','Cartão/Pix/remoto','Dinheiro telemetria','Dinheiro contado','Receita','Pelúcias saídas','Custo pelúcias','Comissão','Outras despesas','Outras entradas','Lucro']]
      .concat(xs.map(({m,x})=>[m.codigo,m.ponto,m.cidade,f(x.eletr),x.dinTel===null?'':f(x.dinTel),x.dinCont===null?'':f(x.dinCont),f(x.rec),x.ps?x.ps.qtd:'',x.custoP===null?'':f(x.custoP),f(x.com),f(x.outras),f(x.ent),f(x.lucro)]));
    const csv='\ufeff'+linhas.map(l=>l.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(';')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='MVToy_lucro_'+MES.slice(0,7)+'.csv';a.click()}}

// ---------- visitas ----------
function tabelaVisitas(vs,comMaq){if(!vs.length)return '<p class="sub">Nenhuma visita registrada.</p>';
  return `<div class="wrap"><table><tr><th>Data</th>${comMaq?'<th>Máquina</th>':''}<th class="r cj">Contagem</th><th class="r">Colocou</th>${D.pode.dinheiro?'<th class="r cj">Dinheiro contado</th>':''}<th>Obs.</th><th></th></tr>`+
  vs.map(v=>`<tr><td>${dataBR(v.data)}<small>${esc(v.quem||'')}</small></td>${comMaq?`<td><a class="mvt" href="#m/${v.codigo}">${v.codigo}</a><small>${esc((maq(v.codigo)||{}).ponto||'')}</small></td>`:''}
  <td class="r cj">${v.visor??'—'}</td><td class="r">${v.repostos??'—'}</td>${D.pode.dinheiro?`<td class="r cj">${v.recolhido!=null?brl(v.recolhido):'—'}</td>`:''}
  <td>${v.limpeza?'<span class="st">limpeza</span> ':''}${v.problema?`<span class="st off">problema</span><small>${esc(v.problema)}</small>`:''}</td>
  <td class="r">${(D.pode.editar||v.meu)?`<button class="lnk" data-dvis="${v.id}">apagar</button>`:''}</td></tr>`).join('')+`</table></div>`}
document.addEventListener('click',async e=>{const b=e.target.closest('button[data-dvis]');if(!b)return;if(!confirm('Apagar esta visita?'))return;
  const d=await rpc('mvt_apagar_visita',{p_sessao:S(),p_id:b.dataset.dvis});if(d.erro){alert(d.erro);return}carregar(true)});
function meuEstoque(){const p=((D.estoque||{}).pessoas||[]).filter(x=>x.pessoa_id===D.eu.id);if(!p.length&&D.eu.papel!=='reabastecedor')return '';
  const tot=p.reduce((s,x)=>s+num(x.qtd),0);
  return `<div class="card"><h2>Pelúcias com você <span class="sub">${tot} no total</span></h2>${p.length?`<div class="tags">${p.map(x=>`<span><b>${num(x.qtd)}</b> ${esc(x.produto)}</span>`).join('')}</div>`:'<p class="sub">Nenhuma pelúcia registrada com você.</p>'}
   <p class="mini" style="margin-top:6px">Entregas e devoluções são registradas pela MV Toy; o que você repõe nas visitas sai daqui automaticamente.</p></div>`}
function telaVisitas(){
  let h=D.eu.papel==='franqueado'?meuEstoque():'';
  if(D.pode.visitar)h+=`<div class="card"><h2>Registrar visita<button class="btn acao" data-visita="">+ Nova visita</button></h2><p class="sub">Escolha a máquina, informe os prêmios repostos e o que encontrou no ponto.</p></div>`;
  if(D.pode.visitar&&D.eu.papel!=='reabastecedor'){const sem=D.maquinas.filter(m=>m.status==='Ativa').sort((a,b)=>(a.ultima_visita||'0').localeCompare(b.ultima_visita||'0')).slice(0,8);
    h+=`<div class="card"><h2>Rota sugerida <span class="sub">há mais tempo sem visita</span></h2><table>${sem.map(m=>`<tr class="clic" data-cod="${m.codigo}"><td><span class="mvt">${m.codigo}</span><small>${esc(m.ponto)} · ${esc(m.cidade)}</small></td><td>${m.ultima_visita?'há '+diasDesde(m.ultima_visita)+' dia(s)':'<span class="st y">nunca</span>'}</td><td class="r"><button class="btn s" data-visita="${m.codigo}">Registrar</button></td></tr>`).join('')}</table></div>`}
  h+=`<div class="card"><h2>Últimas visitas</h2>${tabelaVisitas(D.visitas.slice(0,60),true)}</div>`;
  $('#app').innerHTML=h}

// ---------- formulários ----------
function modal(html,init){const w=document.createElement('div');w.className='modal';w.innerHTML=`<div class="box">${html}</div>`;
  w.addEventListener('click',e=>{if(e.target===w||e.target.closest('[data-fechar]'))w.remove()});document.body.appendChild(w);init&&init(w);return w}
const optMaq=(sel,vazio)=>(vazio?`<option value="">${vazio}</option>`:'')+D.maquinas.map(m=>`<option value="${m.codigo}" ${m.codigo===sel?'selected':''}>${m.codigo} · ${esc(m.tipo)} · ${esc(m.ponto)}</option>`).join('');
function formVisita(cod){
  modal(`<h3>Registrar visita</h3><form class="form" id="fv">
   <div><label>Máquina</label><select id="vMaq" required>${optMaq(cod,'Escolha a máquina')}</select></div>
   <div><label>Data</label><input id="vData" type="date" value="${hojeISO()}" max="${hojeISO()}" required></div>
   <p class="mini" id="vInfo"></p>
   <div class="lin"><div><label>Prêmios que estavam na máquina (contagem)</label><input id="vVis" type="number" min="0" inputmode="numeric"></div>
   <div><label>Prêmios que você colocou</label><input id="vRep" type="number" min="0" inputmode="numeric"></div></div>
   <div><label>Dinheiro contado no cofre (R$)</label><input id="vRec" type="number" min="0" step="0.01" inputmode="decimal" placeholder="deixe vazio se não abriu o cofre"></div>
   <label class="chk"><input type="checkbox" id="vLim"> Fiz a limpeza da máquina</label>
   <div><label>Problema encontrado (se houver)</label><textarea id="vPro" rows="2" placeholder="Ex.: garra fraca, noteiro travado, luz apagada"></textarea></div>
   <label class="chk"><input type="checkbox" id="vPar"> A máquina ficou parada / precisa de manutenção</label>
   <div class="msg" id="vMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar visita</button></div></form>`,w=>{
   const info=()=>{const m=maq(w.querySelector('#vMaq').value);if(!m){w.querySelector('#vInfo').textContent='';return}const e=estoqueMaq(m);
     const nomes=(m.itens||[]).map(i=>i.nome);const meu=((D.estoque||{}).pessoas||[]).filter(x=>x.pessoa_id===D.eu.id&&nomes.includes(x.produto)).map(x=>num(x.qtd)+' '+x.produto).join(', ');
     w.querySelector('#vInfo').textContent=semPremio(m)?'Máquina sem prêmio: só informe o dinheiro e o que encontrou.':`Cada prêmio: ${(m.itens||[]).map(i=>num(i.qtd)+'× '+i.nome).join(' + ')||m.premio}. ${e?'Última contagem: '+e.qtd+' na máquina ('+dataBR(e.data)+').':'Ainda sem contagem nesta máquina.'}${meu?' Com você: '+meu+'.':''}`};
   w.querySelector('#vMaq').onchange=info;info();
   w.querySelector('#fv').onsubmit=async e=>{e.preventDefault();const g=id=>w.querySelector(id),n=id=>g(id).value===''?null:Number(g(id).value);
    g('#vMsg').textContent='Salvando…';
    const d=await rpc('mvt_salvar_visita',{p_sessao:S(),p_codigo:g('#vMaq').value,p_data:g('#vData').value,p_repostos:n('#vRep'),p_visor:n('#vVis'),
      p_recolhido:n('#vRec'),p_limpeza:g('#vLim').checked,p_problema:g('#vPro').value,p_parada:g('#vPar').checked});
    if(d.erro){g('#vMsg').textContent=d.erro;return}w.remove();carregar(true)}})}
function formLanc(l,cod){const novo=!l;l=l||{tipo:'saida',codigo:cod||'',data:hojeISO(),competencia:MES,status:'pago'};
  const cats=t=>(t==='saida'?CAT_SAIDA:CAT_ENTRADA).map(c=>`<option ${c===l.categoria?'selected':''}>${c}</option>`).join('');
  const optsMes=mesesComDado().slice(-13).map(m=>`<option value="${m}" ${m===String(l.competencia).slice(0,10)?'selected':''}>${nomeMes(m)}</option>`).join('');
  modal(`<h3>${novo?'Novo lançamento':'Editar lançamento'}</h3><form class="form" id="fl">
   <div class="lin"><div><label>Tipo</label><select id="lTipo"><option value="saida" ${l.tipo==='saida'?'selected':''}>Saída (custo)</option><option value="entrada" ${l.tipo==='entrada'?'selected':''}>Entrada</option></select></div>
   <div><label>Situação</label><select id="lSt"><option value="pago" ${l.status==='pago'?'selected':''}>Pago / recebido</option><option value="previsto" ${l.status==='previsto'?'selected':''}>A pagar / previsto</option></select></div></div>
   <div><label>Máquina</label><select id="lMaq">${optMaq(l.codigo,D.eu.papel==='admin'?'Geral (sem máquina)':null)}</select></div>
   <div><label>Categoria</label><select id="lCat">${cats(l.tipo)}</select></div>
   <div class="lin"><div><label>Valor (R$)</label><input id="lVal" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${l.valor||''}"></div>
   <div><label>Data</label><input id="lData" type="date" required value="${String(l.data).slice(0,10)}"></div></div>
   <div><label>Mês de referência</label><select id="lComp">${optsMes}</select></div>
   <div><label>Descrição</label><input id="lDesc" maxlength="140" value="${esc(l.descricao||'')}" placeholder="Ex.: 40 pelúcias Disney, aluguel de novembro"></div>
   <div class="msg" id="lMsg"></div><div class="bts">${novo?'':'<button type="button" class="btn d" id="lDel">Apagar</button>'}<button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);g('#lTipo').onchange=()=>{g('#lCat').innerHTML=(g('#lTipo').value==='saida'?CAT_SAIDA:CAT_ENTRADA).map(c=>`<option>${c}</option>`).join('')};
   if(g('#lDel'))g('#lDel').onclick=async()=>{if(!confirm('Apagar este lançamento?'))return;const d=await rpc('mvt_apagar_lancamento',{p_sessao:S(),p_id:l.id});if(d.erro){g('#lMsg').textContent=d.erro;return}w.remove();carregar(true)};
   g('#fl').onsubmit=async e=>{e.preventDefault();g('#lMsg').textContent='Salvando…';
    const d=await rpc('mvt_salvar_lancamento',{p_sessao:S(),p_id:novo?null:l.id,p_codigo:g('#lMaq').value||null,p_tipo:g('#lTipo').value,p_categoria:g('#lCat').value,
      p_descricao:g('#lDesc').value,p_valor:Number(g('#lVal').value),p_data:g('#lData').value,p_competencia:g('#lComp').value,p_status:g('#lSt').value});
    if(d.erro){g('#lMsg').textContent=d.erro;return}w.remove();carregar(true)}})}
function formMaquina(m){const novo=!m;m=m||{codigo:'',tipo:'Garra',status:'Ativa'};
  modal(`<h3>${novo?'Nova máquina':'Editar '+esc(m.codigo)}</h3><form class="form" id="fm">
   <div class="lin"><div><label>Código</label><input id="mCod" required value="${esc(m.codigo)}" ${novo?'placeholder="MVT-0036"':'readonly'}></div>
   <div><label>Situação</label><select id="mSt">${STATUS.map(s=>`<option ${s===m.status?'selected':''}>${s}</option>`).join('')}</select></div></div>
   <div class="lin"><div><label>Tipo</label><input id="mTipo" required value="${esc(m.tipo)}" list="tiposM"></div><div><label>Jogada</label><input id="mJog" value="${esc(m.jogada||'')}" placeholder="R$ 5"></div></div>
   <datalist id="tiposM">${[...new Set(D.maquinas.map(x=>x.tipo))].map(t=>`<option value="${esc(t)}">`).join('')}</datalist>
   <div><label>Ponto</label><input id="mPon" value="${esc(m.ponto||'')}"></div>
   <div class="lin"><div><label>Cidade</label><input id="mCid" value="${esc(m.cidade||'')}"></div><div><label>Prêmio</label><input id="mPre" value="${esc(m.premio||'')}" placeholder="Disney, Tradicional, sem prêmio"></div></div>
   <div><label>Dono / sociedade</label><input id="mDon" value="${esc(m.dono||'MV Toy')}" list="donosM"></div>
   <datalist id="donosM">${[...new Set(D.maquinas.map(x=>x.dono).filter(Boolean))].map(t=>`<option value="${esc(t)}">`).join('')}</datalist>
   <div class="lin"><div><label>Comissão do ponto (%)</label><input id="mCp" type="number" min="0" max="100" step="0.01" value="${m.comissao_pct??''}" placeholder="ex.: 20"></div>
   <div><label>Aluguel fixo do ponto (R$/mês)</label><input id="mCf" type="number" min="0" step="0.01" value="${m.comissao_fixa??''}" placeholder="ex.: 300"></div></div>
   <div><label>O que sai em cada prêmio</label><div id="mItens" class="form" style="gap:6px"></div><button type="button" class="lnk" id="mAddItem">+ adicionar produto</button>
   <p class="mini">Ex.: Caixa Surpresa = 1 caixinha + 1 brinde. Máquina sem prêmio (soco, basquete…): deixe vazio.</p></div>
   <div class="lin"><div><label>Capacidade (prêmios)</label><input id="mCap" type="number" min="0" value="${m.capacidade??''}"></div><div></div></div>
   <div class="msg" id="mMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id).value;const box=w.querySelector('#mItens');
   const linhaItem=(pid,q)=>{const d=document.createElement('div');d.className='lin';d.style.gridTemplateColumns='1fr 80px 30px';
     d.innerHTML=`<select class="iP"><option value="">— produto —</option>${produtos().map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${esc(p.nome)}</option>`).join('')}</select><input class="iQ" type="number" min="0.01" step="0.01" value="${q||1}"><button type="button" class="lnk" title="remover">×</button>`;
     d.querySelector('button').onclick=()=>d.remove();box.appendChild(d)};
   (m.itens||[]).forEach(i=>linhaItem(i.produto_id,i.qtd));if(!(m.itens||[]).length&&novo)linhaItem('',1);
   w.querySelector('#mAddItem').onclick=()=>linhaItem('',1);
   w.querySelector('#fm').onsubmit=async e=>{e.preventDefault();w.querySelector('#mMsg').textContent='Salvando…';
    const d=await rpc('mvt_admin_maquina',{p_sessao:S(),p_novo:novo,p_codigo:g('#mCod'),p_tipo:g('#mTipo'),p_ponto:g('#mPon'),p_cidade:g('#mCid'),
      p_jogada:g('#mJog'),p_premio:g('#mPre'),p_dono:g('#mDon'),p_status:g('#mSt'),
      p_comissao_pct:g('#mCp')===''?0:Number(g('#mCp')),p_comissao_fixa:g('#mCf')===''?0:Number(g('#mCf')),p_custo_premio:m.custo_premio??null,p_capacidade:g('#mCap')===''?null:Number(g('#mCap'))});
    if(d.erro){w.querySelector('#mMsg').textContent=d.erro;return}
    const itens=[...box.querySelectorAll('.lin')].map(l=>({produto_id:l.querySelector('.iP').value,qtd:Number(l.querySelector('.iQ').value)||1})).filter(i=>i.produto_id);
    const r2=await rpc('mvt_admin_itens',{p_sessao:S(),p_codigo:g('#mCod').trim().toUpperCase(),p_itens:itens});if(r2.erro){w.querySelector('#mMsg').textContent=r2.erro;return}
    w.remove();await carregar(true);if(novo)location.hash='m/'+g('#mCod').trim().toUpperCase()}})}

// ---------- estoque (franqueador) ----------
const TIPOS_MOV={compra:'Compra (entra no depósito)',entrega:'Entrega ao reabastecedor',devolucao:'Devolução ao depósito',ajuste_deposito:'Ajuste do depósito (contagem)',ajuste_pessoa:'Ajuste com a pessoa (contagem)'};
function produtos(){return ((D.estoque||{}).produtos||[]).filter(p=>p.ativo)}
function telaEstoque(){const E=D.estoque||{deposito:[],pessoas:[],movimentos:[]};
  const naMaq=D.maquinas.filter(m=>!semPremio(m)).map(m=>({m,e:estoqueMaq(m)}));
  const totDep=E.deposito.reduce((s,x)=>s+num(x.qtd),0),totPes=E.pessoas.reduce((s,x)=>s+num(x.qtd),0),totMaq=naMaq.reduce((s,o)=>s+(o.e?o.e.qtd:0),0);
  const valor=E.deposito.reduce((s,x)=>s+num(x.qtd)*num(x.custo_medio),0);
  let h=`<div class="kpis"><div class="kpi"><div class="l">No depósito</div><div class="v">${totDep}</div><div class="s">${valor?'≈ '+brl(valor)+' a custo':'pelúcias'}</div></div>
   <div class="kpi"><div class="l">Com reabastecedores</div><div class="v">${totPes}</div><div class="s">itens</div></div>
   <div class="kpi"><div class="l">Nas máquinas</div><div class="v">${totMaq}</div><div class="s">pela última contagem</div></div>
   <div class="kpi"><div class="l">Total</div><div class="v">${totDep+totPes+totMaq}</div><div class="s">itens na rede</div></div></div>
   <div class="card"><h2>Movimentar<span class="acao" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-mov="compra">+ Compra</button><button class="btn s" data-mov="entrega">Entregar ao reabastecedor</button><button class="btn s" data-mov="devolucao">Devolução</button><button class="btn s" data-mov="ajuste_deposito">Ajuste</button></span></h2>
   <p class="sub">Compra entra no depósito com o custo de cada pelúcia (vira o custo médio usado no lucro). Entrega passa do depósito para o reabastecedor; o que ele coloca nas máquinas sai dele pelas visitas.</p></div>
   <div class="card"><h2>Produtos e insumos<button class="btn s acao" id="novoProd">+ Novo produto</button></h2>
   <p class="sub" style="margin-bottom:8px">Tudo o que a MV Toy compra e sai nas máquinas: pelúcias, caixinhas, conteúdo das caixas, cartas… O custo cadastrado é o usado no lucro.</p>
   ${(E.produtos||[]).length?`<div class="wrap"><table><tr><th>Produto</th><th class="cj">Categoria</th><th class="r">Custo</th><th class="r">No depósito</th><th class="r cj">Máquinas</th></tr>${(E.produtos||[]).map(p=>{const nm=D.maquinas.filter(m=>(m.itens||[]).some(i=>i.produto_id===p.id)).length;
     return `<tr class="clic" data-prod="${p.id}"><td><b>${esc(p.nome)}</b>${p.ativo?'':' <span class="st off">inativo</span>'}<small>${esc(p.obs||'')}</small></td><td class="cj">${esc(p.categoria)}</td>
     <td class="r">${p.custo!=null?brl(p.custo):'<span class="st y">falta</span>'}</td><td class="r">${num(p.deposito)}</td><td class="r cj">${nm||'—'}</td></tr>`}).join('')}</table></div>`:'<p class="sub">Nenhum produto cadastrado.</p>'}</div>
   <div class="grid2"><div class="card"><h2>Depósito</h2>${E.deposito.length?`<table><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Custo</th></tr>${E.deposito.map(x=>`<tr><td>${esc(x.produto)}</td><td class="r" style="${num(x.qtd)<0?'color:var(--rt)':''}">${num(x.qtd)}</td><td class="r">${x.custo_medio!=null?brl(x.custo_medio):'—'}</td></tr>`).join('')}</table>`:'<p class="sub">Nenhuma compra registrada.</p>'}</div>
   <div class="card"><h2>Com cada pessoa</h2>${E.pessoas.length?`<table><tr><th>Pessoa</th><th>Produto</th><th class="r">Qtd</th></tr>${E.pessoas.map(x=>`<tr><td>${esc(x.nome)}</td><td>${esc(x.produto)}</td><td class="r" style="${num(x.qtd)<0?'color:var(--rt)':''}">${num(x.qtd)}</td></tr>`).join('')}</table><p class="mini" style="margin-top:6px">Número negativo = colocou nas máquinas mais do que recebeu: falta registrar uma entrega ou fazer um ajuste.</p>`:'<p class="sub">Ninguém está com pelúcias registradas.</p>'}</div></div>
   <div class="card"><h2>Nas máquinas</h2><div class="wrap"><table><tr><th>Máquina</th><th>Prêmio</th><th class="r">Pelúcias</th><th class="r cj">Contagem</th></tr>${naMaq.sort((a,b)=>(a.e?a.e.qtd:-1)-(b.e?b.e.qtd:-1)).map(({m,e})=>`<tr class="clic" data-cod="${m.codigo}"><td><span class="mvt">${m.codigo}</span><small>${esc(m.ponto)}</small></td><td>${esc(m.premio)}</td>
   <td class="r">${e?e.qtd+(m.capacidade?`<small>de ${m.capacidade}</small>`:''):'<span class="st y">sem contagem</span>'}</td><td class="r cj">${e?dataBR(e.data):'—'}</td></tr>`).join('')}</table></div></div>
   <div class="card"><h2>Últimas movimentações</h2>${E.movimentos.length?`<div class="wrap"><table><tr><th>Data</th><th>Movimento</th><th class="r">Qtd</th><th></th></tr>${E.movimentos.map(x=>`<tr><td>${dataBR(x.data)}</td><td>${TIPOS_MOV[x.tipo]||x.tipo} · ${esc(x.produto)}<small>${[x.pessoa?esc(x.pessoa):'',x.custo_unit!=null?brl(x.custo_unit)+' cada':'',esc(x.obs||'')].filter(Boolean).join(' · ')}</small></td><td class="r">${x.qtd}</td><td class="r"><button class="lnk" data-dmov="${x.id}">apagar</button></td></tr>`).join('')}</table></div>`:'<p class="sub">Nenhuma movimentação.</p>'}</div>`;
  $('#app').innerHTML=h;$('#novoProd').onclick=()=>formProduto(null)}
document.addEventListener('click',e=>{const tr=e.target.closest('tr[data-prod]');if(tr)formProduto(((D.estoque||{}).produtos||[]).find(p=>p.id===tr.dataset.prod))});
const CATS_PROD=['Pelúcia','Embalagem','Conteúdo de caixa','Carta colecionável','Capinha','Insumo','Outros'];
function formProduto(p){const novo=!p;p=p||{nome:'',categoria:'Pelúcia',unidade:'un',custo:null,ativo:true,obs:''};
  modal(`<h3>${novo?'Novo produto':esc(p.nome)}</h3><form class="form" id="fp">
   <div><label>Nome</label><input id="pNome" required value="${esc(p.nome)}" placeholder="Ex.: Caixinha MV Caixa Surpresa"></div>
   <div class="lin"><div><label>Categoria</label><input id="pCat" list="catsP" value="${esc(p.categoria)}"></div><div><label>Unidade</label><input id="pUn" value="${esc(p.unidade||'un')}"></div></div>
   <datalist id="catsP">${CATS_PROD.map(c=>`<option value="${c}">`).join('')}</datalist>
   <div class="lin"><div><label>Custo por unidade (R$)</label><input id="pCusto" type="number" min="0" step="0.01" inputmode="decimal" value="${p.custo??''}"></div>
   <div><label>Situação</label><select id="pAt"><option value="1" ${p.ativo?'selected':''}>Ativo</option><option value="0" ${!p.ativo?'selected':''}>Inativo</option></select></div></div>
   <div><label>Observação</label><input id="pObs" maxlength="140" value="${esc(p.obs||'')}" placeholder="fornecedor, tamanho…"></div>
   <div class="msg" id="pMsg2"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);g('#fp').onsubmit=async e=>{e.preventDefault();g('#pMsg2').textContent='Salvando…';
    const d=await rpc('mvt_admin_produto',{p_sessao:S(),p_id:novo?null:p.id,p_nome:g('#pNome').value,p_categoria:g('#pCat').value,p_unidade:g('#pUn').value,
      p_custo:g('#pCusto').value===''?null:Number(g('#pCusto').value),p_ativo:g('#pAt').value==='1',p_obs:g('#pObs').value});
    if(d.erro){g('#pMsg2').textContent=d.erro;return}w.remove();carregar(true)}})}
document.addEventListener('click',async e=>{const b=e.target.closest('button[data-mov]');if(b)formMov(b.dataset.mov);
  const d=e.target.closest('button[data-dmov]');if(d){if(!confirm('Apagar esta movimentação?'))return;const r=await rpc('mvt_apagar_mov',{p_sessao:S(),p_id:d.dataset.dmov});if(r.erro){alert(r.erro);return}carregar(true)}});
function formMov(tipo){const pess=D.pessoas_estoque||[];
  modal(`<h3>Movimentar estoque</h3><form class="form" id="fe">
   <div><label>Tipo</label><select id="eTipo">${Object.entries(TIPOS_MOV).map(([k,v])=>`<option value="${k}" ${k===tipo?'selected':''}>${v}</option>`).join('')}</select></div>
   <div><label>Produto</label><select id="eProd" required>${produtos().map(p=>`<option value="${esc(p.nome)}">${esc(p.nome)} · ${esc(p.categoria)}</option>`).join('')}</select></div>
   <div><label id="eQtdL">Quantidade</label><input id="eQtd" type="number" step="1" required inputmode="numeric"></div>
   <div id="eCustoW"><label>Custo de cada pelúcia (R$)</label><input id="eCusto" type="number" min="0" step="0.01" inputmode="decimal"></div>
   <div id="ePesW"><label>Pessoa</label><select id="ePes">${pess.map(p=>`<option value="${p.id}">${esc(p.nome)} · ${PAPEIS[p.papel]||p.papel}</option>`).join('')}</select></div>
   <div class="lin"><div><label>Data</label><input id="eData" type="date" value="${hojeISO()}" required></div><div><label>Observação</label><input id="eObs" maxlength="120" placeholder="fornecedor, nota…"></div></div>
   <div class="msg" id="eMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);const vis=()=>{const t=g('#eTipo').value;g('#eCustoW').style.display=t==='compra'?'':'none';
     g('#ePesW').style.display=['entrega','devolucao','ajuste_pessoa'].includes(t)?'':'none';
     g('#eQtdL').textContent=t.startsWith('ajuste')?'Diferença (+ sobrou / − faltou)':'Quantidade'};vis();g('#eTipo').onchange=vis;
   const pc=()=>{const p=produtos().find(x=>x.nome===g('#eProd').value);if(p&&p.custo!=null&&!g('#eCusto').value)g('#eCusto').placeholder='cadastrado: '+brl(p.custo)};pc();g('#eProd').onchange=pc;
   g('#fe').onsubmit=async e=>{e.preventDefault();g('#eMsg').textContent='Salvando…';
    const d=await rpc('mvt_salvar_mov',{p_sessao:S(),p_tipo:g('#eTipo').value,p_produto:g('#eProd').value,p_qtd:parseInt(g('#eQtd').value,10),
      p_custo:g('#eCusto').value===''?null:Number(g('#eCusto').value),p_pessoa:g('#ePes').value||null,p_data:g('#eData').value,p_obs:g('#eObs').value});
    if(d.erro){g('#eMsg').textContent=d.erro;return}w.remove();carregar(true)}})}

// ---------- acessos (franqueador) ----------
let ACESSOS=[];
async function telaAcessos(){
  $('#app').innerHTML='<div class="card"><p class="sub">Carregando acessos…</p></div>';
  const lista=await rpc('mvt_admin_listar',{p_sessao:S()});if(!Array.isArray(lista)){vazio(esc(lista.erro||'Sem acesso.'));return}
  ACESSOS=lista;
  $('#app').innerHTML=`<div class="card"><h2>Acessos ao painel<button class="btn acao" id="novoA">+ Liberar acesso</button></h2>
   <p class="sub" style="margin-bottom:10px">Libere o e-mail, escolha o papel e marque as máquinas. A pessoa entra em <b>Primeiro acesso</b>, recebe um código no e-mail e cria a própria senha.</p>
   <div class="wrap"><table><tr><th>Pessoa</th><th>Papel</th><th class="r">Máquinas</th><th>Situação</th></tr>${lista.map(u=>`<tr class="clic" data-acesso="${u.id}">
   <td><b>${esc(u.nome)}</b><small>${esc(u.email)}</small></td><td>${PAPEIS[u.papel]||esc(u.papel)}</td>
   <td class="r">${['admin','socio'].includes(u.papel)?'todas':u.maquinas.length}</td>
   <td>${!u.ativo?'<span class="st off">Bloqueado</span>':u.tem_senha?`<span class="st">Ativo</span><small>${u.ultimo_login?'último acesso '+dataBR(u.ultimo_login):''}</small>`:'<span class="st y">Aguardando 1º acesso</span>'}</td></tr>`).join('')}</table></div></div>
   <div class="card"><h2>O que cada papel vê</h2><table>
   <tr><td><b>Franqueador</b></td><td>Tudo: máquinas, financeiro, visitas, acessos e cadastro.</td></tr>
   <tr><td><b>Sócio</b></td><td>Toda a rede e o financeiro, só leitura.</td></tr>
   <tr><td><b>Franqueado</b></td><td>As máquinas marcadas; lança custos e registra visitas nelas.</td></tr>
   <tr><td><b>Investidor</b></td><td>As máquinas marcadas, faturamento, custos e a parte dele; só leitura.</td></tr>
   <tr><td><b>Reabastecedor</b></td><td>A rota das máquinas marcadas e o registro de visitas; não vê faturamento.</td></tr></table></div>`;
  $('#novoA').onclick=()=>formAcesso(null)}
document.addEventListener('click',e=>{const tr=e.target.closest('tr[data-acesso]');if(tr)formAcesso(ACESSOS.find(u=>u.id===tr.dataset.acesso))});
function formAcesso(u){const novo=!u;u=u||{nome:'',email:'',papel:'investidor',ativo:true,maquinas:[]};
  modal(`<h3>${novo?'Liberar acesso':esc(u.nome)}</h3><form class="form" id="fa">
   <div><label>Nome</label><input id="aNome" required value="${esc(u.nome)}"></div>
   <div><label>E-mail</label><input id="aEmail" type="email" required value="${esc(u.email)}"></div>
   <div class="lin"><div><label>Papel</label><select id="aPapel">${Object.entries(PAPEIS).map(([k,v])=>`<option value="${k}" ${k===u.papel?'selected':''}>${v}</option>`).join('')}</select></div>
   <div><label>Situação</label><select id="aAtivo"><option value="1" ${u.ativo?'selected':''}>Liberado</option><option value="0" ${!u.ativo?'selected':''}>Bloqueado</option></select></div></div>
   <div id="aMaqsW"><label>Máquinas que esta pessoa vê</label><div class="maqs">${D.maquinas.map(m=>`<label><input type="checkbox" value="${m.codigo}" ${u.maquinas.includes(m.codigo)?'checked':''}><span><b>${m.codigo}</b> ${esc(m.ponto)}</span></label>`).join('')}</div></div>
   <div class="msg" id="aMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);const vis=()=>{g('#aMaqsW').style.display=['admin','socio'].includes(g('#aPapel').value)?'none':''};vis();g('#aPapel').onchange=vis;
   g('#fa').onsubmit=async e=>{e.preventDefault();g('#aMsg').textContent='Salvando…';
    const d=await rpc('mvt_admin_salvar',{p_sessao:S(),p_id:novo?null:u.id,p_nome:g('#aNome').value,p_email:g('#aEmail').value,p_papel:g('#aPapel').value,p_ativo:g('#aAtivo').value==='1'});
    if(d.erro){g('#aMsg').textContent=d.erro;return}
    const id=d.id||u.id;const cods=[...w.querySelectorAll('.maqs input:checked')].map(i=>i.value);
    if(!['admin','socio'].includes(g('#aPapel').value)){const v=await rpc('mvt_admin_vincular',{p_sessao:S(),p_acesso:id,p_codigos:cods});if(v.erro){g('#aMsg').textContent=v.erro;return}}
    w.remove();await carregar(true);location.hash='acessos';telaAcessos()}})}

// ---------- Telemetria MV Toy (placas próprias) ----------
let PLACAS=null;
async function buscarPlacas(){const r=await rpc('mvt_admin_placas',{p_sessao:S()});PLACAS=Array.isArray(r)?r:[];return PLACAS}
const tempoDesde=t=>{if(!t)return 'nunca';const s=Math.floor((Date.now()-new Date(t))/1000);if(s<90)return 'agora';if(s<3600)return Math.floor(s/60)+' min';if(s<86400)return Math.floor(s/3600)+' h';return Math.floor(s/86400)+' dias'};
const stPlaca=p=>(p.situacao==='suspensa'?'<span class="st y">Suspensa</span> ':'')+(p.online?'<span class="st">Online</span>':`<span class="st off">Offline · ${tempoDesde(p.ultimo_contato)}</span>`);
let TEL_LINHA='pulso';
// Duas linhas de placa: Touch Pulse (máquinas de pulso) e Touch Vending (vending machines MDB)
const LINHAS={pulso:{nome:'Touch Pulse',pre:'TMV'},mdb:{nome:'Touch Vending',pre:'TMD'}};
// Regra do Lucas (23/11): Touch Pulse = máquina de um valor só (jogada). Touch Vending = vários produtos/preços (ex.: capinha).
const linhaDe=t=>/caixa|surpresa|splendor|elegance|locker|vending|cards|pula pula|parfum|perfum|petizzo|capacete|snack|bebida|capinha|capa |cartinha/i.test(t||'')?'mdb':'pulso';
const VALIDAR_LINHA=t=>false;
const COMO_PULSO=`<tr><td><b>1</b></td><td>Máquina desligada: ache no chicote do moedeiro os fios 12 V, GND e SINAL.</td></tr>
   <tr><td><b>2</b></td><td>Ligue a placa em paralelo com o moedeiro (o moedeiro continua funcionando) e prenda a caixa na máquina.</td></tr>
   <tr><td><b>3</b></td><td>Ligue a máquina. A placa aparece como <b>Online</b> aqui quando falar com o servidor (pela maquininha ou pelo Wi-Fi no piloto).</td></tr>
   <tr><td><b>4</b></td><td>Aqui no app: <b>Ligar placa à máquina</b> → leia o QR da placa → escolha a máquina e o valor do pulso.</td></tr>
   <tr><td><b>5</b></td><td>Toque em <b>Crédito</b> → 1 pulso de teste. A máquina tem que mostrar 1 crédito.</td></tr>`;
const COMO_MDB=`<tr><td><b>1</b></td><td>Máquina desligada: na placa de controle (VMC), ache o chicote MDB (conector de 6 vias que liga moedeiro, noteiro e leitor de cartão).</td></tr>
   <tr><td><b>2</b></td><td>Ligue a placa MDB no meio do chicote: um conector vai para a máquina e o outro segue para os outros aparelhos. Nada é cortado.</td></tr>
   <tr><td><b>3</b></td><td>Ligue a máquina. A placa aparece como <b>Online</b> e começa a registrar cada venda com a seleção (ex.: mola 12) e o preço.</td></tr>
   <tr><td><b>4</b></td><td>Aqui no app: <b>Ligar placa à máquina</b> → leia o QR da placa → escolha a máquina.</td></tr>
   <tr><td><b>5</b></td><td>Faça 1 venda de teste na máquina e confira se ela aparece em <b>Vendas hoje</b>.</td></tr>`;
async function telaPlacas(){
  $('#app').innerHTML='<div class="card"><p class="sub">Carregando placas…</p></div>';
  const todas=await buscarPlacas();const L=TEL_LINHA;const ps=todas.filter(p=>(p.tipo||'pulso')===L);
  const on=ps.filter(p=>p.online).length;const off=ps.filter(p=>p.codigo&&!p.online).length;
  const nP=todas.filter(p=>(p.tipo||'pulso')==='pulso').length,nM=todas.filter(p=>p.tipo==='mdb').length;
  const abas=`<div class="card" style="padding:10px 14px"><div class="lin" style="gap:8px">
    <button class="btn ${L==='pulso'?'':'s'}" data-linha="pulso">Touch Pulse (${nP})</button>
    <button class="btn ${L==='mdb'?'':'s'}" data-linha="mdb">Touch Vending (${nM})</button></div>
    <p class="mini" style="margin-top:6px">${L==='pulso'?'Touch Pulse · máquinas de um valor só (garra, soco, basquete, fliperama, tesoura, air hockey, simulador): a placa lê os pulsos do moedeiro e solta o crédito pago no Pix ou no cartão.':'Touch Vending · máquinas com vários produtos ou preços (capinha, cartinhas, locker, caixa surpresa, MV Cards, Pula Pula, Trostdorf, Petizzo, limpa capacete): a placa escuta o MDB da vending machine e registra cada venda com a seleção e o preço.'}</p></div>`;
  const kpis=L==='pulso'?`<div class="kpi"><div class="l">Entradas hoje</div><div class="v">${brl(ps.reduce((s,p)=>s+num(p.moedas_hoje),0))}</div><div class="s">moedas e notas lidas pelas placas</div></div>
    <div class="kpi"><div class="l">Prêmios hoje</div><div class="v">${ps.reduce((s,p)=>s+num(p.premios_hoje),0)}</div><div class="s">pelúcias que saíram (sensor)</div></div>`
   :`<div class="kpi"><div class="l">Vendas hoje</div><div class="v">${brl(ps.reduce((s,p)=>s+num(p.vendas_hoje),0))}</div><div class="s">${ps.reduce((s,p)=>s+num(p.vendas_qtd_hoje),0)} produto(s) vendidos</div></div>`;
  $('#app').innerHTML=abas+`<div class="kpis"><div class="kpi g"><div class="l">Online</div><div class="v">${on}</div></div>
   <div class="kpi r"><div class="l">Offline</div><div class="v">${off}</div><div class="s">instaladas sem sinal</div></div>
   <div class="kpi"><div class="l">Sem máquina</div><div class="v">${ps.filter(p=>!p.codigo).length}</div><div class="s">ainda não instaladas</div></div>${kpis}</div>
   <div class="card"><h2>${LINHAS[L].nome}<button class="btn acao" id="parearP">Ligar placa à máquina</button></h2>
   <p class="sub" style="margin-bottom:10px">${L==='pulso'?'A placa fica em paralelo com o moedeiro: conta as moedas e solta na máquina o crédito pago no Pix ou no cartão. Instalou? Ligue a placa à máquina e faça o <b>crédito de teste</b>: só está pronta quando a máquina mostrar o crédito.':'A placa entra no chicote MDB da vending machine e registra cada venda (seleção e preço). Instalou? Ligue a placa à máquina e faça uma <b>venda de teste</b>.'}</p>
   ${ps.length?`<div class="wrap"><table><tr><th>Placa</th><th>Máquina</th><th>Situação</th><th class="r">${L==='pulso'?'Entradas hoje':'Vendas hoje'}</th><th></th></tr>${ps.map(p=>{const m=p.codigo&&maq(p.codigo);return `<tr>
    <td><b>${esc(p.id)}</b><small>${p.dono&&D.pode.acessos?esc(p.dono)+' · ':''}${L==='pulso'?'pulso '+brl(p.valor_pulso):'MDB'}${p.firmware?' · v'+esc(p.firmware):''}${p.rssi!=null?' · sinal '+p.rssi+' dBm':''}</small></td>
    <td>${p.codigo?`<a href="#m/${esc(p.codigo)}"><b>${esc(p.codigo)}</b></a><small>${m?esc(m.ponto):''}</small>`:'<span class="st y">sem máquina</span>'}</td>
    <td>${stPlaca(p)}${num(p.pendentes)?`<small>${p.pendentes} crédito(s) aguardando</small>`:''}</td>
    <td class="r">${L==='pulso'?brl(p.moedas_hoje)+(num(p.premios_hoje)?`<small>${num(p.premios_hoje)} prêmio(s)</small>`:''):brl(p.vendas_hoje)+`<small>${num(p.vendas_qtd_hoje)} venda(s)</small>`}</td>
    <td class="r">${L==='pulso'&&p.codigo&&p.situacao!=='suspensa'?`<button class="btn s" data-cred="${esc(p.codigo)}">Crédito</button>`:''}</td></tr>`}).join('')}</table></div>`
   :`<p class="sub">Nenhuma placa ${LINHAS[L].nome} cadastrada ainda. Elas aparecem aqui assim que forem gravadas e ligadas.</p>`}</div>
   <div class="card"><h2>Como instalar</h2><table>${L==='pulso'?COMO_PULSO:COMO_MDB}</table></div>${cardLinhaMaquinas(L,todas)}`;
  $('#app').querySelectorAll('[data-linha]').forEach(b=>b.onclick=()=>{TEL_LINHA=b.dataset.linha;telaPlacas()});
  $('#parearP').onclick=()=>formParear(L);
  if(!D.pode.acessos)return;
  const pre=L==='pulso'?'TMV':'TMD';
  $('#app').insertAdjacentHTML('beforeend',`<div class="card"><h2>Placa nova ${LINHAS[L].nome} (gravação)</h2><p class="sub">Gera o número (${pre}-0001…) e a chave de uma placa nova. Na bancada, com a placa no USB, cole a linha de gravação no Monitor Serial (115200). A chave aparece uma vez só: não mande por WhatsApp ou e-mail.</p><button class="btn s" id="novaP" style="margin-top:8px">Gerar placa ${LINHAS[L].nome}</button><div id="novaPR"></div></div>`);
  $('#novaP').onclick=async()=>{if(!confirm('Gerar uma placa '+LINHAS[L].nome+' nova?'))return;const d=await rpc('mvt_admin_nova_placa',{p_sessao:S(),p_tipo:L});
    if(d.erro){$('#novaPR').innerHTML=`<p class="msg">${esc(d.erro)}</p>`;return}
    $('#novaPR').innerHTML=`<table style="margin-top:10px"><tr><td>Número</td><td><b>${esc(d.id)}</b></td></tr><tr><td>Linha de gravação</td><td><code style="word-break:break-all">${esc(d.gravar||('CFG '+d.id+' '+d.segredo))}</code></td></tr></table><p class="mini">Imprima uma etiqueta com o QR do número <b>${esc(d.id)}</b> e cole na placa.</p>`}}
function cardLinhaMaquinas(L,placas){
  const ms=D.maquinas.filter(m=>linhaDe(m.tipo)===L).sort((a,b)=>a.codigo.localeCompare(b.codigo));
  const comPlaca=new Set(placas.filter(p=>p.codigo).map(p=>p.codigo));
  const grupos={};ms.forEach(m=>{(grupos[m.tipo]=grupos[m.tipo]||[]).push(m)});
  return `<div class="card"><h2>Máquinas da linha ${LINHAS[L].nome} (${ms.length})</h2>
   <p class="sub" style="margin-bottom:8px">${ms.filter(m=>comPlaca.has(m.codigo)).length} com placa instalada · ${ms.filter(m=>!comPlaca.has(m.codigo)).length} ainda sem placa. Marcadas com <span class="st y">confirmar</span>: conferir na máquina se é pulso ou MDB.</p>
   ${ms.length?`<div class="wrap"><table><tr><th>Tipo</th><th class="r">Qtd</th><th>Máquinas</th></tr>${Object.entries(grupos).map(([t,l])=>`<tr><td><b>${esc(t)}</b>${VALIDAR_LINHA(t)?' <span class="st y">confirmar</span>':''}</td><td class="r">${l.length}</td><td>${l.map(m=>`<a href="#m/${esc(m.codigo)}">${esc(m.codigo)}</a>${comPlaca.has(m.codigo)?' ●':''}`).join(' · ')}</td></tr>`).join('')}</table></div>`:'<p class="sub">Nenhuma máquina desta linha cadastrada.</p>'}</div>`}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-cred]');if(b)formCredito(b.dataset.cred)});
async function lerQR(video,cb){
  if(!('BarcodeDetector' in window))return false;
  let st;try{st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})}catch(_){return false}
  video.srcObject=st;video.style.display='block';await video.play();
  const det=new BarcodeDetector({formats:['qr_code']});let fim=false;
  const parar=()=>{fim=true;st.getTracks().forEach(t=>t.stop());video.style.display='none'};
  (async function loop(){if(fim)return;try{const r=await det.detect(video);if(r.length){parar();cb(r[0].rawValue);return}}catch(_){}setTimeout(loop,250)})();
  return parar}
function formParear(linha){linha=linha||'pulso';
  modal(`<h3>Ligar placa ${LINHAS[linha].nome} à máquina</h3><form class="form" id="fp">
   <div><label>Placa (leia o QR ou digite o número)</label><div class="lin"><input id="pId" required placeholder="${linha==='mdb'?'TMD-0001':'TMV-0001'}" style="text-transform:uppercase"><button type="button" class="btn s" id="pQR">Ler QR</button></div>
   <video id="pVid" playsinline muted style="display:none;width:100%;border-radius:12px;margin-top:8px"></video></div>
   <div class="lin"><div><label>Máquina</label><select id="pMaq">${D.maquinas.filter(m=>linhaDe(m.tipo)===linha||VALIDAR_LINHA(m.tipo)).map(m=>`<option value="${m.codigo}">${m.codigo} · ${esc(m.ponto)}</option>`).join('')}</select></div>
   <div ${linha==='mdb'?'style="display:none"':''}><label>Valor de 1 pulso (R$)</label><input id="pVal" type="number" step="0.01" min="0.10" max="100" value="1.00"></div></div>
   ${linha==='mdb'?'<p class="mini">Na MDB o preço de cada produto vem da própria máquina.</p>':'<p class="mini">Valor do pulso = quanto vale 1 moeda na máquina (ex.: 1 jogada de R$ 5 com 5 pulsos → pulso de R$ 1,00).</p>'}
   <div class="msg" id="pMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Ligar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);let parar=null;
   g('#pQR').onclick=async()=>{parar=await lerQR(g('#pVid'),v=>{g('#pId').value=String(v).trim().toUpperCase().replace(/^.*[\/=]/,'')});
     if(!parar)g('#pMsg').textContent='Este celular não lê QR aqui. Digite o número que está na etiqueta da placa.'};
   w.addEventListener('click',e=>{if((e.target===w||e.target.closest('[data-fechar]'))&&parar)parar()});
   g('#fp').onsubmit=async e=>{e.preventDefault();if(parar)parar();g('#pMsg').textContent='Ligando…';
    const d=await rpc('mvt_admin_parear',{p_sessao:S(),p_placa:g('#pId').value,p_codigo:g('#pMaq').value,p_valor_pulso:parseFloat(g('#pVal').value)});
    if(d.erro){g('#pMsg').textContent=d.erro;return}w.remove();formCredito(g('#pMaq').value,true)}})}
function formCredito(cod,teste){
  modal(`<h3>${teste?'Placa ligada! Agora o teste':'Crédito na '+esc(cod)}</h3><form class="form" id="fc">
   <p class="sub">${teste?'Mande 1 pulso de teste e confira se a máquina mostra 1 crédito.':'O crédito cai na máquina em até 30 segundos (se a placa estiver online).'}</p>
   <div class="lin"><div><label>Pulsos</label><input id="cQtd" type="number" min="1" max="20" value="1"></div>
   <div><label>Tipo</label><select id="cTipo"><option value="teste">Teste</option><option value="remoto" ${teste?'':'selected'}>Remoto (cortesia/cliente)</option></select></div></div>
   <div class="msg" id="cMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Fechar</button><button class="btn">Enviar crédito</button></div></form>`,w=>{
   const g=id=>w.querySelector(id);
   g('#fc').onsubmit=async e=>{e.preventDefault();g('#cMsg').textContent='Enviando…';
    const d=await rpc('mvt_admin_credito',{p_sessao:S(),p_codigo:cod,p_pulsos:parseInt(g('#cQtd').value,10),p_origem:g('#cTipo').value});
    if(d.erro){g('#cMsg').textContent=d.erro;return}
    g('#cMsg').textContent='Crédito enviado. Confira na máquina.';if(location.hash==='#placas')setTimeout(telaPlacas,1500)}})}

// ---------- início ----------
limpaLink();carregar();

// ---- app instalável (PWA) ----
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
(function(){const box=$('#inst'),btn=$('#instBtn'),txt=$('#instTxt');
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(standalone||ls.get('mvt_inst_x')==='1')return;
  let ev=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();ev=e;box.classList.add('on')});
  btn.onclick=async()=>{if(ev){ev.prompt();await ev.userChoice;ev=null;box.classList.remove('on')}};
  $('#instX').onclick=()=>{box.classList.remove('on');ls.set('mvt_inst_x','1')};
  if(/iphone|ipad|ipod/i.test(navigator.userAgent)){txt.innerHTML='<b>Instale o app MV Toy</b><br>No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.';btn.style.display='none';box.classList.add('on')}
  window.addEventListener('appinstalled',()=>box.classList.remove('on'));
})();
