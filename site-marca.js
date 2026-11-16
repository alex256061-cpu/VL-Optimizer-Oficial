// ══════════════════════════════════════════════════════════════════════════
// SITE DA MARCA
//
// O site (site/) tem a URL do Supabase, a chave pública e o endereço
// vl-optimizer.pages.dev escritos no código, além do nome em 15 arquivos.
//
// O gerar-build.js restaura site/ do backup e chama este módulo para aplicar a marca,
// igual ao que faz com src/.
//
// O que é trocado:
//   https://wsmropvlmnyegpvmyndn.supabase.co  -> o projeto do revendedor
//   sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o -> a chave dele
//   https://vl-optimizer.pages.dev            -> o site dele
//   VL Optimizer / VL OPTIMIZER               -> o nome dele
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const RAIZ = 'C:\\Users\\lucas larado\\Desktop\\vlotimizeroficial';
const DIR_SITE = path.join(RAIZ, 'site');

const SUPABASE_VL = 'https://wsmropvlmnyegpvmyndn.supabase.co';
const ANON_VL = 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o';
const SITE_VL = 'https://vl-optimizer.pages.dev';

module.exports = function siteDaMarca(M) {
  if (!fs.existsSync(DIR_SITE)) { console.log('  site: pasta nao encontrada'); return 0; }

  const arquivos = [];
  (function anda(dir) {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.statSync(p).isDirectory()) anda(p);
      else if (/\.(js|html|json)$/.test(n)) arquivos.push(p);
    }
  })(DIR_SITE);

  let mexidos = 0;
  for (const arq of arquivos) {
    let c = fs.readFileSync(arq, 'utf8');
    const original = c;

    // Supabase do revendedor
    c = c.split(SUPABASE_VL).join(M.supabase.url);
    c = c.split(ANON_VL).join(M.supabase.anon);

    // endereço do site
    c = c.split(SITE_VL).join(M.site);

    // nome
    c = c.replace(/VL Optimizer/g, M.nome);
    c = c.replace(/VL OPTIMIZER/g, String(M.nome).toUpperCase());

    if (c !== original) {
      fs.writeFileSync(arq, c, 'utf8');
      mexidos++;
    }
  }
  console.log('  site: ' + mexidos + ' de ' + arquivos.length + ' arquivo(s) atualizados');
  return mexidos;
};
