import cairosvg

W, H = 1800, 1150
o = []
a = o.append
a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="DejaVu Sans, Arial, sans-serif">')
a('<rect width="100%" height="100%" fill="#F3F1FB"/>')
a('<text x="40" y="62" font-size="36" font-weight="bold" fill="#372792">Telemetria MV Toy — placa de teste (piloto) · como fica montada</text>')
a('<text x="40" y="98" font-size="19" fill="#4A4570">Base para o montador · versão provisória (20/11/2026) — muda depois das fotos do conector e das medições da máquina</text>')

# ---------- placa perfurada ----------
PX, PY, PW, PH = 60, 140, 1040, 760
a(f'<rect x="{PX}" y="{PY}" width="{PW}" height="{PH}" rx="14" fill="#C9A86A" stroke="#8C6B33" stroke-width="3"/>')
for i in range(PX + 20, PX + PW - 10, 26):
    for j in range(PY + 20, PY + PH - 10, 26):
        a(f'<circle cx="{i}" cy="{j}" r="4.2" fill="#E8D3A2" stroke="#9C7B43" stroke-width="1"/>')
a(f'<text x="{PX+PW-14}" y="{PY+PH-14}" font-size="15" text-anchor="end" fill="#5A4420">placa perfurada ilhada 5×7 cm (desenho fora de escala)</text>')

def label(x, y, t, s=17, c="#211C5E", w="bold", anchor="middle"):
    a(f'<text x="{x}" y="{y}" font-size="{s}" font-weight="{w}" fill="{c}" text-anchor="{anchor}">{t}</text>')

def pin(x, y, t, side="below"):
    a(f'<circle cx="{x}" cy="{y}" r="7" fill="#D4AF37" stroke="#7A5C00" stroke-width="2"/>')
    if t:
        dy = 26 if side == "below" else -14
        label(x, y + dy, t, 14, "#FFFFFF" if side == "inside" else "#211C5E")

# ---------- borne (entrada da máquina) ----------
BX, BY = 110, 230
a(f'<rect x="{BX}" y="{BY}" width="90" height="250" rx="8" fill="#2E8B57" stroke="#14532D" stroke-width="3"/>')
borne = {}
for k, nome in enumerate(["12V", "GND", "SINAL", "livre"]):
    cy = BY + 35 + k * 60
    a(f'<rect x="{BX+18}" y="{cy-18}" width="54" height="36" rx="6" fill="#9FD9B4" stroke="#14532D"/>')
    a(f'<line x1="{BX+30}" y1="{cy}" x2="{BX+60}" y2="{cy}" stroke="#14532D" stroke-width="4"/>')
    label(BX - 12, cy + 6, nome, 17, "#211C5E", "bold", "end")
    borne[nome] = (BX + 90, cy)
label(BX + 45, BY + 280, "BORNE 4 vias", 16)
label(BX + 45, BY + 300, "(vem do chicote)", 14, "#4A4570", "normal")

# ---------- step-down ----------
SX, SY, SW, SH = 300, 180, 300, 150
a(f'<rect x="{SX}" y="{SY}" width="{SW}" height="{SH}" rx="8" fill="#1E5AA8" stroke="#0B2E5E" stroke-width="3"/>')
a(f'<rect x="{SX+80}" y="{SY+40}" width="70" height="60" rx="6" fill="#222"/>')
a(f'<circle cx="{SX+195}" cy="{SY+70}" r="18" fill="#2F6FD0" stroke="#0B2E5E" stroke-width="3"/>')
a(f'<rect x="{SX+192}" y="{SY+52}" width="6" height="36" fill="#FFD966"/>')
label(SX + SW/2, SY + 25, "STEP-DOWN LM2596", 16, "#FFFFFF")
label(SX + 195, SY + 112, "ajustar 5,0 V", 13, "#FFD966")
st = {"IN+": (SX + 20, SY + 125), "IN-": (SX + 20, SY + 60), "OUT+": (SX + SW - 20, SY + 125), "OUT-": (SX + SW - 20, SY + 60)}
for k, (x, y) in st.items():
    a(f'<circle cx="{x}" cy="{y}" r="8" fill="#D4AF37" stroke="#7A5C00" stroke-width="2"/>')
    label(x + (28 if k.startswith("IN") else -30), y + 5, k, 13, "#FFFFFF")

# ---------- ESP32 ----------
EX, EY, EW, EH = 640, 160, 400, 230
a(f'<rect x="{EX}" y="{EY}" width="{EW}" height="{EH}" rx="10" fill="#1F1F1F" stroke="#000" stroke-width="3"/>')
a(f'<rect x="{EX+120}" y="{EY+60}" width="170" height="110" rx="6" fill="#B8B8B8" stroke="#555"/>')
label(EX + 205, EY + 120, "ESP32", 24, "#222")
label(EX + 205, EY + 145, "WROOM-32", 14, "#333", "normal")
a(f'<rect x="{EX+EW-10}" y="{EY+95}" width="34" height="40" rx="4" fill="#9A9A9A"/>')
label(EX + EW + 60, EY + 120, "USB", 13, "#211C5E", "normal")
for i in range(15):
    xx = EX + 20 + i * 25
    a(f'<circle cx="{xx}" cy="{EY+18}" r="5" fill="#D4AF37"/>')
    a(f'<circle cx="{xx}" cy="{EY+EH-18}" r="5" fill="#D4AF37"/>')
