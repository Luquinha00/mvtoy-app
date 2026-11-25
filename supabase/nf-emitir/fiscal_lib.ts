// Biblioteca de nota fiscal direto no governo — sem intermediário, sem custo por nota.
//  • lerPfx: abre o certificado A1 (.pfx) e devolve PEM (chave + cadeia)
//  • assinar: assinatura XMLDSig (enveloped) no padrão de cada documento
//  • montarDps: NFS-e padrão nacional (leiaute DPS v1.01, Sefin Nacional)
//  • montarNfe: NF-e 4.00 (Sefaz), com chave de acesso e dígito verificador
// Funções puras: testáveis fora do servidor. Nada de segredo é gravado aqui.
import { forge, SignedXml } from "./deps.ts";

// ---------------- utilidades ----------------
export const so = (s: unknown) => String(s ?? "").replace(/\D/g, "");
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\s+/g, " ").trim();
const tag = (n: string, v: unknown) => (v === undefined || v === null || v === "" ? "" : `<${n}>${esc(v)}</${n}>`);
const d2 = (v: unknown) => Number(v ?? 0).toFixed(2);
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export function agoraBR(d = new Date()) { // AAAA-MM-DDThh:mm:ss-03:00
  const t = new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19);
  return `${t}-03:00`;
}

// ---------------- certificado ----------------
export type Cert = { keyPem: string; certPem: string; chainPem: string; cnpj: string; titular: string; validade: Date };
export function lerPfx(pfxB64: string, senha: string): Cert {
  const der = forge.util.decode64(pfxB64.replace(/\s/g, ""));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0]
    ?? (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])[0];
  if (!keyBag?.key) throw new Error("Certificado sem chave privada (precisa ser A1 .pfx).");
  const key = keyBag.key as any;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b: any) => b.cert);
  const leaf = certs.find((c: any) => c.publicKey.n.equals(key.n)) ?? certs[0];
  if (!leaf) throw new Error("Certificado não encontrado no arquivo.");
  const outros = certs.filter((c: any) => c !== leaf);
  const cn = leaf.subject.getField("CN")?.value ?? "";
  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  const certPem = forge.pki.certificateToPem(leaf);
  return { keyPem, certPem, chainPem: [certPem, ...outros.map((c: any) => forge.pki.certificateToPem(c))].join(""),
    cnpj: (cn.match(/:(\d{14})/) ?? [])[1] ?? "", titular: cn.split(":")[0], validade: leaf.validity.notAfter };
}

