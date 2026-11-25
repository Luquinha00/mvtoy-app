// nf-emitir — envia as notas APROVADAS no app DIRETO para o governo e guarda o retorno.
//  • NFS-e (taxa de franquia, royalties): Sistema Nacional NFS-e (Sefin Nacional) — API gratuita
//  • NF-e  (consignação, venda de mercadoria): Sefaz-SP NFeAutorizacao4 — gratuito
//  (Asaas e Focus ficaram como plano B, só se o cadastro do emitente mandar.)
// Segredos do servidor (nunca no banco nem no código), um par por CNPJ emitente:
//   NFCERT_<cnpj> = certificado A1 (.pfx) em base64   ·   NFSENHA_<cnpj> = senha do certificado
// Chamadas (todas exigem sessão de admin, menos o webhook do Asaas):
//   POST {sessao}                    → envia as aprovadas (até 20 por vez) e consulta as pendentes
//   POST ?teste=1 {sessao}           → testa certificado + conexão com Receita e Sefaz de cada emitente
//   POST ?pdf=<id> {sessao}          → devolve o PDF oficial (DANFSe) da NFS-e
import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";
import { forge } from "./deps.ts";
import { lerPfx, assinar, montarDps, montarNfe, envelopeAutorizacao, pegar, so, agoraBR, type Cert } from "./fiscal_lib.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const ASAAS_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";
const ASAAS_BASE = (Deno.env.get("ASAAS_AMBIENTE") ?? "sandbox") === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
const FOCUS_TOKEN = Deno.env.get("FOCUS_TOKEN") ?? "";
const FOCUS_BASE = (Deno.env.get("FOCUS_AMBIENTE") ?? "homologacao") === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";

const SEFIN = { homologacao: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional", producao: "https://sefin.nfse.gov.br/SefinNacional" } as const;
const ADN = { homologacao: "https://adn.producaorestrita.nfse.gov.br", producao: "https://adn.nfse.gov.br" } as const;
const SEFAZ_SP = { homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws", producao: "https://nfe.fazenda.sp.gov.br/ws" } as const;
type Amb = "homologacao" | "producao";

async function registrar(id: string, dados: Record<string, unknown>) {
  await sb.rpc("mvt_nf_registrar", { p_id: id, p_dados: dados });
}
const erro = async (n: any, origem: string, msg: string) => { await registrar(n.id, { status: "erro", origem, erro_msg: msg.slice(0, 500) }); return { erro: msg }; };

// ---------- certificado A1 (só em memória) ----------
const certCache = new Map<string, { cert: Cert; client: any } | null>();
let icpCas: string[] | null = null;
async function casIcpBrasil(): Promise<string[]> {
  if (icpCas) return icpCas;
  const { data } = await sb.from("mvt_config").select("valor").eq("chave", "icp_brasil_cas").maybeSingle();
  if (data?.valor) return (icpCas = JSON.parse(data.valor));
  // cadeia pública da ICP-Brasil (o certificado do servidor da Sefaz-SP é ICP-Brasil)
  const r = await fetch("https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip");
  if (!r.ok) throw new Error(`Não baixei a cadeia ICP-Brasil (${r.status}).`);
  const arq = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const pems: string[] = [];
  for (const [nome, bytes] of Object.entries(arq)) {
    if (!/\.(crt|cer|pem)$/i.test(nome)) continue;
    const txt = new TextDecoder().decode(bytes);
    if (txt.includes("BEGIN CERTIFICATE")) { pems.push(...(txt.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [])); continue; }
    try { pems.push(forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(bytes))))); } catch { /* ignora */ }
  }
  if (!pems.length) throw new Error("Cadeia ICP-Brasil vazia.");
  await sb.from("mvt_config").upsert({ chave: "icp_brasil_cas", valor: JSON.stringify(pems) });
  return (icpCas = pems);
}
async function certDe(cnpj: string, sefaz = false) {
  const k = cnpj + (sefaz ? ":sefaz" : "");
  if (certCache.has(k)) return certCache.get(k)!;
  const b64 = Deno.env.get(`NFCERT_${cnpj}`), senha = Deno.env.get(`NFSENHA_${cnpj}`) ?? "";
  if (!b64) { certCache.set(k, null); return null; }
  const cert = lerPfx(b64, senha);
  const client = (Deno as any).createHttpClient({ cert: cert.chainPem, key: cert.keyPem, http2: false, ...(sefaz ? { caCerts: await casIcpBrasil() } : {}) });
  const v = { cert, client }; certCache.set(k, v); return v;
}
const semCert = (cnpj: string) => `Falta o certificado digital A1 do CNPJ ${cnpj} no servidor (segredos NFCERT_${cnpj} e NFSENHA_${cnpj}).`;

