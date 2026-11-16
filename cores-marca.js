// ══════════════════════════════════════════════════════════════════════════
// CORES DA MARCA
//
// A primeira versão só trocava cores em #hex. O tema do app usa MUITO rgb()/rgba()
// para brilho, sombra e borda, e essas continuavam vermelhas no ZONEX:
//
//   rgba(163,15,26,...)   rgba(224,16,31,...)   rgba(251,113,133,...)
//   rgba(255,31,46,...)   rgba(255,85,96,...)
//
// Era isso que ainda aparecia vermelho: os anéis do aro do contador, os brilhos,
// "Medir gargalo", as barras do hardware, a faixa de modo limitado.
//
// A marca do ZONEX tem três cores, medidas na logo que o dono mandou:
//   laranja  #ff7a00   matiz 28     (principal)
//   azul     #00a8ff   matiz 200    (apoio: o anel do aro, o brilho do logo)
//   branco                          (texto)
// sobre fundo preto.
//
// O QUE É TROCADO
//
//   1. #hex            -> matiz principal
//   2. rgb()/rgba()    -> matiz principal, preservando o alfa
//   3. hsl()/hsla()    -> matiz principal
//   4. nos elementos da marca (aro do contador, logo), a matiz de apoio
//
// O QUE NÃO É TROCADO
//
//   cinza, preto e branco (s < 0.30 ou l quase 0/1)
//   verde de sucesso, amarelo de aviso, vermelho de ERRO (são semânticos: um erro tem
//   de continuar vermelho em qualquer marca)
//   azul de link/hostname (o tema usa azul para endereço, não para a marca)
// ══════════════════════════════════════════════════════════════════════════

// HEX -> HSL
function hexParaHsl(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return rgbParaHsl(parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16));
}

// RGB (0-255) -> HSL
function rgbParaHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hh = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hh = ((b - r) / d + 2) / 6;
    else hh = ((r - g) / d + 4) / 6;
  }
  return { h: hh * 360, s, l };
}

// HSL -> {r,g,b} em 0-255
function hslParaRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = f(hn + 1 / 3); g = f(hn); b = f(hn - 1 / 3);
  }
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return { r: to(r), g: to(g), b: to(b) };
}

// HSL -> HEX
function hslParaHex(h, s, l) {
  const { r, g, b } = hslParaRgb(h, s, l);
  const to = (v) => v.toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

// É uma cor "de destaque" (o vermelho da marca)?
function ehDestaque(h, s, l) {
  if (s < 0.30) return false;              // cinza / neutro
  if (l < 0.06 || l > 0.96) return false;  // quase preto / quase branco
  const hh = ((h % 360) + 360) % 360;
  return hh < 24 || hh > 334;              // vermelho e rosa-vermelho
}

// Gira a matiz de uma cor de destaque para a da marca.
// Quanto mais longe de 0°, mais perto da marca fica (mantém a variação do tema).
function novaMatiz(h, matiz) {
  const hh = ((h % 360) + 360) % 360;
  const desvio = hh > 334 ? (360 - hh) * -1 : hh;
  return matiz + desvio * 0.55;
}

// Ajusta a luminosidade para o brilho da marca.
//
// A troca de matiz mantinha a luminosidade da cor de origem. Como o vermelho do VL é
// escuro (L≈0.42), o laranja do ZONEX saía apagado (#c85e10), longe do laranja vivo da
// logo (#fc8202, V≈0.99).
//
// Aqui a cor final fica 70% no brilho da marca e 30% no brilho de origem: o suficiente
// para o laranja ficar forte como na logo, sem perder a diferença entre "botão" (mais
// vivo) e "borda/sombra" (mais escuro). Cores muito claras continuam claras.
//
// @param {number} l        luminosidade original (0-1)
// @param {number} lMarca   luminosidade alvo da marca (0-1)
function ajustarBrilho(l, lMarca) {
  const alvo = 0.70 * lMarca + 0.30 * l;
  return Math.min(0.96, Math.max(0.08, alvo));
}

// Aplica UMA matiz em todas as formas de cor do texto.
function transformar(texto, matiz, lMarca) {
  let c = String(texto);
  const L = Number.isFinite(lMarca) ? lMarca : null;

  // 1) #hex (3, 6 ou 8 dígitos; 8 = #rrggbbaa)
  c = c.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, hex) => {
    const alpha = hex.length === 8 ? hex.slice(6) : '';
    const { h, s, l } = hexParaHsl(hex);
    if (!ehDestaque(h, s, l)) return m;
    const lf = L === null ? l : ajustarBrilho(l, L);
    return hslParaHex(novaMatiz(h, matiz), s, lf) + alpha;
  });

  // 2) rgb() / rgba()
  c = c.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*[0-9.]+%?\s*)?\)/g,
    (m, r, g, b, alfa) => {
      const { h, s, l } = rgbParaHsl(+r, +g, +b);
      if (!ehDestaque(h, s, l)) return m;
      const lf = L === null ? l : ajustarBrilho(l, L);
      const n = hslParaRgb(novaMatiz(h, matiz), s, lf);
      return 'rgba(' + n.r + ', ' + n.g + ', ' + n.b + (alfa || ', 1') + ')';
    });

  // 3) hsl() / hsla()
  c = c.replace(/hsla?\(\s*([0-9.]+)\s*(?:deg)?\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*(,\s*[0-9.]+%?\s*)?\)/g,
    (m, h, s, l, alfa) => {
      const sat = +s / 100, lig = +l / 100;
      if (!ehDestaque(+h, sat, lig)) return m;
      const lf = L === null ? lig : ajustarBrilho(lig, L);
      return 'hsla(' + Math.round(novaMatiz(+h, matiz)) + ', ' + Math.round(sat * 100) + '%, ' + Math.round(lf * 100) + '%' + (alfa || ', 1') + ')';
    });

  return c;
}

// Elementos em que a marca usa a segunda cor (o azul do ZONEX): o aro do contador e a
// logo. O resto da interface usa só a cor principal, como no app original.
const SELETORES_APOIO = ['.dh-dial', '.dh-ring', '.orb', '.sb-logo', '.marca-ic', '.tb-logo'];

function aplicarApoio(texto, matizApoio, lMarca) {
  // percorre cada bloco "seletor { corpo }" e troca as cores só dos seletores da marca
  return String(texto).replace(/([^{}]+)\{([^{}]*)\}/g, (m, seletores, corpo) => {
    const alvo = String(seletores).trim();
    if (!SELETORES_APOIO.some((s) => alvo.includes(s))) return m;
    return seletores + '{' + transformar(corpo, matizApoio, lMarca) + '}';
  });
}

/**
 * Troca as cores de destaque de um texto.
 * @param {string} texto
 * @param {number} matiz  matiz principal (0-360)
 * @param {object} [opcoes] { matizApoio } matiz da segunda cor
 */
function recolorir(texto, matiz, opcoes) {
  const lMarca = Number(opcoes && opcoes.luminosidade);
  let c = transformar(texto, matiz, Number.isFinite(lMarca) ? lMarca : null);
  if (opcoes && Number.isFinite(opcoes.matizApoio)) c = aplicarApoio(c, opcoes.matizApoio, Number.isFinite(lMarca) ? lMarca : null);
  return c;
}

module.exports = { recolorir, transformar, aplicarApoio, hexParaHsl, rgbParaHsl, hslParaRgb, hslParaHex, ehDestaque };