esp = {"VIN": (EX + 20, EY + EH - 18), "GND": (EX + 70, EY + EH - 18), "D27": (EX + 195, EY + EH - 18), "D26": (EX + 245, EY + EH - 18), "3V3": (EX + 20, EY + 18)}
for k, (x, y) in esp.items():
    a(f'<circle cx="{x}" cy="{y}" r="8" fill="#FFC61C" stroke="#7A5C00" stroke-width="2"/>')
    label(x + (30 if k == "3V3" else 0), y + (22 if k == "3V3" else -16), k, 14, "#FFC61C")
label(EX + EW/2 + 40, EY + 48, "ESP32 DevKit (na barra fêmea)", 15, "#FFFFFF", "normal")
a(f'<circle cx="{EX+60}" cy="{EY+110}" r="9" fill="#3B82F6"/>')
label(EX + 60, EY + 140, "LED", 12, "#9BC1FF", "normal")

# ---------- BC547 (entrada) ----------
TX, TY = 420, 600
a(f'<path d="M {TX-40} {TY} A 40 40 0 0 1 {TX+40} {TY} Z" fill="#222" stroke="#000" stroke-width="2"/>')
label(TX, TY - 12, "BC547", 14, "#FFFFFF")
bc = {"C": (TX - 26, TY + 30), "B": (TX, TY + 30), "E": (TX + 26, TY + 30)}
for k, (x, y) in bc.items():
    a(f'<line x1="{x}" y1="{TY}" x2="{x}" y2="{y}" stroke="#999" stroke-width="4"/>')
    a(f'<circle cx="{x}" cy="{y}" r="7" fill="#D4AF37" stroke="#7A5C00" stroke-width="2"/>')
    label(x, y + 26, k, 15)


# ---------- BC337 (saída) ----------
OX, OY = 880, 640
a(f'<path d="M {OX-40} {OY} A 40 40 0 0 1 {OX+40} {OY} Z" fill="#222" stroke="#000" stroke-width="2"/>')
label(OX, OY - 12, "BC337", 14, "#FFFFFF")
pc = {"C": (OX - 26, OY + 30), "B": (OX, OY + 30), "E": (OX + 26, OY + 30)}
for k, (x, y) in pc.items():
    a(f'<line x1="{x}" y1="{OY}" x2="{x}" y2="{y}" stroke="#999" stroke-width="4"/>')
    a(f'<circle cx="{x}" cy="{y}" r="7" fill="#D4AF37" stroke="#7A5C00" stroke-width="2"/>')
    label(x, y + 26, k, 15)

# ---------- resistores ----------
def resistor(x, y, val, cores, vert=False):
    if vert:
        a(f'<line x1="{x}" y1="{y-45}" x2="{x}" y2="{y+45}" stroke="#999" stroke-width="3"/>')
        a(f'<rect x="{x-11}" y="{y-26}" width="22" height="52" rx="9" fill="#E9D7B0" stroke="#8C6B33"/>')
        for i, c in enumerate(cores):
            a(f'<rect x="{x-11}" y="{y-18+i*11}" width="22" height="5" fill="{c}"/>')
        label(x + 34, y + 5, val, 14, "#211C5E", "bold", "start")
        return (x, y - 45), (x, y + 45)
    a(f'<line x1="{x-45}" y1="{y}" x2="{x+45}" y2="{y}" stroke="#999" stroke-width="3"/>')
    a(f'<rect x="{x-26}" y="{y-11}" width="52" height="22" rx="9" fill="#E9D7B0" stroke="#8C6B33"/>')
    for i, c in enumerate(cores):
        a(f'<rect x="{x-18+i*11}" y="{y-11}" width="5" height="22" fill="{c}"/>')
    label(x, y - 18, val, 14)
    return (x - 45, y), (x + 45, y)

R47 = resistor(300, 520, "47k", ["#FFEB3B", "#7E22CE", "#F97316"])
R100 = resistor(330, 690, "100k", ["#8B4513", "#000", "#FFEB3B"], vert=True)
R10 = resistor(560, 530, "10k", ["#8B4513", "#000", "#F97316"], vert=True)
R330 = resistor(880, 500, "1k", ["#8B4513", "#000", "#E11D48"], vert=True)

def fio(pts, cor, larg=6):
    d = " ".join(f"{x},{y}" for x, y in pts)
    a(f'<polyline points="{d}" fill="none" stroke="{cor}" stroke-width="{larg}" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>')

