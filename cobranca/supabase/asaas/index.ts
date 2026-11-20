// asaas — cobranças do Grupo MV (MV Toy, MV Play, Mini Loja MV, Mundo Virtual Franchising) num CNPJ único.
// Rotas (POST):
//   ?acao=registrar  {sessao, cobranca_id}   → cria cliente e cobrança no Asaas, guarda link do boleto e Pix
//   ?acao=webhook    (chamado pelo Asaas)     → marca paga / vencida / cancelada
//   ?acao=webhook-config {sessao}            → cadastra o webhook na conta Asaas (uma vez)
// Segredos (Supabase › Edge Functions › Secrets): ASAAS_API_KEY, ASAAS_AMBIENTE (producao|sandbox),
// ASAAS_WEBHOOK_TOKEN, ASAAS_WEBHOOK_EMAIL (e-mail que recebe avisos de falha do webhook).
// Nada de chave em código ou documento.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("ASAAS_API_KEY") || "";
const BASE = (Deno.env.get("ASAAS_AMBIENTE") || "producao") === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
const WH_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
const WH_EMAIL = Deno.env.get("ASAAS_WEBHOOK_EMAIL") || undefined;
const NOMES: Record<string, string> = { MVT: "MV Toy", MVP: "MV Play", MLM: "Mini Loja MV", MVF: "Mundo Virtual Franchising" };
const TIPOS: Record<string, string> = { ROY: "Royalty", TAXA: "Taxa de franquia", FMK: "Fundo de marketing", PED: "Pedido de compra", REP: "Repasse", TEL: "Telemetria", OPR: "Operação", OUT: "Outros" };

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, apikey" };
const resp = (s: number, o: unknown) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...cors } });

async function asaas(path: string, init: RequestInit = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { access_token: KEY, "content-type": "application/json", "user-agent": "grupo-mv-app", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j?.errors?.[0]?.description as string) || `Asaas ${r.status}`);
  return j;
}
async function admin(sessao: string) {
  const { data } = await db.rpc("mvt_admin_de", { p_sessao: sessao });
  return data as string | null;
}

async function registrar(sessao: string, id: string) {
  if (!(await admin(sessao))) return resp(403, { erro: "Só o franqueador." });
  if (!KEY) return resp(503, { erro: "Asaas ainda não conectado (falta a chave da API)." });
  const { data: b } = await db.from("mv_cobrancas").select("*, cliente:mv_clientes_cobranca(*)").eq("id", id).maybeSingle();
  if (!b) return resp(404, { erro: "Cobrança não encontrada." });
  if (b.asaas_id) return resp(200, { ok: true, ja: true });
  try {
    let cus = b.cliente.asaas_id;
    if (!cus) {
      const c = await asaas("/customers", { method: "POST", body: JSON.stringify({
        name: b.cliente.nome, cpfCnpj: b.cliente.cpf_cnpj, email: b.cliente.email || undefined,
        mobilePhone: b.cliente.telefone || undefined, externalReference: `${b.cliente.marca}|CLI|${b.cliente.id}`,
        groupName: NOMES[b.cliente.marca], notificationDisabled: false }) });
      cus = c.id;
      await db.from("mv_clientes_cobranca").update({ asaas_id: cus }).eq("id", b.cliente.id);
    }
    const p = await asaas("/payments", { method: "POST", body: JSON.stringify({
      customer: cus,
      billingType: b.forma === "PIX" ? "PIX" : b.forma === "BOLETO" ? "BOLETO" : "UNDEFINED",
      value: Number(b.valor), dueDate: b.vencimento,
      description: `${NOMES[b.marca]} · ${TIPOS[b.tipo]} · ${b.descricao}`.slice(0, 500),
      externalReference: `${b.marca}|${b.natureza}|${b.tipo}|${b.id}` }) });
    let pix: string | null = null;
    if (b.forma !== "BOLETO") {
      try { pix = (await asaas(`/payments/${p.id}/pixQrCode`)).payload || null; } catch { /* Pix pode não estar habilitado */ }
    }
    await db.from("mv_cobrancas").update({ asaas_id: p.id, status: "aberta", link_fatura: p.invoiceUrl, link_boleto: p.bankSlipUrl || null,
      pix_copia_cola: pix, erro: null, atualizado_em: new Date().toISOString() }).eq("id", b.id);
    return resp(200, { ok: true, link: p.invoiceUrl, pix });
  } catch (e) {
    await db.from("mv_cobrancas").update({ status: "erro", erro: String((e as Error).message).slice(0, 300) }).eq("id", b.id);
    return resp(502, { erro: (e as Error).message });
  }
}

async function webhook(req: Request) {
  if (!WH_TOKEN || req.headers.get("asaas-access-token") !== WH_TOKEN) return resp(401, { erro: "token" });
  const ev = await req.json().catch(() => null);
  const p = ev?.payment;
  if (!p?.id) return resp(200, { ok: true });
  const mapa: Record<string, string> = { PAYMENT_RECEIVED: "paga", PAYMENT_CONFIRMED: "paga", PAYMENT_OVERDUE: "vencida",
    PAYMENT_DELETED: "cancelada", PAYMENT_REFUNDED: "cancelada" };
  const st = mapa[ev.event];
  if (st) {
    const upd: Record<string, unknown> = { status: st, atualizado_em: new Date().toISOString() };
    if (st === "paga") { upd.pago_em = p.paymentDate || p.clientPaymentDate || new Date().toISOString(); upd.valor_liquido = p.netValue ?? null; }
    let q = db.from("mv_cobrancas").update(upd).eq("asaas_id", p.id);
    if (st !== "paga") q = q.neq("status", "paga");   // eventos fora de ordem não desfazem um pagamento
    await q;
  }
  return resp(200, { ok: true });   // Asaas precisa de 200, senão pausa a fila
}

async function webhookConfig(sessao: string, url: string) {
  if (!(await admin(sessao))) return resp(403, { erro: "Só o franqueador." });
  if (!KEY || !WH_TOKEN) return resp(503, { erro: "Falta ASAAS_API_KEY ou ASAAS_WEBHOOK_TOKEN." });
  const w = await asaas("/webhooks", { method: "POST", body: JSON.stringify({
    name: "App Grupo MV", url, email: WH_EMAIL, enabled: true, interrupted: false,
    apiVersion: 3, authToken: WH_TOKEN, sendType: "SEQUENTIALLY",
    events: ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED"] }) });
  return resp(200, { ok: true, id: w.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return resp(405, { erro: "método" });
  const acao = new URL(req.url).searchParams.get("acao");
  if (acao === "webhook") return webhook(req);
  const b = await req.json().catch(() => ({}));
  if (acao === "registrar") return registrar(b.sessao, b.cobranca_id);
  if (acao === "webhook-config") return webhookConfig(b.sessao, `${Deno.env.get("SUPABASE_URL")}/functions/v1/asaas?acao=webhook`);
  return resp(400, { erro: "ação" });
});
