// cobranca-c6 — cobra royalties/taxa/fundo pelo C6 Bank com Pix com vencimento (padrão Banco Central "cobv").
// Base pronta para várias contas/bancos (tabela mvt_contas_receb, uma por CNPJ/marca); conector ligado hoje: C6.
// Pix no C6 PJ é grátis. Credenciais SÓ nos segredos do servidor, por conta (prefixo, ex.: C6_MVF):
//   C6_MVF_CLIENT_ID · C6_MVF_CLIENT_SECRET · C6_MVF_CERT (certificado PEM do C6) · C6_MVF_KEY (chave PEM)
// Chamadas:
//   POST {sessao}                         → registra no banco as cobranças novas e confere as pendentes
//   POST ?acao=teste {sessao}             → testa login de cada conta
//   POST ?acao=cancelar&id=<id> {sessao}  → cancela a cobrança no banco
//   POST ?acao=webhook {sessao}           → cadastra no C6 o aviso automático de pagamento
//   POST ?webhook=c6                      → aviso do C6: só serve de "gatilho"; o pagamento é sempre CONFERIDO na API do banco
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const BASE = { sandbox: "https://baas-api-sandbox.c6bank.info", producao: "https://baas-api.c6bank.info" } as const;
const so = (s: unknown) => String(s ?? "").replace(/\D/g, "");

type Conta = { id: string; nome: string; banco?: string; ambiente: "sandbox" | "producao"; chave_pix: string | null; segredo_prefixo: string };
const pem = (v: string) => (v.includes("BEGIN") ? v : atob(v.replace(/\s/g, "")));