// ---------- código IBGE da cidade ----------
const ibgeCache = new Map<string, string>();
async function ibge(end: any): Promise<string> {
  if (so(end?.ibge).length === 7) return so(end.ibge);
  const uf = String(end?.uf ?? "").toUpperCase(), cid = String(end?.cidade ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!uf || !cid) return "";
  const k = uf + "|" + cid; if (ibgeCache.has(k)) return ibgeCache.get(k)!;
  const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
  const lista = r.ok ? await r.json() : [];
  for (const m of lista) ibgeCache.set(uf + "|" + String(m.nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), String(m.id));
  return ibgeCache.get(k) ?? "";
}

// ---------- gzip/base64 ----------
async function gzipB64(txt: string) {
  const cs = new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let s = ""; for (const b of buf) s += String.fromCharCode(b); return btoa(s);
}
async function gunzipB64(b64: string) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// ---------- NFS-e direto no Sistema Nacional ----------
async function emitirNfseNacional(n: any, regras: any) {
  const e = n.emitente, d = n.destinatario, amb: Amb = e.ambiente ?? "homologacao";
  const cnpj = so(e.documento);
  if (cnpj.length !== 14) return await erro(n, "app", "Emitente sem CNPJ.");
  if (!so(d?.documento)) return await erro(n, "app", "Tomador sem CNPJ/CPF.");
  const c = await certDe(cnpj).catch((x) => { throw new Error("Certificado inválido ou senha errada: " + x.message); });
  if (!c) return { pendente: semCert(cnpj) };
  if (c.cert.validade < new Date()) return await erro(n, "app", "Certificado digital vencido.");
  const ibgeE = await ibge(e.endereco), ibgeT = await ibge(d.endereco);
  if (!ibgeE) return await erro(n, "app", "Endereço do emitente sem cidade/UF válidos.");
  const sv = regras?.servico_franquia ?? {};
  const { data: num } = await sb.rpc("mvt_nf_numerar", { p_nota: n.id });
  let aliq = 0;
  if ((e.regime ?? "simples") === "simples") {
    const { data: fx } = await sb.rpc("mvt_fiscal_calc", { p_entidade: e.id, p_mes: n.competencia });
    aliq = Math.round(Number(fx?.aliq_royalties ?? 0) * 10000) / 100;
  }
  const dps = montarDps({ ambiente: amb, serie: String(num.serie), numero: Number(num.numero), competencia: String(n.competencia).slice(0, 10),
    prest: e, toma: d, ibgePrest: ibgeE, ibgeToma: ibgeT || undefined, cTribNac: sv.c_trib_nac ?? "170801", cTribMun: sv.c_trib_mun, cNBS: sv.c_nbs,
    descricao: n.descricao, valor: Number(n.valor), aliqSimples: aliq });
  const xml = assinar(dps.xml, "infDPS", c.cert, "nfse");
  await registrar(n.id, { status: "enviando", origem: "app", provedor: "nacional", provedor_nota_id: dps.id });
  try {
    const r = await fetch(`${SEFIN[amb]}/nfse`, { method: "POST", client: c.client, headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ dpsXmlGZipB64: await gzipB64(xml) }) } as any);
    const t: any = await r.json().catch(async () => ({ texto: (await r.text().catch(() => "")).slice(0, 300) }));
    if (t?.chaveAcesso) {
      const nx = t.nfseXmlGZipB64 ? await gunzipB64(t.nfseXmlGZipB64) : "";
      await registrar(n.id, { status: "emitida", origem: "sefin", provedor: "nacional", chave: t.chaveAcesso, numero: pegar(nx, "nNFSe") ?? null,
        protocolo: t.idDps ?? dps.id, xml: nx || xml, erro_msg: null });
      return { ok: true, chave: t.chaveAcesso };
    }
    const lista = t?.erros ?? t?.Erros ?? t?.erro ?? [];
    const msg = (Array.isArray(lista) ? lista : [lista]).map((x: any) => `${x?.Codigo ?? x?.codigo ?? ""} ${x?.Descricao ?? x?.descricao ?? x?.mensagem ?? ""}`.trim()).filter(Boolean).join(" | ")
      || t?.texto || `Receita respondeu ${r.status}`;
    return await erro(n, "sefin", msg);
  } catch (x) { return await erro(n, "sefin", "Sem conexão com a Receita: " + String((x as Error).message)); }
}