VERM, PRETO, AMAR, AZUL, VERDE, LAR = "#E11D48", "#111111", "#EAB308", "#2563EB", "#16A34A", "#F97316"
# 12V → IN+
fio([borne["12V"], (250, 265), (250, 305), st["IN+"]], VERM)
# OUT+ (5V) → VIN
fio([st["OUT+"], (620, 305), (620, 400), (660, 400), esp["VIN"]], VERM)
# GND rail
gy = 840
fio([borne["GND"], (235, 325), (235, gy), (980, gy)], PRETO)
fio([st["IN-"], (282, 240), (282, 360), (235, 360)], PRETO, 5)
fio([st["OUT-"], (600, 240), (600, 425), (710, 425), esp["GND"]], PRETO, 5)
fio([bc["E"], (446, gy)], PRETO, 5)
fio([R100[1], (330, gy)], PRETO, 5)
fio([pc["E"], (906, gy)], PRETO, 5)
# SINAL
sy = 780
fio([borne["SINAL"], (220, 385), (220, sy), (854, sy), pc["C"]], AMAR)
fio([(255, sy), R47[0]], AMAR, 5)
# 47k → base ; 100k topo → base
fio([R47[1], (365, 520), (365, 615), (420, 615), bc["B"]], AZUL, 4)
fio([R100[0], (330, 640), (400, 640), (400, 630), bc["B"]], AZUL, 4)
# coletor → D27 ; 10k → coletor e 3V3
fio([bc["C"], (394, 660), (520, 660), (520, 445), (835, 445), esp["D27"]], AZUL)
fio([R10[1], (520, R10[1][1])], AZUL, 4)
fio([R10[0], (560, 140), (660, 140), esp["3V3"]], LAR, 5)
# D26 → 330 → PC817 pino 1
fio([esp["D26"], (885, 420), (880, 420), R330[0]], VERDE)
fio([R330[1], (880, 560), (950, 560), (950, 700), (880, 700), pc["B"]], VERDE, 5)

# ---------- legenda ----------
LX = 1140
a(f'<rect x="{LX}" y="140" width="620" height="760" rx="16" fill="#FFFFFF" stroke="#D9D4F5" stroke-width="2"/>')
label(LX + 30, 185, "Cores dos fios", 22, "#372792", "bold", "start")
leg = [(VERM, "12 V da máquina / 5 V para o ESP32"), (PRETO, "GND (terra) — tudo junto"), (AMAR, "SINAL do moedeiro (fio de crédito)"),
       (AZUL, "Entrada: SINAL → BC547 → D27 (lê a moeda)"), (VERDE, "Saída: D26 → 1k → BC337 → SINAL (solta crédito)"), (LAR, "3,3 V (pull-up do 10k)")]
for i, (c, t) in enumerate(leg):
    y = 225 + i * 38
    a(f'<line x1="{LX+30}" y1="{y}" x2="{LX+90}" y2="{y}" stroke="{c}" stroke-width="8" stroke-linecap="round"/>')
    label(LX + 105, y + 6, t, 17, "#211C5E", "normal", "start")
label(LX + 30, 480, "Como funciona", 22, "#372792", "bold", "start")
txt = ["1. A máquina alimenta tudo: 12 V → step-down → 5 V.",
       "2. Moeda: o moedeiro puxa o SINAL a 0 V → o transistor",
       "    avisa o ESP32 (D27) → o app conta a moeda.",
       "3. Pix/cartão: o servidor manda o crédito → o ESP32 (D26)",
       "    aciona o BC337 → o SINAL vai a 0 V = \"uma moeda\".",
       "4. Em paralelo no chicote: se a placa falhar,",
       "    a moeda continua funcionando.",
       "",
       "Atenção:",
       "• Ajustar o step-down em 5,0 V ANTES de ligar o ESP32.",
       "• Medir o SINAL parado (5 V ou 12 V) antes de instalar.",
       "• Resistores: 47k amarelo-violeta-laranja · 100k marrom-",
       "   preto-amarelo · 10k marrom-preto-laranja · 1k marrom-",
       "   preto-vermelho.",
       "• Simulado e aprovado: 5, 12 e 24 V."]
for i, t in enumerate(txt):
    label(LX + 30, 515 + i * 25, t, 16, "#211C5E", "bold" if t == "Atenção:" else "normal", "start")

# ---------- rodapé ----------
a(f'<rect x="60" y="930" width="1700" height="190" rx="16" fill="#4A37B5"/>')
label(90, 975, "Lista de peças da placa de teste (Mercado Livre)", 22, "#FFC61C", "bold", "start")
pecas = ["ESP32 DevKit WROOM-32 (30 pinos) — 1 + 1 reserva", "Step-down LM2596 — 1", "Transistor BC547 (entrada) — 1 + 1 reserva",
         "Transistor BC337 (saída) — 1 + 1 reserva", "Resistores 47k, 100k, 10k, 1k (kit sortido)", "Placa perfurada ilhada 5×7 cm — 1",
         "Barra fêmea 40 vias + diodo 1N5819 (proteção)", "Borne 4 vias + caixinha patola + fios", "Cabo USB de dados (gravar o programa)"]
for i, t in enumerate(pecas):
    col, lin = i // 3, i % 3
    label(90 + col * 560, 1015 + lin * 32, "• " + t, 17, "#FFFFFF", "normal", "start")
a('</svg>')

svg = "\n".join(o)
open("/home/claude/placa/placa_mv_teste.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="placa_teste_telemetria_mvtoy.png")
print("ok")
