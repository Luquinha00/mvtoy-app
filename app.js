// MV Toy · app de gestão das máquinas (franqueador, sócio, franqueado, investidor, reabastecedor)
const URL_SB='https://koxormltidkmdwxgqbsm.supabase.co', KEY='sb_publishable_J7Ps1yZ4BPvFMof7coAAuQ_xO4I5QIe';
const SESS='mvt_sess';
const MESES_N=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PAPEIS={admin:'Franqueador',socio:'Sócio',franqueado:'Franqueado',investidor:'Investidor',reabastecedor:'Reabastecedor'};
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
const fat=(m,mes)=>{const l=leit(m,mes);return l?num(l.faturamento):null};
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
  t.push(['visitas','Visitas']);if(D.pode.acessos)t.push(['acessos','Acessos']);
  const tabs=$('#tabs');tabs.style.display='';tabs.innerHTML=t.map(([k,n])=>`<a href="#${k}" data-k="${k}">${n}</a>`).join('')}
function rota(){if(!D)return;const h=decodeURIComponent(location.hash.slice(1))||'inicio';
  const k=h.startsWith('m/')?'maquinas':h;document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.k===k));
  window.scrollTo(0,0);
  if(h.startsWith('m/'))return telaMaquina(h.slice(2));
  ({inicio:telaInicio,maquinas:telaMaquinas,financeiro:telaFinanceiro,visitas:telaVisitas,acessos:telaAcessos}[h]||telaInicio)()}
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
   <div class="kpi"><div class="l">Faturamento ${nomeMes(MES)}</div><div class="v">${brl(c.fat)}</div><div class="s">${MES===mesAtual()?'parcial do mês':varp===null?'—':(varp>=0?'▲ ':'▼ ')+Math.abs(varp).toFixed(0)+'% vs mês anterior'}</div></div>
   <div class="kpi"><div class="l">Máquinas</div><div class="v">${D.maquinas.length}</div><div class="s">${ativas} ativas</div></div>
   <div class="kpi r"><div class="l">Custos lançados</div><div class="v">${c.saidas?brl(c.saidas):'—'}</div><div class="s">${c.saidas||c.entradas?'resultado parcial '+brl(c.resultado):'nenhum custo lançado no mês'}</div></div>`;
  const res=D.resultados.filter(r=>String(r.mes).slice(0,10)===MES);
  if(D.eu.papel==='investidor')res.forEach(r=>{h+=`<div class="kpi g"><div class="l">Sua parte · ${nomeMes(MES)}</div><div class="v">${brl(r.parte_investidor)}</div><div class="s">rendimento ${String(r.rendimento_pct).replace('.',',')}% no mês</div></div>`});
  h+=`</div>`;
  // alertas
  const al=[];const mf=ultimoMesFechado();
  D.maquinas.forEach(m=>{if(m.status&&m.status!=='Ativa'&&m.status!=='Em estoque')al.push(['r','!',`<a class="mvt" href="#m/${m.codigo}">${m.codigo}</a> está <b>${esc(m.status)}</b> · ${esc(m.ponto)}`]);
    else if(m.status==='Ativa'){const f=fat(m,mf),md=media3(m,mf);if(f!==null&&md&&f<md*0.7)al.push(['y','▼',`<a class="mvt" href="#m/${m.codigo}">${m.codigo}</a> caiu ${Math.round((1-f/md)*100)}% em ${nomeMes(mf)} (${brl0(f)} vs média ${brl0(md)})`]);}});
  if(D.pode.visitar||D.eu.papel==='admin'){const sem=D.maquinas.filter(m=>m.status==='Ativa'&&(!m.ultima_visita||diasDesde(m.ultima_visita)>7));
    if(sem.length)al.push(['b','i',`${sem.length} máquina(s) ativas sem visita registrada nos últimos 7 dias. <a href="#visitas">Ver rota</a>`])}
  const prev=D.lancamentos.filter(l=>l.status==='previsto'&&l.tipo==='saida');
  if(prev.length)al.push(['y','$',`${prev.length} conta(s) previstas a pagar, total ${brl(prev.reduce((s,l)=>s+num(l.valor),0))}. <a href="#financeiro">Abrir financeiro</a>`]);
  h+=`<div class="grid2"><div class="card"><h2>Alertas</h2>${al.length?al.map(([c,i,t])=>`<div class="alerta"><i class="${c}">${i}</i><div>${t}</div></div>`).join(''):'<p class="sub">Tudo em ordem por aqui.</p>'}</div>`;
  const lin=D.maquinas.map(m=>({m,f:fat(m,MES)})).filter(x=>x.f!==null).sort((a,b)=>b.f-a.f);
  const mx=Math.max(1,...lin.map(x=>x.f));
  const linha=x=>`<tr class="clic" data-cod="${x.m.codigo}"><td><span class="mvt">${x.m.codigo}</span><small>${esc(x.m.tipo)} · ${esc(x.m.ponto)}</small></td><td class="r">${brl(x.f)}<div class="bar"><i style="width:${Math.round(x.f/mx*100)}%"></i></div></td></tr>`;
  h+=`<div class="card"><h2>Mais fortes · ${nomeMes(MES)} ${parcial()}</h2><table>${lin.slice(0,5).map(linha).join('')||'<tr><td class="sub">Sem dados no mês.</td></tr>'}</table>
   ${lin.length>5?`<h2 style="margin-top:14px">Mais fracas</h2><table>${lin.slice(-3).reverse().map(linha).join('')}</table>`:''}</div></div>`;
  h+=`<p class="nota y"><b>Sobre os dados:</b> faturamento bruto da telemetria PagPlush (dinheiro + Pix + débito + crédito) por mês. Custos e repasses aparecem quando lançados no Financeiro.</p>`;
  $('#app').innerHTML=h}

// ---------- rota do reabastecedor ----------
function telaRota(){
  const ord=[...D.maquinas].sort((a,b)=>(a.ultima_visita||'0').localeCompare(b.ultima_visita||'0'));
  $('#app').innerHTML=`<div class="card"><h2>Minha rota <span class="sub">${ord.length} máquina(s)</span></h2>
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
     return `<tr class="clic" data-cod="${m.codigo}"><td><a class="mvt" href="#m/${m.codigo}">${m.codigo}</a><small>${esc(m.tipo)}${m.premio&&m.premio!=='sem prêmio'?' · '+esc(m.premio):''} · ${esc(m.jogada)}</small><small class="so-mob">${esc(m.ponto)}</small></td>
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
function telaMaquina(cod){const m=maq(cod);if(!m){vazio('Máquina não encontrada no seu acesso. <a href="#maquinas">Voltar</a>');return}
  const din=D.pode.dinheiro;
  let h=`<a class="voltar" href="#${din?'maquinas':'inicio'}">‹ Voltar</a><div class="card"><div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
   <div><h1 class="tit">${esc(m.codigo)} · ${esc(m.tipo)}</h1><p class="sub">${esc(m.ponto)} · ${esc(m.cidade)}</p>
   <div class="tags">${stTag(m)}<span>Jogada ${esc(m.jogada||'—')}</span><span>Prêmio: ${esc(m.premio||'—')}</span>${din&&m.dono?`<span>${esc(m.dono)}</span>`:''}
   <span>Última visita: ${m.ultima_visita?dataBR(m.ultima_visita):'nenhuma'}</span></div></div>
   <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${D.pode.visitar?`<button class="btn" data-visita="${m.codigo}">Registrar visita</button>`:''}
   ${D.pode.lancar?`<button class="btn s" id="lancM">Lançar valor</button>`:''}${D.pode.editar?`<button class="btn s" id="editM">Editar</button>`:''}</div></div></div>`;
  if(din){const c=contas(MES,m.codigo),l=leit(m,MES),md=media3(m,MES);
    h+=seletorMes()+`<div class="kpis"><div class="kpi"><div class="l">Faturamento ${nomeMes(MES)}</div><div class="v">${c.fat||l?brl(c.fat):'—'}</div><div class="s">${MES===mesAtual()?'parcial':md?'média 3 meses: '+brl0(md):'—'}</div></div>
     <div class="kpi"><div class="l">Prêmios saídos</div><div class="v">${l&&l.premios!=null?l.premios:'—'}</div><div class="s">${l&&l.premios?'faturamento por prêmio: '+brl(c.fat/l.premios):'telemetria'}</div></div>
     <div class="kpi"><div class="l">Saídas lançadas</div><div class="v">${brl(c.saidas)}</div><div class="s">${c.saidasPrev?brl(c.saidasPrev)+' previstas':'no mês'}</div></div>
     <div class="kpi ${c.saidas||c.entradas?(c.resultado>=0?'g':'r'):''}"><div class="l">Resultado</div><div class="v">${c.saidas||c.entradas?brl(c.resultado):'—'}</div><div class="s">${c.saidas||c.entradas?'faturamento + entradas − saídas':'lance os custos para ver'}</div></div></div>`;
    h+=`<div class="card"><h2>Faturamento por mês <span class="sub">toque na barra para ver o mês</span></h2>${grafico(m)}</div>`;
    if(l){const tot=PAGTO.reduce((s,[k])=>s+num(l[k]),0)||1;
      h+=`<div class="card"><h2>Como pagaram · ${nomeMes(MES)}</h2><div class="pag">${PAGTO.map(([k,n,c])=>num(l[k])?`<i style="width:${num(l[k])/tot*100}%;background:${c}" title="${n}"></i>`:'').join('')}</div>
      <div class="leg">${PAGTO.filter(([k])=>num(l[k])).map(([k,n,c])=>`<span style="--c:${c}">${n} ${brl(l[k])} (${Math.round(num(l[k])/tot*100)}%)</span>`).join('')}</div>
      <p class="mini" style="margin-top:6px">Fonte: ${esc(l.fonte||'telemetria')}</p></div>`}
    const lm=lancMes(MES,m.codigo);
    h+=`<div class="card"><h2>Lançamentos · ${nomeMes(MES)}</h2>${tabelaLanc(lm,false)}</div>`}
  const vs=D.visitas.filter(v=>v.codigo===m.codigo).slice(0,15);
  h+=`<div class="card"><h2>Visitas</h2>${tabelaVisitas(vs,false)}</div>`;
  if(D.pode.acessos&&m.pessoas)h+=`<div class="card"><h2>Quem acompanha esta máquina</h2>${m.pessoas.length?`<div class="tags">${m.pessoas.map(p=>`<span>${esc(p.nome)} · ${PAPEIS[p.papel]||p.papel}</span>`).join('')}</div>`:'<p class="sub">Só o franqueador e os sócios. Ligue pessoas em Acessos.</p>'}</div>`;
  $('#app').innerHTML=h;
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
function telaFinanceiro(){const c=contas(MES);const lm=lancMes(MES);
  const cats={};lm.filter(l=>l.tipo==='saida').forEach(l=>cats[l.categoria]=(cats[l.categoria]||0)+num(l.valor));
  const porMaq=D.maquinas.map(m=>({m,c:contas(MES,m.codigo)})).filter(x=>x.c.fat||x.c.saidas||x.c.entradas).sort((a,b)=>b.c.resultado-a.c.resultado);
  let h=seletorMes()+`<div class="kpis"><div class="kpi"><div class="l">Faturamento máquinas</div><div class="v">${brl(c.fat)}</div><div class="s">telemetria ${nomeMes(MES)}</div></div>
   <div class="kpi"><div class="l">Outras entradas</div><div class="v">${brl(c.entradas)}</div><div class="s">lançadas</div></div>
   <div class="kpi r"><div class="l">Saídas</div><div class="v">${brl(c.saidas)}</div><div class="s">${brl(c.saidasPagas)} pagas · ${brl(c.saidasPrev)} a pagar</div></div>
   <div class="kpi ${c.resultado>=0?'g':'r'}"><div class="l">Resultado</div><div class="v">${brl(c.resultado)}</div><div class="s">${c.fat&&c.saidas<c.fat*0.2?'parcial: faltam custos do mês (prêmios, ponto, taxas)':c.fat?Math.round(c.resultado/c.fat*100)+'% do faturamento':''}</div></div></div>`;
  const res=D.resultados.filter(r=>String(r.mes).slice(0,10)===MES);
  if(res.length)h+=`<div class="card"><h2>Fechamento das sociedades · ${nomeMes(MES)}</h2><div class="wrap"><table><tr><th>Sociedade</th><th class="r">Faturamento</th><th class="r">Resultado</th><th class="r">Parte do investidor</th><th class="r cj">Rendimento</th></tr>`+
    res.map(r=>`<tr><td>${esc(r.sociedade)}<small>${esc(r.documento||'')}</small></td><td class="r">${brl(r.faturamento)}</td><td class="r">${brl(r.resultado)}</td><td class="r"><b style="color:var(--vd)">${brl(r.parte_investidor)}</b></td><td class="r cj">${String(r.rendimento_pct).replace('.',',')}%</td></tr>`).join('')+`</table></div><p class="mini" style="margin-top:6px">O fechamento completo, com os comprovantes, é enviado todo dia 10.</p></div>`;
  h+=`<div class="grid2"><div class="card"><h2>Saídas por categoria</h2>${Object.keys(cats).length?`<table>${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}<div class="bar"><i style="width:${Math.round(v/c.saidas*100)}%;background:var(--verm)"></i></div></td><td class="r">${brl(v)}</td></tr>`).join('')}</table>`:'<p class="sub">Nenhuma saída lançada no mês.</p>'}</div>
   <div class="card"><h2>Resultado por máquina</h2><div class="wrap"><table><tr><th>Máquina</th><th class="r">Fatur.</th><th class="r">Saídas</th><th class="r">Resultado</th></tr>${porMaq.map(({m,c})=>`<tr class="clic" data-cod="${m.codigo}"><td><span class="mvt">${m.codigo}</span><small>${esc(m.ponto)}</small></td><td class="r">${brl0(c.fat)}</td><td class="r">${c.saidas?brl0(c.saidas):'—'}</td><td class="r" style="color:${c.resultado>=0?'var(--vd)':'var(--rt)'}">${brl0(c.resultado)}</td></tr>`).join('')}</table></div></div></div>`;
  h+=`<div class="card"><h2>Lançamentos · ${nomeMes(MES)}${D.pode.lancar?'<button class="btn acao" id="novoL">+ Novo lançamento</button>':''}</h2>${tabelaLanc(lm,true)}</div>`;
  const prev=D.lancamentos.filter(l=>l.status==='previsto').sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  if(prev.length)h+=`<div class="card"><h2>Contas a pagar (todos os meses)</h2>${tabelaLanc(prev,true)}</div>`;
  h+=`<p class="nota">Faturamento vem da telemetria; custos, repasses e outras entradas são lançados aqui${D.pode.lancar?' (botão “Novo lançamento” ou dentro da máquina)':''}. Os meses fechados antes de nov/26 estão nos PDFs de fechamento.</p>`;
  $('#app').innerHTML=h;if($('#novoL'))$('#novoL').onclick=()=>formLanc(null)}

