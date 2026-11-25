// nf-emitir — envia as notas APROVADAS no app para o emissor e recebe o retorno.
//  • NFS-e (taxa de franquia, royalties, fundo): Asaas  → cobrança + nota agendada
//  • NF-e  (mercadoria, consignação):            Focus NFe (quando contratada)
// Segredos (nunca no banco/código): ASAAS_API_KEY, ASAAS_AMBIENTE (sandbox|producao),
//   ASAAS_WEBHOOK_TOKEN, FOCUS_TOKEN, FOCUS_AMBIENTE (homologacao|producao).
// Chamadas:
//   POST {sessao}                 → admin manda enviar as aprovadas (até 20 por vez)
//   POST ?webhook=asaas            → aviso do Asaas (header asaas-access-token)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";
const ASAAS_BASE = (Deno.env.get("ASAAS_AMBIENTE") ?? "sandbox") === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
const FOCUS_TOKEN = Deno.env.get("FOCUS_TOKEN") ?? "";
const FOCUS_BASE = (Deno.env.get("FOCUS_AMBIENTE") ?? "homologacao") === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";

async function registrar(id: string, dados: Record<string, unknown>) {
  await sb.rpc("mvt_nf_registrar", { p_id: id, p_dados: dados });
}

async function asaas(path: string, method = "GET", body?: unknown) {
  const r = await fetch(ASAAS_BASE + path, {
    method, headers: { "access_token": ASAAS_KEY, "Content-Type": "application/json", "User-Agent": "MVToy-App" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((t?.errors?.[0]?.description) ?? `Asaas ${r.status}`);
  return t;
}

// ---------- NFS-e pelo Asaas ----------
async function emitirNfse(n: any, regras: any) {
  if (!ASAAS_KEY) return { pendente: "Falta a chave do Asaas (segredo ASAAS_API_KEY)." };
  const sv = regras?.servico_franquia ?? {};
  if (sv.iss_pct == null || !sv.codigo_municipal) {
    await registrar(n.id, { status: "erro", origem: "app", erro_msg: "Falta o código do serviço e a alíquota de ISS da prefeitura (validar com o contador em Regras)." });
    return { erro: "regras fiscais incompletas" };
  }
  const dest = n.destinatario;
  if (!dest?.documento) {
    await registrar(n.id, { status: "erro", origem: "app", erro_msg: "Destinatário sem CNPJ/CPF." });
    return { erro: "sem documento" };
  }
  await registrar(n.id, { status: "enviando", origem: "app", provedor: "asaas" });
  try {
    // 1) cliente
    let cliente = dest.provedor_cliente_id;
    if (!cliente) {
      const busca = await asaas(`/customers?cpfCnpj=${dest.documento}`);
      cliente = busca?.data?.[0]?.id ?? (await asaas("/customers", "POST", {
        name: dest.razao_social || dest.nome, cpfCnpj: dest.documento, email: dest.email_nf ?? undefined,
        externalReference: dest.id, notificationDisabled: false,
      })).id;
      await sb.from("mvt_fiscal_entidades").update({ provedor_cliente_id: cliente }).eq("id", dest.id);
    }
    // 2) cobrança (o franqueado paga por Pix ou boleto)
    let cobranca = n.provedor_cobranca_id;
    if (!cobranca) {
      const venc = n.vencimento ?? new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      cobranca = (await asaas("/payments", "POST", {
        customer: cliente, billingType: "UNDEFINED", value: Number(n.valor), dueDate: venc,
        description: n.descricao, externalReference: n.id,
      })).id;
    }
    // 3) nota agendada para a cobrança
    const nota = await asaas("/invoices", "POST", {
      payment: cobranca, serviceDescription: n.descricao, observations: "Emitida pelo app MV Toy",
      value: Number(n.valor), deductions: 0, effectiveDate: new Date().toISOString().slice(0, 10),
      municipalServiceCode: String(sv.codigo_municipal), municipalServiceName: sv.nome ?? "Franquia",
      taxes: { retainIss: false, iss: Number(sv.iss_pct), cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0 },
    });
    await registrar(n.id, { status: "agendada", origem: "asaas", provedor: "asaas", provedor_cobranca_id: cobranca, provedor_nota_id: nota.id, erro_msg: null });
    return { ok: true };
  } catch (e) {
    await registrar(n.id, { status: "erro", origem: "asaas", erro_msg: String((e as Error).message).slice(0, 400) });
    return { erro: String(e) };
  }
}

// ---------- NF-e pela Focus NFe ----------
async function emitirNfe(n: any) {
  if (!FOCUS_TOKEN) return { pendente: "API de NF-e ainda não contratada (segredo FOCUS_TOKEN)." };
  const e = n.emitente, d = n.destinatario, ed = e.endereco ?? {}, dd = d.endereco ?? {};
  const corpo = {
    natureza_operacao: ({ remessa_consignacao: "Remessa em consignação", venda_consignacao: "Venda de mercadoria remetida em consignação" } as any)[n.natureza] ?? "Venda de mercadoria",
    data_emissao: new Date().toISOString(), tipo_documento: 1, finalidade_emissao: 1, local_destino: 1,
    consumidor_final: 0, presenca_comprador: 9, modalidade_frete: 9,
    cnpj_emitente: e.documento,
    nome_destinatario: d.razao_social || d.nome, cnpj_destinatario: d.documento?.length === 14 ? d.documento : undefined,
    cpf_destinatario: d.documento?.length === 11 ? d.documento : undefined,
    inscricao_estadual_destinatario: d.inscricao_estadual ?? undefined, indicador_inscricao_estadual_destinatario: d.inscricao_estadual ? 1 : 9,
    logradouro_destinatario: dd.logradouro, numero_destinatario: dd.numero, bairro_destinatario: dd.bairro,
    municipio_destinatario: dd.cidade, uf_destinatario: dd.uf, cep_destinatario: dd.cep, email_destinatario: d.email_nf ?? undefined,
    notas_referenciadas: n.nota_ref_chave ? [{ chave_nfe: n.nota_ref_chave }] : undefined,
    items: (n.itens ?? []).map((i: any, k: number) => ({
      numero_item: k + 1, codigo_produto: i.produto_id ?? `ITEM${k + 1}`, descricao: i.nome,
      cfop: n.cfop, unidade_comercial: i.unidade ?? "UN", quantidade_comercial: i.qtd, valor_unitario_comercial: i.valor_unit,
      valor_bruto: Number((i.qtd * i.valor_unit).toFixed(2)), unidade_tributavel: i.unidade ?? "UN", quantidade_tributavel: i.qtd,
      valor_unitario_tributavel: i.valor_unit, codigo_ncm: i.ncm, icms_origem: 0,
      icms_situacao_tributaria: e.regime === "simples" || e.regime === "mei" ? "102" : "00",
      pis_situacao_tributaria: "07", cofins_situacao_tributaria: "07",
    })),
  };
  const falta = corpo.items.find((i: any) => !i.codigo_ncm) ? "item sem NCM" : (!dd.cep ? "endereço do destinatário incompleto" : "");
  if (falta) { await registrar(n.id, { status: "erro", origem: "app", erro_msg: `NF-e: ${falta}.` }); return { erro: falta }; }
  await registrar(n.id, { status: "enviando", origem: "app", provedor: "focus" });
  const r = await fetch(`${FOCUS_BASE}/v2/nfe?ref=${n.id}`, {
    method: "POST", headers: { "Authorization": "Basic " + btoa(FOCUS_TOKEN + ":"), "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) { await registrar(n.id, { status: "erro", origem: "focus", erro_msg: String(t?.mensagem ?? r.status).slice(0, 400) }); return { erro: t }; }
  await registrar(n.id, { status: "agendada", origem: "focus", provedor: "focus", provedor_nota_id: n.id, erro_msg: null });
  return { ok: true };
}

// ---------- aviso do Asaas (webhook) ----------
async function webhookAsaas(req: Request) {
  const tk = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
  if (!tk || req.headers.get("asaas-access-token") !== tk) return json({ erro: "não autorizado" }, 401);
  const ev = await req.json().catch(() => ({}));
  const inv = ev?.invoice;
  if (!inv?.id) return json({ ok: true, ignorado: ev?.event });
  const { data: n } = await sb.from("mvt_nf_notas").select("id").eq("provedor_nota_id", inv.id).maybeSingle();
  if (!n) return json({ ok: true, sem_nota: inv.id });
  const st = ({ INVOICE_AUTHORIZED: "emitida", INVOICE_CANCELED: "cancelada", INVOICE_ERROR: "erro", INVOICE_CANNOT_BE_CANCELLED: "emitida" } as any)[ev.event];
  await registrar(n.id, { origem: "webhook", ...(st ? { status: st } : {}), numero: inv.number ?? undefined, pdf_url: inv.pdfUrl ?? undefined, xml_url: inv.xmlUrl ?? undefined,
    ...(st === "erro" ? { erro_msg: inv.statusDescription ?? "Erro na prefeitura" } : {}) });
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("webhook") === "asaas") return await webhookAsaas(req);

  const { sessao } = await req.json().catch(() => ({}));
  const { data: admin } = await sb.rpc("mvt_admin_de", { p_sessao: sessao });
  if (!admin) return json({ erro: "Só o franqueador." }, 403);

  const { data: cfg } = await sb.from("mvt_config").select("valor").eq("chave", "nf_regras").maybeSingle();
  const regras = cfg ? JSON.parse(cfg.valor) : {};
  const { data: notas } = await sb.from("mvt_nf_notas")
    .select("*, emitente:emitente_id(*), destinatario:destinatario_id(*), ref:nota_ref_id(chave)")
    .eq("status", "aprovada").order("criado_em").limit(20);

  const resultado: unknown[] = [];
  for (const n of notas ?? []) {
    n.nota_ref_chave = n.ref?.chave;
    const r = n.modelo === "nfse" ? await emitirNfse(n, regras) : await emitirNfe(n);
    resultado.push({ id: n.id, natureza: n.natureza, ...r });
  }
  return json({ ok: true, enviadas: resultado.length, resultado, asaas: !!ASAAS_KEY, focus: !!FOCUS_TOKEN });
});