// ---------- acesso ao C6 (token em memória) ----------
const cache = new Map<string, { client: any; token?: string; expira?: number }>();
function cli(c: Conta) {
  if ((c.banco ?? "c6") !== "c6") throw new Error(`Banco "${c.banco}" ainda não está ligado no app (por enquanto só C6). A base já aceita a conta; falta o conector desse banco.`);
  if (cache.has(c.id)) return cache.get(c.id)!;
  const p = c.segredo_prefixo, cert = Deno.env.get(`${p}_CERT`), key = Deno.env.get(`${p}_KEY`);
  if (!Deno.env.get(`${p}_CLIENT_ID`) || !Deno.env.get(`${p}_CLIENT_SECRET`) || !cert || !key)
    throw new Error(`Faltam as credenciais do C6 nos segredos do servidor (${p}_CLIENT_ID, ${p}_CLIENT_SECRET, ${p}_CERT, ${p}_KEY).`);
  const v = { client: (Deno as any).createHttpClient({ cert: pem(cert), key: pem(key), http2: false }) };
  cache.set(c.id, v); return v;
}
async function token(c: Conta) {
  const k = cli(c);
  if (k.token && (k.expira ?? 0) > Date.now() + 30e3) return k.token;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: Deno.env.get(`${c.segredo_prefixo}_CLIENT_ID`)!, client_secret: Deno.env.get(`${c.segredo_prefixo}_CLIENT_SECRET`)! });
  const r = await fetch(`${BASE[c.ambiente]}/v1/auth/`, { method: "POST", client: k.client, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body } as any);
  const t: any = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error(`C6 recusou o login (${r.status}) ${t?.error_description ?? t?.message ?? ""}`.trim());
  k.token = t.access_token; k.expira = Date.now() + Number(t.expires_in ?? 300) * 1000; return k.token!;
}
async function api(c: Conta, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(`${BASE[c.ambiente]}${caminho}`, { method: metodo, client: cli(c).client,
    headers: { "Authorization": `Bearer ${await token(c)}`, "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined } as any);
  const t: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const det = t?.violacoes?.map((v: any) => `${v.propriedade ?? ""} ${v.razao ?? ""}`.trim()).join("; ") || t?.detail || t?.title || t?.message || "";
    throw new Error(`C6 ${r.status} ${det}`.trim());
  }
  return t;
}

// ---------- registrar e conferir ----------
async function registrar(cb: any) {
  const c: Conta = cb.conta, p = cb.pagador ?? {}, end = p.endereco ?? {}, doc = so(p.documento);
  if (!c.chave_pix) throw new Error("Conta sem chave Pix cadastrada (use a chave aleatória da conta C6).");
  if (doc.length !== 11 && doc.length !== 14) throw new Error("Pagador sem CPF/CNPJ no cadastro fiscal.");
  const devedor: any = { nome: String(p.razao_social || p.nome).slice(0, 140), [doc.length === 14 ? "cnpj" : "cpf"]: doc };
  if (end.logradouro && end.cidade && end.uf && so(end.cep).length === 8)
    Object.assign(devedor, { logradouro: `${end.logradouro} ${end.numero ?? ""}`.trim().slice(0, 200), cidade: end.cidade, uf: String(end.uf).toUpperCase(), cep: so(end.cep) });
  const r = await api(c, "PUT", `/v2/pix/cobv/${cb.txid}`, {
    calendario: { dataDeVencimento: cb.vencimento, validadeAposVencimento: 30 },
    devedor, valor: { original: Number(cb.valor).toFixed(2) }, chave: c.chave_pix,
    solicitacaoPagador: String(cb.descricao ?? "Cobrança MV").slice(0, 140),
  });
  await sb.rpc("mvt_cobranca_registrar", { p_id: cb.id, p_dados: { status: "ativa", pix_copia_cola: r.pixCopiaECola ?? r.brcode ?? null, erro_msg: null } });
}
async function conferir(cb: any) {
  const r = await api(cb.conta, "GET", `/v2/pix/cobv/${cb.txid}`);
  if (r.status === "CONCLUIDA") {
    const px = (r.pix ?? [])[0] ?? {};
    await sb.rpc("mvt_cobranca_registrar", { p_id: cb.id, p_dados: { status: "paga", valor_pago: px.valor ?? r.valor?.original ?? cb.valor, pago_em: px.horario ?? new Date().toISOString(), e2eid: px.endToEndId ?? null, erro_msg: null } });
    return "paga";
  }
  if (String(r.status).startsWith("REMOVIDA")) { await sb.rpc("mvt_cobranca_registrar", { p_id: cb.id, p_dados: { status: "cancelada" } }); return "cancelada"; }
  return "ativa";
}
const SEL = "*, conta:conta_id(*), pagador:pagador_id(*)";
async function processar(filtroTxids?: string[]) {
  const out = { registradas: 0, pagas: 0, erros: [] as string[] };
  if (!filtroTxids) {
    const { data: novas } = await sb.from("mvt_cobrancas").select(SEL).in("status", ["criada", "erro"]).limit(30);
    for (const cb of novas ?? []) {
      try { await registrar(cb); out.registradas++; }
      catch (e) { const m = String((e as Error).message); out.erros.push(m); await sb.rpc("mvt_cobranca_registrar", { p_id: cb.id, p_dados: { status: "erro", erro_msg: m.slice(0, 400) } }); }
    }
  }
  let q = sb.from("mvt_cobrancas").select(SEL).eq("status", "ativa");
  if (filtroTxids) q = q.in("txid", filtroTxids);
  const { data: abertas } = await q.limit(100);
  for (const cb of abertas ?? []) {
    try { if ((await conferir(cb)) === "paga") out.pagas++; } catch (e) { out.erros.push(String((e as Error).message)); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("webhook") === "c6") {
    // aviso do banco: extrai os txid e CONFERE cada um na API (nunca confia no conteúdo do aviso)
    const txt = await req.text().catch(() => "");
    const txids = [...new Set((txt.match(/[A-Za-z0-9]{26,35}/g) ?? []))].slice(0, 50);
    if (txids.length) await processar(txids).catch(() => {});
    return json({ ok: true });
  }
  const { sessao } = await req.json().catch(() => ({}));
  const { data: admin } = await sb.rpc("mvt_admin_de", { p_sessao: sessao });
  if (!admin) return json({ erro: "Só o franqueador." }, 403);
  const acao = url.searchParams.get("acao");
  try {
    if (acao === "teste") {
      const { data: contas } = await sb.from("mvt_contas_receb").select("*").eq("ativo", true);
      const r: unknown[] = [];
      for (const c of contas ?? []) { try { await token(c); r.push({ conta: c.nome, ambiente: c.ambiente, login: "ok", chave_pix: c.chave_pix ? "ok" : "falta" }); } catch (e) { r.push({ conta: c.nome, ambiente: c.ambiente, erro: String((e as Error).message) }); } }
      return json({ ok: true, contas: r });
    }
    if (acao === "cancelar") {
      const { data: cb } = await sb.from("mvt_cobrancas").select(SEL).eq("id", url.searchParams.get("id")).maybeSingle();
      if (!cb) return json({ erro: "Cobrança não encontrada." }, 404);
      if (cb.status === "ativa") await api(cb.conta, "PATCH", `/v2/pix/cobv/${cb.txid}`, { status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
      if (cb.status === "paga") return json({ erro: "Cobrança já paga: não dá para cancelar." }, 400);
      await sb.rpc("mvt_cobranca_registrar", { p_id: cb.id, p_dados: { status: "cancelada" } });
      return json({ ok: true });
    }
    if (acao === "webhook") {
      const { data: contas } = await sb.from("mvt_contas_receb").select("*").eq("ativo", true).not("chave_pix", "is", null);
      const alvo = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cobranca-c6?webhook=c6`;
      for (const c of contas ?? []) await api(c, "PUT", `/v2/pix/webhook/${encodeURIComponent(c.chave_pix!)}`, { webhookUrl: alvo });
      return json({ ok: true, contas: (contas ?? []).length });
    }
    return json({ ok: true, ...(await processar()) });
  } catch (e) { return json({ erro: String((e as Error).message) }, 400); }
});
