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
const CORES = require('./cores-marca');
const TAGS = require('./nome-em-tags');

const RAIZ = 'C:\\Users\\lucas larado\\Desktop\\vlotimizeroficial';
const DIR_UI = path.join(RAIZ, 'src');

// O nome do produto e a cor são as duas coisas que mais aparecem nas telas.
//
// A cor não é trocada valor por valor: o tema tem ~20 tons de vermelho e trocar quatro
// deles deixava a tela quase toda vermelha. Aqui toda cor de destaque passa pela matiz
// da marca (ver cores-marca.js), o que preserva a hierarquia clara/escura do tema.
module.exports = function textosDaMarca(M) {
  const arquivos = fs.readdirSync(DIR_UI).filter((f) => /\.(html|css|js)$/.test(f));
  let mexidos = 0;
  const trocas = [];

  const matiz = Number(M.cores && M.cores.matiz);
  const temMatiz = Number.isFinite(matiz) && matiz >= 0 && matiz <= 360;

  for (const nome of arquivos) {
    const arq = path.join(DIR_UI, nome);
    let c = fs.readFileSync(arq, 'utf8');
    const original = c;

    // nome da marca
    c = c.replace(/VL Optimizer/g, M.nome);
    c = c.replace(/VL OPTIMIZER/g, String(M.nome).toUpperCase());
    c = c.replace(/VL Scaling/g, M.nome + ' Scaling');
    // nome quebrado dentro de tags (<b>VL</b><i>Optimizer</i> etc.)
    c = TAGS.trocarNomeEmTags(c, M.nome);

    // cor de destaque (matiz da marca)
    if (temMatiz) c = CORES.recolorir(c, matiz);

    if (c !== original) {
      fs.writeFileSync(arq, c, 'utf8');
      mexidos++;
      const n = (original.match(/VL Optimizer|VL OPTIMIZER|VL Scaling/g) || []).length;
      if (n) trocas.push(nome + ' (' + n + ')');
    }
  }
  console.log('  telas: ' + mexidos + ' arquivo(s)' + (trocas.length ? ' — ' + trocas.join(', ') : ''));
  if (temMatiz) console.log('  cor: matiz ' + matiz + '° aplicada ao tema');

  // As notas da versão também vão para a tela (cartão de atualização). Elas citam o nome
  // do produto, e no build de um revendedor o cliente veria o nome do outro.
  {
    const arqNotas = path.join(RAIZ, 'notas-versao.js');
    if (fs.existsSync(arqNotas)) {
      let n = fs.readFileSync(arqNotas, 'utf8');
      const antes = n;
      n = n.replace(/VL Optimizer/g, M.nome);
      if (n !== antes) {
        fs.writeFileSync(arqNotas, n, 'utf8');
        const q = (antes.match(/VL Optimizer/g) || []).length;
        console.log('  notas da versão: ' + q + ' menção(ões) trocada(s)');
      }
    }
  }
  return mexidos;
};