// ---------- visitas ----------
function tabelaVisitas(vs,comMaq){if(!vs.length)return '<p class="sub">Nenhuma visita registrada.</p>';
  return `<div class="wrap"><table><tr><th>Data</th>${comMaq?'<th>Máquina</th>':''}<th class="r">Repostos</th><th class="r cj">No visor</th>${D.pode.dinheiro?'<th class="r cj">Recolhido</th>':''}<th>Obs.</th><th></th></tr>`+
  vs.map(v=>`<tr><td>${dataBR(v.data)}<small>${esc(v.quem||'')}</small></td>${comMaq?`<td><a class="mvt" href="#m/${v.codigo}">${v.codigo}</a><small>${esc((maq(v.codigo)||{}).ponto||'')}</small></td>`:''}
  <td class="r">${v.repostos??'—'}</td><td class="r cj">${v.visor??'—'}</td>${D.pode.dinheiro?`<td class="r cj">${v.recolhido!=null?brl(v.recolhido):'—'}</td>`:''}
  <td>${v.limpeza?'<span class="st">limpeza</span> ':''}${v.problema?`<span class="st off">problema</span><small>${esc(v.problema)}</small>`:''}</td>
  <td class="r">${(D.pode.editar||v.meu)?`<button class="lnk" data-dvis="${v.id}">apagar</button>`:''}</td></tr>`).join('')+`</table></div>`}