// ---------- NF-e direto na Sefaz-SP ----------
const NAT_OP: Record<string, string> = { remessa_consignacao: "Remessa em consignacao", venda_consignacao: "Venda de mercadoria remetida em consignacao",
  venda_mercadoria: "Venda de mercadoria", venda_comercio: "Venda de mercadoria" };
async function soap(url: string, servico: string, corpo: string, client: any) {
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>`
    + `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  const r = await fetch(url, { method: "POST", client, headers: { "Content-Type": "application/soap+xml; charset=utf-8" }, body: env } as any);
  return await r.text();
}
async function emitirNfeSefaz(n: any, regras: any) {
  const e = n.emitente, d = n.destinatario, amb: Amb = e.ambiente ?? "homologacao";
  const cnpj = so(e.documento);
  if (String(e.endereco?.uf ?? "SP").toUpperCase() !== "SP") return await erro(n, "app", "Por enquanto a NF-e direta está ligada só para emitente de SP.");
  if (!so(e.inscricao_estadual)) return await erro(n, "app", "Emitente sem Inscrição Estadual: sem IE não dá para emitir NF-e de produto.");
  const itens = (n.itens ?? []).map((i: any) => ({ codigo: i.produto_id, nome: i.nome, ncm: i.ncm, qtd: Number(i.qtd), valor_unit: Number(i.valor_unit), unidade: i.unidade }));
  if (!itens.length) return await erro(n, "app", "NF-e sem itens.");
  if (itens.some((i: any) => so(i.ncm).length !== 8)) return await erro(n, "app", "Item sem NCM (8 dígitos).");
  if (so(d?.endereco?.cep).length !== 8 || !d?.endereco?.logradouro) return await erro(n, "app", "Endereço do destinatário incompleto (CEP e rua).");
  const c = await certDe(cnpj, true);
  if (!c) return { pendente: semCert(cnpj) };
  const ibgeE = await ibge(e.endereco), ibgeD = await ibge(d.endereco);
  if (!ibgeE || !ibgeD) return await erro(n, "app", "Cidade/UF do emitente ou destinatário não encontrada no IBGE.");
  const { data: num } = await sb.rpc("mvt_nf_numerar", { p_nota: n.id });
  const rt = regras?.resp_tec ?? {};
  const nfe = montarNfe({ ambiente: amb, serie: String(num.serie), numero: Number(num.numero), natOp: NAT_OP[n.natureza] ?? "Venda de mercadoria",
    cfop: n.cfop, emit: e, dest: d, ibgeEmit: ibgeE, ibgeDest: ibgeD, itens, refChave: n.nota_ref_chave ?? undefined,
    csosn: regras?.nfe?.csosn?.[n.natureza], semPagamento: n.natureza === "remessa_consignacao",
    respTec: { cnpj: rt.cnpj ?? cnpj, contato: rt.contato ?? (e.razao_social || e.nome), email: rt.email ?? e.email_nf ?? "", fone: rt.fone ?? e.telefone ?? "" } });
  const assinada = assinar(nfe.xml, "infNFe", c.cert, "nfe");
  await registrar(n.id, { status: "enviando", origem: "app", provedor: "sefaz", chave: nfe.chave });
  try {
    const resp = await soap(`${SEFAZ_SP[amb]}/nfeautorizacao4.asmx`, "NFeAutorizacao4",
      envelopeAutorizacao(assinada, String(Date.now()).slice(-15)).match(/<enviNFe[\s\S]*<\/enviNFe>/)![0], c.client);
    const cLote = pegar(resp, "cStat"), prot = pegar(resp, "protNFe");
    if (prot) {
      const cs = pegar(prot, "cStat"), mot = pegar(prot, "xMotivo") ?? "";
      if (cs === "100" || cs === "150") {
        const proc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${assinada.replace(/<\?xml[^>]*\?>/, "")}<protNFe versao="4.00">${prot}</protNFe></nfeProc>`;
        await registrar(n.id, { status: "emitida", origem: "sefaz", chave: nfe.chave, numero: String(num.numero), protocolo: pegar(prot, "nProt"), xml: proc, erro_msg: null });
        return { ok: true, chave: nfe.chave };
      }
      return await erro(n, "sefaz", `${cs} ${mot}`);
    }
    if (cLote === "103") { // lote recebido para processar depois
      await registrar(n.id, { status: "agendada", origem: "sefaz", protocolo: "recibo:" + pegar(resp, "nRec") });
      return { ok: true, recibo: pegar(resp, "nRec") };
    }
    return await erro(n, "sefaz", `${cLote ?? ""} ${pegar(resp, "xMotivo") ?? resp.slice(0, 250)}`);
  } catch (x) { return await erro(n, "sefaz", "Sem conexão com a Sefaz-SP: " + String((x as Error).message)); }
}
async function consultarRecibo(n: any) {
  const e = n.emitente, amb: Amb = e.ambiente ?? "homologacao", c = await certDe(so(e.documento), true);
  if (!c) return;
  const rec = String(n.protocolo).replace("recibo:", "");
  const resp = await soap(`${SEFAZ_SP[amb]}/nferetautorizacao4.asmx`, "NFeRetAutorizacao4",
    `<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${amb === "producao" ? 1 : 2}</tpAmb><nRec>${rec}</nRec></consReciNFe>`, c.client);
  const prot = pegar(resp, "protNFe"); if (!prot) return;
  const cs = pegar(prot, "cStat");
  if (cs === "100" || cs === "150") await registrar(n.id, { status: "emitida", origem: "sefaz", protocolo: pegar(prot, "nProt"), erro_msg: null });
  else await registrar(n.id, { status: "erro", origem: "sefaz", erro_msg: `${cs} ${pegar(prot, "xMotivo") ?? ""}` });
}

// ---------- teste de conexão ----------
async function testar() {
  const { data: ents } = await sb.from("mvt_fiscal_entidades").select("*").eq("emite", true).eq("ativo", true);
  const out: unknown[] = [];
  for (const e of ents ?? []) {
    const cnpj = so(e.documento), amb: Amb = e.ambiente ?? "homologacao", r: any = { nome: e.nome, cnpj, ambiente: amb };
    try {
      const c = await certDe(cnpj);
      if (!c) { r.certificado = "falta"; out.push(r); continue; }
      r.certificado = { titular: c.cert.titular, cnpj_do_certificado: c.cert.cnpj, vence: c.cert.validade.toISOString().slice(0, 10), confere: c.cert.cnpj === cnpj };
      const ib = await ibge(e.endereco);
      const g = await fetch(`${ADN[amb]}/parametrizacao/${ib}/convenio`, { client: c.client } as any).catch((x) => ({ status: 0, text: async () => String(x) }));
      r.receita = `${g.status} ${(await g.text()).slice(0, 160)}`;
      if (so(e.inscricao_estadual)) {
        const cs = await certDe(cnpj, true);
        const st = await soap(`${SEFAZ_SP[amb]}/nfestatusservico4.asmx`, "NFeStatusServico4",
          `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${amb === "producao" ? 1 : 2}</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>`, cs!.client);
        r.sefaz = `${pegar(st, "cStat") ?? "?"} ${pegar(st, "xMotivo") ?? st.slice(0, 160)}`;
      } else r.sefaz = "sem IE cadastrada (NF-e de produto não liberada)";
    } catch (x) { r.erro = String((x as Error).message).slice(0, 300); }
    out.push(r);
  }
  return out;
}

async function danfse(id: string) {
  const { data: n } = await sb.from("mvt_nf_notas").select("chave, modelo, emitente:emitente_id(documento, ambiente)").eq("id", id).maybeSingle();
  if (!n?.chave || n.modelo !== "nfse") return json({ erro: "Nota sem chave de NFS-e." }, 404);
  const e: any = n.emitente, c = await certDe(so(e.documento));
  if (!c) return json({ erro: semCert(so(e.documento)) }, 400);
  const r = await fetch(`${ADN[(e.ambiente ?? "homologacao") as Amb]}/danfse/${n.chave}`, { client: c.client } as any);
  if (!r.ok) return json({ erro: `PDF indisponível (${r.status}).` }, 502);
  return new Response(r.body, { headers: { ...CORS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="NFSe-${n.chave}.pdf"` } });
}

