// ══════════════════════════════════════════════════════════════════════════
// TEXTO DA MARCA NAS TELAS
//
// O título da janela e os textos de "Sobre" vêm do HTML (src/*.html), não do main.js.
// No build do ZONEX a janela abriu com "VL Optimizer — Entrar": o nome do outro produto.
//
// Aqui o gerar-build.js reescreve as telas com o nome da marca. É substituição direta,
// feita só durante o build, e revertida quando volta para a marca "vl".
//
// O que é trocado:
//   VL Optimizer      -> o nome da marca ("ZONEX")
//   VL Scaling        -> "<marca> Scaling"  (a janela de escala)
//   #c8101f           -> a cor principal da marca (o vermelho do VL fica laranja no ZONEX)
//   #e01b2e / #ff2440 -> variações da cor principal encontradas no tema
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const RAIZ = 'C:\\Users\\lucas larado\\Desktop\\vlotimizeroficial';
const DIR_UI = path.join(RAIZ, 'src');

// Cores do tema que acompanham a cor principal. Ficam aqui para o dia em que outro
// revendedor quiser roxo ou azul sem mexer no CSS.
const CORES_VL = {
  principal: '#c8101f',
  claro: '#e01b2e',
  vivo: '#ff2440',
  escuro: '#8f0a16',
};

module.exports = function textosDaMarca(M) {
  const arquivos = fs.readdirSync(DIR_UI).filter((f) => /\.(html|css|js)$/.test(f));
  let mexidos = 0;
  const trocas = [];
  const cor = String(M.cores && M.cores.principal || CORES_VL.principal).toLowerCase();
  const trocaCor = cor !== CORES_VL.principal;

  for (const nome of arquivos) {
    const arq = path.join(DIR_UI, nome);
    let c = fs.readFileSync(arq, 'utf8');
    const original = c;

    // nome da marca
    c = c.replace(/VL Optimizer/g, M.nome);
    c = c.replace(/VL OPTIMIZER/g, String(M.nome).toUpperCase());
    c = c.replace(/VL Scaling/g, M.nome + ' Scaling');

    // cor principal
    if (trocaCor) {
      c = c.replace(new RegExp(CORES_VL.principal, 'gi'), cor);
      c = c.replace(new RegExp(CORES_VL.claro, 'gi'), cor);
      c = c.replace(new RegExp(CORES_VL.vivo, 'gi'), cor);
      c = c.replace(new RegExp(CORES_VL.escuro, 'gi'), cor);
    }

    if (c !== original) {
      fs.writeFileSync(arq, c, 'utf8');
      mexidos++;
      const n = (original.match(/VL Optimizer|VL OPTIMIZER|VL Scaling/g) || []).length;
      if (n) trocas.push(nome + ' (' + n + ')');
    }
  }
  console.log('  telas: ' + mexidos + ' arquivo(s)' + (trocas.length ? ' — ' + trocas.join(', ') : ''));
  return mexidos;
};
