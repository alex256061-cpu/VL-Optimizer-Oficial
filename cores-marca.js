// ══════════════════════════════════════════════════════════════════════════
// CORES DA MARCA — transformação por matiz (HSL)
//
// A versão do ZONEX continuava toda vermelha porque eu trocava só quatro valores
// exatos (#c8101f, #e01b2e, #ff2440, #8f0a16). O tema tem ~20 tons de vermelho:
//
//   #c8101f 4x   #e0101f 4x   #ff1f2e 4x   #ff5560 3x   #ff9aa2 5x
//   #ff6b74 2x   #fda4af 2x   #a30f1a 2x   #e81123 1x   #f1707a 1x  ...
//
// Trocar valor por valor nunca fecha. Aqui a troca é por MATIZ: toda cor cujo
// vermelho domina vira a cor da marca, mantendo saturação e brilho. Assim #a30f1a
// (vermelho escuro) vira um laranja escuro, #ff9aa2 (vermelho claro) vira laranja
// claro — a hierarquia do tema sobrevive.
//
// Cores da logo do ZONEX (medidas na imagem que o dono mandou):
//   matiz 12° a 33°, saturação 100%, brilho 0.8 a 1.0
//   cor média saturada: #d2721a
//   escolhi #ff7a00 (H=28°, S=100%, V=100%) — o laranja puro da marca
//   o azul ciano da logo fica como cor de apoio
// ══════════════════════════════════════════════════════════════════════════

// Converte HEX para HSL (h em 0-360, s e l em 0-1).
function hexParaHsl(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hh = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hh = ((b - r) / d + 2) / 6;
    else hh = ((r - g) / d + 4) / 6;
  }
  return { h: hh * 360, s, l };
}

// Converte HSL de volta para HEX.
function hslParaHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
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
    r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
  }
  const to = (v) => {
    const x = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return x.toString(16).padStart(2, '0');
  };
  return '#' + to(r) + to(g) + to(b);
}

// É uma cor "de destaque" (o vermelho do tema)?
// Vermelho/laranja/rosa: matiz perto de 0/360, com saturação de verdade.
// O tema usa vermelho de matiz 350° a 10°, e rosados até ~15°.
function ehDestaque(h, s, l) {
  if (s < 0.15) return false;          // cinza não é destaque
  if (l < 0.08 || l > 0.94) return false; // quase preto/branco fica
  const pertoDeZero = h < 22 || h > 338;
  return pertoDeZero;
}

/**
 * Troca as cores de destaque de um texto.
 * @param {string} texto   conteúdo do arquivo
 * @param {number} matiz   matiz da marca, em graus (0-360)
 * @param {number} [sat]   multiplicador de saturação (1 = igual)
 */
function recolorir(texto, matiz, sat) {
  const kSat = sat || 1;
  // Calcula o desvio da matiz de origem para a da marca e aplica o mesmo giro,
  // assim #ff9aa2 (rosa claro) vira laranja claro e #a30f1a (vinho) vira laranja escuro.
  return String(texto).replace(/#[0-9a-fA-F]{6}\b/g, (hex) => {
    const { h, s, l } = hexParaHsl(hex);
    if (!ehDestaque(h, s, l)) return hex;
    // quanto mais perto de 0°, mais perto da cor da marca
    let novaH;
    if (h > 338) novaH = matiz + (h - 360) * 0.55;   // 350..360: levemente antes
    else novaH = matiz + h * 0.55;                    // 0..22: levemente depois
    return hslParaHex(novaH, Math.min(1, s * kSat), l);
  });
}

module.exports = { recolorir, hexParaHsl, hslParaHex, ehDestaque };