// ---------- plano B: NFS-e pelo Asaas ----------
async function asaas(path: string, method = "GET", body?: unknown) {
  const r = await fetch(ASAAS_BASE + path, { method, headers: { "access_token": ASAAS_KEY, "Content-Type": "application/json", "User-Agent": "MVToy-App" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((t?.errors?.[0]?.description) ?? `Asaas ${r.status}`);
  return t;
}
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
    let cliente = dest.provedor_cliente_id;
    if (!cliente) {
      const busca = await asaas(`/customers?cpfCnpj=${dest.documento}`);
      cliente = busca?.data?.[0]?.id ?? (await asaas("/customers", "POST", {
        name: dest.razao_social || dest.nome, cpfCnpj: dest.documento, email: dest.email_nf ?? undefined,
        externalReference: dest.id, notificationDisabled: false,
      })).id;
      await sb.from("mvt_fiscal_entidades").update({ provedor_cliente_id: cliente }).eq("id", dest.id);
    }
    let cobranca = n.provedor_cobranca_id;
    if (!cobranca) {
      const venc = n.vencimento ?? new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      cobranca = (await asaas("/payments", "POST", {
        customer: cliente, billingType: "UNDEFINED", value: Number(n.valor), dueDate: venc,
        description: n.descricao, externalReference: n.id,
      })).id;
    }
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

// ---------- plano B: NF-e pela Focus NFe ----------
async function emitirNfe(n: any) {
  if (!FOCUS_TOKEN) return { pendente: "API de NF-e ainda não contratada (segredo FOCUS_TOKEN)." };
  return await erro(n, "app", "Plano B (Focus) desligado: use a emissão direta na Sefaz.");
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
  if (url.searchParams.get("teste")) return json({ ok: true, emitentes: await testar() });
  if (url.searchParams.get("pdf")) return await danfse(url.searchParams.get("pdf")!);

  const { data: cfg } = await sb.from("mvt_config").select("valor").eq("chave", "nf_regras").maybeSingle();
  const regras = cfg ? JSON.parse(cfg.valor) : {};
  const sel = "*, emitente:emitente_id(*), destinatario:destinatario_id(*), ref:nota_ref_id(chave)";
  const { data: pend } = await sb.from("mvt_nf_notas").select(sel).eq("status", "agendada").eq("provedor", "sefaz").like("protocolo", "recibo:%").limit(20);
  for (const n of pend ?? []) await consultarRecibo(n).catch(() => {});
  const { data: notas } = await sb.from("mvt_nf_notas").select(sel).eq("status", "aprovada").order("criado_em").limit(20);

  const resultado: unknown[] = [];
  for (const n of notas ?? []) {
    n.nota_ref_chave = n.ref?.chave;
    let r: any;
    try {
      if (n.modelo === "nfse") r = (n.emitente?.provedor_nfse ?? "nacional") === "asaas" ? await emitirNfse(n, regras) : await emitirNfseNacional(n, regras);
      else r = n.emitente?.provedor_nfe === "focus" ? await emitirNfe(n) : await emitirNfeSefaz(n, regras);
    } catch (x) { r = await erro(n, "app", String((x as Error).message)); }
    resultado.push({ id: n.id, natureza: n.natureza, ...r });
  }
  return json({ ok: true, enviadas: resultado.length, resultado });
});