// ---------------- assinatura ----------------
const ALG = {
  nfse: { sig: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", dig: "http://www.w3.org/2001/04/xmlenc#sha256", c14n: "http://www.w3.org/2001/10/xml-exc-c14n#" },
  nfe: { sig: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", dig: "http://www.w3.org/2000/09/xmldsig#sha1", c14n: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315" },
};
export function assinar(xml: string, elemento: string, cert: Cert, padrao: "nfse" | "nfe") {
  const a = ALG[padrao];
  const sig = new SignedXml({ privateKey: cert.keyPem, publicCert: cert.certPem, signatureAlgorithm: a.sig, canonicalizationAlgorithm: a.c14n });
  sig.addReference({ xpath: `//*[local-name(.)='${elemento}']`, digestAlgorithm: a.dig,
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", a.c14n] });
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='${elemento}']`, action: "after" } });
  return sig.getSignedXml();
}

// ---------------- NFS-e padrão nacional (DPS) ----------------
export type Ente = { documento: string; razao_social?: string; nome: string; email_nf?: string; telefone?: string; inscricao_municipal?: string;
  inscricao_estadual?: string; regime?: string; crt?: number; endereco?: any };
export function montarDps(p: {
  ambiente: "homologacao" | "producao"; serie: string; numero: number; competencia: string; // AAAA-MM-DD
  prest: Ente; toma: Ente; ibgePrest: string; ibgeToma?: string; cTribNac: string; cTribMun?: string; cNBS?: string;
  descricao: string; valor: number; aliqSimples?: number; dhEmi?: string;
}) {
  const cnpj = so(p.prest.documento);
  const id = `DPS${p.ibgePrest.padStart(7, "0")}2${cnpj.padStart(14, "0")}${p.serie.padStart(5, "0")}${String(p.numero).padStart(15, "0")}`;
  const reg = p.prest.regime ?? "simples";
  const op = reg === "mei" ? "2" : reg === "simples" ? "3" : "1";
  const im = so(p.prest.inscricao_municipal);
  const td = so(p.toma.documento), te = p.toma.endereco ?? {};
  const endToma = p.ibgeToma && so(te.cep).length === 8 && te.logradouro
    ? `<end><endNac><cMun>${p.ibgeToma}</cMun><CEP>${so(te.cep)}</CEP></endNac>${tag("xLgr", te.logradouro)}${tag("nro", te.numero || "S/N")}${tag("xBairro", te.bairro || "Centro")}</end>` : "";
  const totTrib = op === "3" ? `<pTotTribSN>${d2(p.aliqSimples ?? 0)}</pTotTribSN>`
    : `<pTotTrib><pTotTribFed>0.00</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>0.00</pTotTribMun></pTotTrib>`;
  const xml = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${id}">`
    + `<tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb><dhEmi>${p.dhEmi ?? agoraBR()}</dhEmi><verAplic>MVToy-App-1.0</verAplic>`
    + `<serie>${p.serie}</serie><nDPS>${p.numero}</nDPS><dCompet>${p.competencia}</dCompet><tpEmit>1</tpEmit><cLocEmi>${p.ibgePrest}</cLocEmi>`
    + `<prest><CNPJ>${cnpj}</CNPJ>${im ? `<IM>${im.padStart(15, "0")}</IM>` : ""}${tag("fone", so(p.prest.telefone))}${tag("email", p.prest.email_nf)}`
    + `<regTrib><opSimpNac>${op}</opSimpNac>${op === "3" ? "<regApTribSN>1</regApTribSN>" : ""}<regEspTrib>0</regEspTrib></regTrib></prest>`
    + `<toma>${td.length === 11 ? `<CPF>${td}</CPF>` : `<CNPJ>${td}</CNPJ>`}${tag("xNome", p.toma.razao_social || p.toma.nome)}${endToma}${tag("email", p.toma.email_nf)}</toma>`
    + `<serv><locPrest><cLocPrestacao>${p.ibgePrest}</cLocPrestacao></locPrest><cServ><cTribNac>${p.cTribNac}</cTribNac>${tag("cTribMun", p.cTribMun)}`
    + `${tag("xDescServ", p.descricao.slice(0, 2000))}${tag("cNBS", p.cNBS)}</cServ></serv>`
    + `<valores><vServPrest><vServ>${d2(p.valor)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>`
    + `<totTrib>${totTrib}</totTrib></trib></valores></infDPS></DPS>`;
  return { id, xml };
}

// ---------------- NF-e 4.00 ----------------
export function dvChave(c43: string) {
  let soma = 0, peso = 2;
  for (let i = c43.length - 1; i >= 0; i--) { soma += Number(c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; return r < 2 ? 0 : 11 - r;
}
export function chaveNfe(p: { cUF: string; dh: string; cnpj: string; serie: string; nNF: number; cNF: string; tpEmis?: number }) {
  const aamm = p.dh.slice(2, 4) + p.dh.slice(5, 7);
  const c43 = `${p.cUF}${aamm}${so(p.cnpj).padStart(14, "0")}55${p.serie.padStart(3, "0")}${String(p.nNF).padStart(9, "0")}${p.tpEmis ?? 1}${p.cNF}`;
  return c43 + dvChave(c43);
}
export type ItemNfe = { codigo?: string; nome: string; ncm: string; qtd: number; valor_unit: number; unidade?: string; cest?: string };
export function montarNfe(p: {
  ambiente: "homologacao" | "producao"; serie: string; numero: number; cNF?: string; dhEmi?: string; natOp: string; cfop: string;
  emit: Ente; dest: Ente; ibgeEmit: string; ibgeDest: string; itens: ItemNfe[]; refChave?: string; csosn?: string;
  semPagamento?: boolean; infCpl?: string; respTec: { cnpj: string; contato: string; email: string; fone: string };
}) {
  const hom = p.ambiente !== "producao";
  const dh = p.dhEmi ?? agoraBR();
  const cNF = p.cNF ?? String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const ee = p.emit.endereco ?? {}, de = p.dest.endereco ?? {};
  const chave = chaveNfe({ cUF: p.ibgeEmit.slice(0, 2), dh, cnpj: p.emit.documento, serie: p.serie, nNF: p.numero, cNF });
  const crt = p.emit.crt ?? (p.emit.regime === "mei" ? 4 : p.emit.regime === "simples" ? 1 : 3);
  const sn = crt === 1 || crt === 2 || crt === 4;
  const dd = so(p.dest.documento), ieDest = so(p.dest.inscricao_estadual);
  const idDest = (de.uf ?? "SP").toUpperCase() === (ee.uf ?? "SP").toUpperCase() ? 1 : 2;
  let vProd = 0;
  const det = p.itens.map((it, k) => {
    const vp = Math.round(it.qtd * it.valor_unit * 100) / 100; vProd += vp;
    const xProd = hom && k === 0 ? "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : it.nome;
    const icms = sn ? `<ICMSSN102><orig>0</orig><CSOSN>${p.csosn ?? "102"}</CSOSN></ICMSSN102>` : `<ICMS40><orig>0</orig><CST>41</CST></ICMS40>`;
    const pis = sn ? `<PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr>` : `<PISNT><CST>07</CST></PISNT>`;
    const cof = sn ? `<COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr>` : `<COFINSNT><CST>07</CST></COFINSNT>`;
    return `<det nItem="${k + 1}"><prod>${tag("cProd", it.codigo || `ITEM${k + 1}`)}<cEAN>SEM GTIN</cEAN>${tag("xProd", xProd.slice(0, 120))}`
      + `<NCM>${so(it.ncm).padStart(8, "0")}</NCM>${tag("CEST", so(it.cest))}<CFOP>${p.cfop}</CFOP>${tag("uCom", it.unidade || "UN")}<qCom>${it.qtd.toFixed(4)}</qCom>`
      + `<vUnCom>${it.valor_unit.toFixed(10)}</vUnCom><vProd>${vp.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib>${tag("uTrib", it.unidade || "UN")}`
      + `<qTrib>${it.qtd.toFixed(4)}</qTrib><vUnTrib>${it.valor_unit.toFixed(10)}</vUnTrib><indTot>1</indTot></prod>`
      + `<imposto><ICMS>${icms}</ICMS><PIS>${pis}</PIS><COFINS>${cof}</COFINS></imposto></det>`;
  }).join("");
  const vNF = vProd.toFixed(2);
  const z = "0.00";
  const end = (e: any, ibge: string, fone?: string) => `${tag("xLgr", e.logradouro)}${tag("nro", e.numero || "S/N")}${tag("xBairro", e.bairro || "Centro")}`
    + `<cMun>${ibge}</cMun>${tag("xMun", sem(e.cidade ?? ""))}${tag("UF", (e.uf ?? "SP").toUpperCase())}<CEP>${so(e.cep)}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>${tag("fone", so(fone))}`;
  const destNome = hom ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : (p.dest.razao_social || p.dest.nome);
  const pag = p.semPagamento ? `<detPag><tPag>90</tPag><vPag>0.00</vPag></detPag>` : `<detPag><indPag>0</indPag><tPag>99</tPag><xPag>A combinar</xPag><vPag>${vNF}</vPag></detPag>`;
  const inf = `<infNFe versao="4.00" Id="NFe${chave}">`
    + `<ide><cUF>${p.ibgeEmit.slice(0, 2)}</cUF><cNF>${cNF}</cNF>${tag("natOp", p.natOp.slice(0, 60))}<mod>55</mod><serie>${Number(p.serie)}</serie><nNF>${p.numero}</nNF>`
    + `<dhEmi>${dh}</dhEmi><dhSaiEnt>${dh}</dhSaiEnt><tpNF>1</tpNF><idDest>${idDest}</idDest><cMunFG>${p.ibgeEmit}</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis>`
    + `<cDV>${chave.slice(-1)}</cDV><tpAmb>${hom ? 2 : 1}</tpAmb><finNFe>1</finNFe><indFinal>${ieDest ? 0 : 1}</indFinal><indPres>9</indPres><indIntermed>0</indIntermed>`
    + `<procEmi>0</procEmi><verProc>MVToy-App-1.0</verProc>${p.refChave ? `<NFref><refNFe>${p.refChave}</refNFe></NFref>` : ""}</ide>`
    + `<emit><CNPJ>${so(p.emit.documento)}</CNPJ>${tag("xNome", p.emit.razao_social || p.emit.nome)}${tag("xFant", p.emit.nome)}<enderEmit>${end(ee, p.ibgeEmit, p.emit.telefone)}</enderEmit>`
    + `<IE>${so(p.emit.inscricao_estadual)}</IE><CRT>${crt}</CRT></emit>`
    + `<dest>${dd.length === 11 ? `<CPF>${dd}</CPF>` : `<CNPJ>${dd}</CNPJ>`}${tag("xNome", destNome)}<enderDest>${end(de, p.ibgeDest)}</enderDest>`
    + `<indIEDest>${ieDest ? 1 : 9}</indIEDest>${ieDest ? `<IE>${ieDest}</IE>` : ""}${tag("email", p.dest.email_nf)}</dest>`
    + det
    + `<total><ICMSTot><vBC>${z}</vBC><vICMS>${z}</vICMS><vICMSDeson>${z}</vICMSDeson><vFCP>${z}</vFCP><vBCST>${z}</vBCST><vST>${z}</vST><vFCPST>${z}</vFCPST><vFCPSTRet>${z}</vFCPSTRet>`
    + `<vProd>${vNF}</vProd><vFrete>${z}</vFrete><vSeg>${z}</vSeg><vDesc>${z}</vDesc><vII>${z}</vII><vIPI>${z}</vIPI><vIPIDevol>${z}</vIPIDevol><vPIS>${z}</vPIS><vCOFINS>${z}</vCOFINS><vOutro>${z}</vOutro><vNF>${vNF}</vNF></ICMSTot></total>`
    + `<transp><modFrete>9</modFrete></transp><pag>${pag}</pag>`
    + `<infAdic>${tag("infCpl", p.infCpl ?? (sn ? "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NAO GERA DIREITO A CREDITO FISCAL DE IPI." : ""))}</infAdic>`
    + `<infRespTec><CNPJ>${so(p.respTec.cnpj)}</CNPJ>${tag("xContato", p.respTec.contato)}${tag("email", p.respTec.email)}<fone>${so(p.respTec.fone)}</fone></infRespTec>`
    + `</infNFe>`;
  return { chave, xml: `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${inf}</NFe>`, vNF: Number(vNF) };
}
export function envelopeAutorizacao(nfeAssinada: string, idLote: string) {
  const corpo = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeAssinada.replace(/<\?xml[^>]*\?>/, "")}</enviNFe>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>`
    + `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}
export const pegar = (xml: string, t: string) => (xml.match(new RegExp(`<(?:\\w+:)?${t}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${t}>`)) ?? [])[1];
