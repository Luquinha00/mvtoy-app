// tel-sync v5 — conversa da Telemetria MV Toy com o servidor (protocolo 2 · 23/11/2026).
// Duas linhas de placa: MV Toy Conecta Pulso (tipo 'pulso': moedas, notas, prêmios, créditos) e MV Toy Conecta Vending (tipo 'mdb': vendas MDB).
// A placa gera o pacote assinado; quem leva até aqui é a maquininha (Bluetooth → internet dela) ou a própria placa (Wi-Fi, piloto).
// Envia: moedas lidas (por lote), créditos executados, sinal. Recebe: créditos pendentes e a configuração.
// Segurança: a placa assina o pedido (x-placa, x-ts, x-sig = HMAC-SHA256(segredo, ts.corpo)).
//            O servidor assina a confirmação  a = HMAC(segredo, "ok.<agora>.<lote>")[0:32]
//            e cada crédito                   s = HMAC(segredo, "<id>.<pulsos>.<agora>")[0:32].
// Economia: a placa só fala quando tem moeda/confirmação ou a cada envio_s (Bluetooth 300 s; Wi-Fi piloto 20 s).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const enc = new TextEncoder();
const ENVIO_S = { ble: 300, wifi: 20 } as const;

async function hmacHex(segredo: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const resp = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// lote novo? (a placa repete o mesmo lote até receber confirmação; cópia atrasada de lote velho não conta;
//  lote muito menor = placa regravada/zerada → recomeça a contagem)
function loteNovo(lote: number, ultimo: number | null) {
  if (!lote) return false;
  if (ultimo == null) return true;
  return lote > ultimo || lote < ultimo - 50;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp(405, { erro: "metodo" });
  const placaId = (req.headers.get("x-placa") || "").toUpperCase().slice(0, 20);
  const ts = Number(req.headers.get("x-ts") || 0);
  const sig = (req.headers.get("x-sig") || "").toLowerCase();
  const corpo = await req.text();
  if (!placaId || !ts || !sig || corpo.length > 4000) return resp(400, { erro: "cabecalho" });

  const { data: placa } = await db.from("mvt_tel_placas").select("*").eq("id", placaId).maybeSingle();
  if (!placa) return resp(401, { erro: "placa" });
  const esperado = await hmacHex(placa.segredo, `${ts}.${corpo}`);
  if (!igual(esperado, sig)) return resp(401, { erro: "assinatura" });
  const agoraS = Math.floor(Date.now() / 1000);
  if (Math.abs(agoraS - ts) > 600) return resp(401, { erro: "relogio", agora: agoraS });

  let b: { p?: number; via?: string; fw?: string; rssi?: number; lote?: number; moedas?: number; notas?: number; premios?: number; feitos?: string[]; boot?: boolean;
    vendas?: { i?: number; v?: number; m?: string }[] };
  try { b = JSON.parse(corpo); } catch { return resp(400, { erro: "json" }); }
  const via = b.via === "wifi" ? "wifi" : "ble";
  const lote = Math.max(0, Math.floor(Number(b.lote || 0)));
  const agoraIso = new Date().toISOString();

  // contato da placa (sem mexer na contagem)
  await db.from("mvt_tel_placas").update({ ultimo_contato: agoraIso, ultimo_rssi: b.rssi ?? null, firmware: b.fw ?? null }).eq("id", placaId);

  // moedas (COINA), notas (COINB) e prêmios (sensor de saída) do lote: atualização condicional (pedidos iguais juntos contam 1 vez só)
  const lim = (v: unknown) => Math.max(0, Math.min(500, Math.floor(Number(v || 0))));
  const moedas = lim(b.moedas), notas = lim(b.notas), premios = lim(b.premios);
  // MV Toy Conecta Vending: vendas do lote (item = seleção da máquina, v = preço em R$, m = meio: cartao | dinheiro | ?)
  const MEIOS = ["cartao", "dinheiro"];
  const vendas = placa.tipo === "mdb" ? (Array.isArray(b.vendas) ? b.vendas : []).slice(0, 50)
    .map((x) => ({ i: Math.max(0, Math.min(65535, Math.floor(Number(x?.i ?? 0)))), v: Math.round(Number(x?.v ?? 0) * 100) / 100, m: MEIOS.includes(String(x?.m)) ? String(x?.m) : null }))
    .filter((x) => x.v >= 0 && x.v <= 2000) : [];
  let atual = placa;
  for (let tent = 0; tent < 3 && moedas + notas + premios + vendas.length > 0 && loteNovo(lote, atual.ultimo_lote); tent++) {
    let q = db.from("mvt_tel_placas")
      .update({ ultimo_lote: lote, pulsos_lidos_total: Number(atual.pulsos_lidos_total || 0) + moedas + notas })
      .eq("id", placaId).eq("pulsos_lidos_total", atual.pulsos_lidos_total ?? 0);
    q = atual.ultimo_lote == null ? q.is("ultimo_lote", null) : q.eq("ultimo_lote", atual.ultimo_lote);
    const { data: feito } = await q.select("id");
    if (feito && feito.length) {
      const vp = Number(placa.valor_pulso);
      const ev = [];
      if (moedas) ev.push({ placa_id: placaId, codigo: placa.codigo, tipo: "moeda", pulsos: moedas, valor: moedas * vp });
      if (notas) ev.push({ placa_id: placaId, codigo: placa.codigo, tipo: "nota", pulsos: notas, valor: notas * vp });
      if (premios) ev.push({ placa_id: placaId, codigo: placa.codigo, tipo: "premio", pulsos: premios, valor: 0 });
      for (const x of vendas) ev.push({ placa_id: placaId, codigo: placa.codigo, tipo: "venda", pulsos: 1, valor: x.v, item: String(x.i), meio: x.m });
      if (ev.length) await db.from("mvt_tel_eventos").insert(ev);
      break;
    }
    const { data: novo } = await db.from("mvt_tel_placas").select("*").eq("id", placaId).maybeSingle();
    if (!novo) break;
    atual = novo;
  }
  if (b.boot) await db.from("mvt_tel_eventos").insert({ placa_id: placaId, codigo: placa.codigo, tipo: "reinicio" });

  // créditos que a placa confirmou que executou
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const feitos = (b.feitos || []).filter((x) => typeof x === "string" && UUID.test(x)).slice(0, 10);
  if (feitos.length) {
    await db.from("mvt_tel_creditos").update({ status: "executado", executado_em: agoraIso })
      .in("id", feitos).eq("placa_id", placaId).in("status", ["pendente", "enviado"]);
  }

  // créditos pendentes (só se a placa estiver ligada a uma máquina), cada um assinado com a hora do servidor
  let creditos: { id: string; pulsos: number; s: string }[] = [];
  if (placa.codigo) {
    const { data } = await db.from("mvt_tel_creditos").select("id,pulsos")
      .eq("placa_id", placaId).in("status", ["pendente", "enviado"]).order("criado_em").limit(3);
    creditos = await Promise.all((data || []).map(async (c) => ({ id: c.id, pulsos: c.pulsos, s: (await hmacHex(placa.segredo, `${c.id}.${c.pulsos}.${agoraS}`)).slice(0, 32) })));
    if (creditos.length) {
      await db.from("mvt_tel_creditos").update({ status: "enviado", enviado_em: agoraIso })
        .in("id", creditos.map((c) => c.id)).eq("status", "pendente");
    }
  }

  return resp(200, {
    ok: true,
    agora: agoraS,
    a: (await hmacHex(placa.segredo, `ok.${agoraS}.${lote}`)).slice(0, 32),
    creditos,
    cfg: { pulso_ms: placa.pulso_ms, intervalo_ms: placa.intervalo_ms, envio_s: ENVIO_S[via] },
  });
});
