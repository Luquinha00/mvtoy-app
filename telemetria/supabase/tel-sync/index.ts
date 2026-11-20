// tel-sync — conversa da placa MV com o servidor (piloto, 20/11/2026).
// A placa gera o pacote assinado; quem leva até aqui é a maquininha (Bluetooth → internet dela) ou a própria placa (Wi-Fi, plano B).
// Chamada a cada ~5 s. Envia: moedas lidas, créditos executados, sinal.
// Recebe: créditos pendentes e a configuração do pulso.
// Segurança: assinatura HMAC-SHA256 com o segredo da placa (cabeçalhos x-placa, x-ts, x-sig).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const enc = new TextEncoder();

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp(405, { erro: "metodo" });
  const placaId = (req.headers.get("x-placa") || "").toUpperCase();
  const ts = Number(req.headers.get("x-ts") || 0);
  const sig = (req.headers.get("x-sig") || "").toLowerCase();
  const corpo = await req.text();
  if (!placaId || !ts || !sig || corpo.length > 4000) return resp(400, { erro: "cabecalho" });

  const { data: placa } = await db.from("mvt_tel_placas").select("*").eq("id", placaId).maybeSingle();
  if (!placa) return resp(401, { erro: "placa" });
  const esperado = await hmacHex(placa.segredo, `${ts}.${corpo}`);
  if (!igual(esperado, sig)) return resp(401, { erro: "assinatura" });
  // relógio da placa vem do servidor (campo "agora" da resposta); aceita 10 min de diferença
  if (Math.abs(Date.now() / 1000 - ts) > 600) return resp(401, { erro: "relogio", agora: Math.floor(Date.now() / 1000) });

  let b: { fw?: string; rssi?: number; lote?: number; moedas?: number; feitos?: string[]; boot?: boolean };
  try { b = JSON.parse(corpo); } catch { return resp(400, { erro: "json" }); }

  const agora = new Date().toISOString();
  const upd: Record<string, unknown> = { ultimo_contato: agora, ultimo_rssi: b.rssi ?? null, firmware: b.fw ?? null };

  // moedas lidas (só conta um lote novo: a placa repete o mesmo lote até receber resposta)
  const moedas = Math.max(0, Math.min(500, Number(b.moedas || 0)));
  if (moedas > 0 && b.lote && b.lote !== placa.ultimo_lote) {
    await db.from("mvt_tel_eventos").insert({ placa_id: placaId, codigo: placa.codigo, tipo: "moeda", pulsos: moedas, valor: moedas * Number(placa.valor_pulso) });
    upd.ultimo_lote = b.lote;
    upd.pulsos_lidos_total = Number(placa.pulsos_lidos_total) + moedas;
  }
  if (b.boot) await db.from("mvt_tel_eventos").insert({ placa_id: placaId, codigo: placa.codigo, tipo: "reinicio" });
  await db.from("mvt_tel_placas").update(upd).eq("id", placaId);

  // créditos que a placa confirmou que executou
  const feitos = (b.feitos || []).filter((x) => typeof x === "string").slice(0, 10);
  if (feitos.length) {
    await db.from("mvt_tel_creditos").update({ status: "executado", executado_em: agora })
      .in("id", feitos).eq("placa_id", placaId).in("status", ["pendente", "enviado"]);
  }

  // créditos pendentes para esta placa (só se ela estiver ligada a uma máquina)
  let creditos: { id: string; pulsos: number; s?: string }[] = [];
  if (placa.codigo) {
    const { data } = await db.from("mvt_tel_creditos").select("id,pulsos")
      .eq("placa_id", placaId).in("status", ["pendente", "enviado"]).order("criado_em").limit(3);
    // cada crédito vai assinado com o segredo da placa: a maquininha só repassa (Bluetooth) e não consegue inventar crédito
    creditos = await Promise.all((data || []).map(async (c) => ({ ...c, s: (await hmacHex(placa.segredo, `${c.id}.${c.pulsos}`)).slice(0, 32) })));
    if (creditos.length) {
      await db.from("mvt_tel_creditos").update({ status: "enviado", enviado_em: agora })
        .in("id", creditos.map((c) => c.id)).eq("status", "pendente");
    }
  }

  return resp(200, {
    ok: true,
    agora: Math.floor(Date.now() / 1000),
    creditos,
    cfg: { pulso_ms: placa.pulso_ms, intervalo_ms: placa.intervalo_ms },
  });
});