document.addEventListener('click',async e=>{const b=e.target.closest('button[data-dvis]');if(!b)return;if(!confirm('Apagar esta visita?'))return;
  const d=await rpc('mvt_apagar_visita',{p_sessao:S(),p_id:b.dataset.dvis});if(d.erro){alert(d.erro);return}carregar(true)});
function telaVisitas(){
  let h='';
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
   <div class="lin"><div><label>Data</label><input id="vData" type="date" value="${hojeISO()}" max="${hojeISO()}" required></div>
   <div><label>Prêmios repostos</label><input id="vRep" type="number" min="0" inputmode="numeric"></div></div>
   <div class="lin"><div><label>Prêmios no visor (antes)</label><input id="vVis" type="number" min="0" inputmode="numeric"></div>
   <div><label>Dinheiro recolhido (R$)</label><input id="vRec" type="number" min="0" step="0.01" inputmode="decimal"></div></div>
   <label class="chk"><input type="checkbox" id="vLim"> Fiz a limpeza da máquina</label>
   <div><label>Problema encontrado (se houver)</label><textarea id="vPro" rows="2" placeholder="Ex.: garra fraca, noteiro travado, luz apagada"></textarea></div>
   <label class="chk"><input type="checkbox" id="vPar"> A máquina ficou parada / precisa de manutenção</label>
   <div class="msg" id="vMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar visita</button></div></form>`,w=>{
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
   <div class="msg" id="mMsg"></div><div class="bts"><button type="button" class="btn s" data-fechar>Cancelar</button><button class="btn">Salvar</button></div></form>`,w=>{
   const g=id=>w.querySelector(id).value;
   w.querySelector('#fm').onsubmit=async e=>{e.preventDefault();w.querySelector('#mMsg').textContent='Salvando…';
    const d=await rpc('mvt_admin_maquina',{p_sessao:S(),p_novo:novo,p_codigo:g('#mCod'),p_tipo:g('#mTipo'),p_ponto:g('#mPon'),p_cidade:g('#mCid'),
      p_jogada:g('#mJog'),p_premio:g('#mPre'),p_dono:g('#mDon'),p_status:g('#mSt')});
    if(d.erro){w.querySelector('#mMsg').textContent=d.erro;return}w.remove();await carregar(true);if(novo)location.hash='m/'+g('#mCod').trim().toUpperCase()}})}

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
