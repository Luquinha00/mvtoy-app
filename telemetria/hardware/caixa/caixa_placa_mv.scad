// Caixa da Placa MV (piloto, placa perfurada 5x7 cm) — impressão 3D · v1 · 20/11/2026
// Paramétrica: depois das fotos/medições é só ajustar as medidas abaixo e exportar de novo.
// Imprimir: PETG ou ABS (aguenta o calor dentro da máquina; PLA amolece perto de 55 °C), 0,2 mm, 3 perímetros, 20% de preenchimento.
// Peças: BASE (abre para cima) e TAMPA (imprimir de cabeça para baixo, com o rebaixo do QR virado para a mesa NÃO — QR para cima).

parte = "tudo";          // "base", "tampa" ou "tudo" (prévia)

// ---- placa dentro da caixa ----
placa_c = 70;  placa_l = 50;  placa_e = 1.6;   // placa perfurada 7x5 cm
furo_borda = 2.5;                               // furos de fixação da placa (centro a 2,5 mm da borda)
altura_pecas = 20;                              // mais alto acima da placa (ESP32 na barra fêmea ~14 mm, step-down ~14 mm) + folga
pino_alt = 4;                                   // espaçador sob a placa (fios por baixo)

// ---- caixa ----
parede = 2.2; fundo = 2; tampa_e = 2; folga = 2;
folga_c = 7;                                       // nas pontas: espaço das torres da tampa, dos fios e do USB
ic = placa_c + 2*folga_c;  il = placa_l + 2*folga;   // interno
ih = pino_alt + placa_e + altura_pecas;             // altura interna
ec = ic + 2*parede; el = il + 2*parede; eh = fundo + ih;
raio = 4;

// ---- aberturas (ajustar depois das fotos) ----
fio_l = 14; fio_a = 7;            // entrada dos fios da máquina (lado do borne, ponta esquerda)
fio_y = el/2;                     // centro da entrada no lado curto
usb_l = 13; usb_a = 8;            // acesso ao USB do ESP32 (ponta direita) [AJUSTAR posição do ESP32]
usb_y = el/2 + 8; usb_z = fundo + pino_alt + placa_e + 6;
led_x = ec - 30; led_y = el/2 + 12;   // janelinha do LED azul na tampa [AJUSTAR]
qr = 30;                          // etiqueta QR 30 x 30 mm (igual à da PAGBox)

module caixa_arredondada(c, l, a, r) {
  hull() for (x = [r, c-r]) for (y = [r, l-r]) translate([x, y, 0]) cylinder(r=r, h=a, $fn=40);
}

module base() {
  difference() {
    union() {
      caixa_arredondada(ec, el, eh, raio);
      // orelhas de fixação na máquina (parafuso ou abraçadeira)
      for (x = [ec*0.25, ec*0.75]) for (s = [0, 1])
        translate([x - 7, s ? el - 1 : -11, 0]) cube([14, 12, 3]);
    }
    // interior
    translate([parede, parede, fundo]) caixa_arredondada(ic, il, ih + 1, raio - 1.5);
    // furos oblongos das orelhas (parafuso 4 mm ou abraçadeira)
    for (x = [ec*0.25, ec*0.75]) for (s = [0, 1])
      translate([x, s ? el + 5 : -5, -1]) hull() for (dx = [-2.5, 2.5]) translate([dx, 0, 0]) cylinder(d=4.4, h=5, $fn=24);
    // entrada dos fios
    translate([-1, fio_y - fio_l/2, fundo + 1]) cube([parede + 2, fio_l, fio_a]);
    // USB
    translate([ec - parede - 1, usb_y - usb_l/2, usb_z]) cube([parede + 2, usb_l, usb_a]);
    // ventilação (lado do step-down)
    for (i = [0:4]) translate([16 + i*6, -1, fundo + ih*0.45]) cube([2.5, parede + 2, ih*0.35]);
    for (i = [0:4]) translate([16 + i*6, el - parede - 1, fundo + ih*0.45]) cube([2.5, parede + 2, ih*0.35]);
    // nome gravado na lateral
    translate([ec/2 + 8, el + 0.01, fundo + ih*0.25]) rotate([90, 0, 180]) linear_extrude(0.6) text("MV TOY", size=5, font="DejaVu Sans:style=Bold", halign="center");
  }
  // espaçadores da placa (parafuso M2 auto-atarraxante)
  for (x = [furo_borda, placa_c - furo_borda]) for (y = [furo_borda, placa_l - furo_borda])
    translate([parede + folga_c + x, parede + folga + y, fundo - 0.01]) difference() {
      cylinder(d=5.5, h=pino_alt, $fn=30); translate([0,0,1]) cylinder(d=1.8, h=pino_alt, $fn=20);
    }
  // torres dos parafusos da tampa (M3 auto-atarraxante) nos cantos
  for (x = [parede + 3.2, ec - parede - 3.2]) for (y = [parede + 3.2, el - parede - 3.2])
    translate([x, y, 0]) difference() { cylinder(d=6.4, h=eh, $fn=30); translate([0,0,fundo+2]) cylinder(d=2.6, h=eh, $fn=20); }
  // âncoras para abraçadeira dos fios (alívio de tensão) perto da entrada
  for (dy = [-fio_l/2 - 3, fio_l/2 + 3]) translate([parede + 1.5, fio_y + dy - 1.5, fundo]) difference() {
    cube([4, 3, 6]); translate([-1, -1, 2]) cube([6, 5, 2]);
  }
}

module tampa() {
  difference() {
    union() {
      caixa_arredondada(ec, el, tampa_e, raio);
      // aba de encaixe por dentro da caixa
      translate([parede + 0.3, parede + 0.3, -2]) difference() {
        caixa_arredondada(ic - 0.6, il - 0.6, 2, raio - 1.8);
        translate([1.6, 1.6, -1]) caixa_arredondada(ic - 3.8, il - 3.8, 4, raio - 2.5);
        // folga para as torres dos cantos
        for (x = [0, ic - 0.6]) for (y = [0, il - 0.6]) translate([x, y, -1]) cylinder(r=5, h=4, $fn=30);
      }
    }
    // furos dos parafusos da tampa (escareados)
    for (x = [parede + 3.2, ec - parede - 3.2]) for (y = [parede + 3.2, el - parede - 3.2])
      translate([x, y, -3]) { cylinder(d=3.4, h=10, $fn=20); translate([0,0,3+tampa_e-1.6]) cylinder(d1=3.4, d2=6.4, h=1.61, $fn=20); }
    // rebaixo da etiqueta QR (0,6 mm)
    translate([14, (el - qr)/2, tampa_e - 0.6]) cube([qr + 1, qr + 1, 1]);
    // janela do LED
    translate([led_x, led_y, -3]) cylinder(d=3.2, h=10, $fn=24);
    // marca e número
    translate([qr + 19, el/2 + 2, tampa_e - 0.6]) linear_extrude(1) text("PLACA MV", size=4.5, font="DejaVu Sans:style=Bold");
    translate([qr + 19, el/2 - 5, tampa_e - 0.6]) linear_extrude(1) text("Suporte", size=2.6, font="DejaVu Sans");
    translate([qr + 19, el/2 - 9.5, tampa_e - 0.6]) linear_extrude(1) text("(16) 99638-1102", size=2.6, font="DejaVu Sans");
  }
}

if (parte == "base") base();
else if (parte == "tampa") tampa();
else if (parte == "montada") { base(); translate([0, 0, eh]) tampa(); }
else { base(); translate([0, el + 20, 0]) tampa(); }
