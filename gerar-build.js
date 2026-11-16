// ══════════════════════════════════════════════════════════════════════════
// GERAR BUILD DE UMA MARCA
//
// Uso:
//   node gerar-build.js             -> usa a marca ativa (marca/ATIVA.txt)
//   node gerar-build.js vl          -> volta o projeto ao estado original da VL
//   node gerar-build.js zonex       -> prepara um build com a marca do ZONEX
//
// COMO FUNCIONA
//
// Cada build de revendedor precisa mexer em coisas que ficam no próprio código:
// nome do produto, título das janelas, cores do tema, logo, endereço de atualização.
// Se isso fosse feito direto, o projeto ficaria alterado e o próximo build da VL sairia
// com o nome do outro cliente.
//
// Por isso o fluxo é sempre: RESTAURAR os originais (.originais-vl) e depois APLICAR a
// marca pedida. Assim todo build parte do mesmo ponto, não importa o que rodou antes.
//
// O que este script faz:
//   1. restaura .originais-vl em src/, assets/, package.json, electron-builder.json
//   2. lê marca/marca-<nome>.json (ou marca-vl.json)
//   3. escreve package.json e electron-builder.json com o nome, appId, instalador e
//      endereço de atualização da marca
//   4. copia as imagens da marca (ícone, logo) para os lugares que o app usa
//   5. reescreve os textos das telas (título da janela, "Sobre", cores)
//   6. grava marca/usada.json — o ÚNICO arquivo de marca que entra no pacote
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const RAIZ = __dirname;
const BK = path.join(RAIZ, '.originais-vl');

const marca = require('./marca');
// O nome vem SEMPRE do argumento. O `require('./marca')` acima já resolve a marca do
// momento (pelo ATIVA.txt) e usa essa para montar o módulo — por isso peço explicitamente
// o nome pedido aqui, e não `marca.qual()`.
//
// Sem argumento: a marca ativa. Com argumento: aquela marca (inclusive "vl").
const nome = process.argv[2]
  ? String(process.argv[2]).toLowerCase().replace(/[^a-z0-9_-]/g, '')
  : marca.qual();
if (!nome || nome === 'usada') {
  console.error('ERRO: nao consegui descobrir a marca ("' + nome + '").');
  console.error('Use: node gerar-build.js vl   ou   node gerar-build.js <nome-da-marca>');
  process.exit(1);
}
const M = marca.carregar(nome === 'vl' ? 'vl' : nome);

console.log('');
console.log('marca: ' + M.marca + '  (' + M.nome + ')');
console.log('');

// ── 1. restaurar os originais ──────────────────────────────────────────
if (!fs.existsSync(BK)) {
  console.error('ERRO: falta a pasta .originais-vl (backup do projeto original).');
  console.error('Sem ela eu não consigo voltar ao estado da VL antes de aplicar outra marca.');
  process.exit(1);
}

const copiarDir = (de, para) => {
  fs.mkdirSync(para, { recursive: true });
  for (const nome2 of fs.readdirSync(de)) {
    const a = path.join(de, nome2);
    const b = path.join(para, nome2);
    if (fs.statSync(a).isDirectory()) copiarDir(a, b);
    else fs.copyFileSync(a, b);
  }
};

copiarDir(path.join(BK, 'src'), path.join(RAIZ, 'src'));
if (fs.existsSync(path.join(BK, 'site'))) {
  copiarDir(path.join(BK, 'site'), path.join(RAIZ, 'site'));
}
for (const f of ['icon.png', 'icon.ico', 'logo.png', 'logo-branco.png']) {
  const de = path.join(BK, f);
  if (fs.existsSync(de)) fs.copyFileSync(de, path.join(RAIZ, 'assets', f));
}
for (const f of ['package.json', 'electron-builder.json', 'notas-versao.js']) {
  fs.copyFileSync(path.join(BK, f), path.join(RAIZ, f));
}
console.log('  originais restaurados (.originais-vl)');

// ── 2. package.json ────────────────────────────────────────────────────
{
  const arq = path.join(RAIZ, 'package.json');
  const j = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, ''));
  j.name = String(M.nomeCurto).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  j.productName = M.nome;
  j.description = M.nome + ' — suíte de otimização de PC para jogos';
  fs.writeFileSync(arq, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log('  package.json: name=' + j.name + '  productName=' + j.productName);
}

// ── 3. electron-builder.json ───────────────────────────────────────────
{
  const arq = path.join(RAIZ, 'electron-builder.json');
  const j = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, ''));
  j.appId = M.appId;
  j.productName = M.nome;
  // O artifactName existe em DOIS lugares e o de `win` vence o de cima. Trocar só o de
  // cima fazia o instalador sair como "Instalar-VL-Optimizer" no build do ZONEX.
  const nominal = M.modelo + '-${version}.${ext}';
  j.artifactName = nominal;
  if (j.win && typeof j.win === 'object') j.win.artifactName = nominal;
  if (j.nsis && typeof j.nsis === 'object') {
    j.nsis.shortcutName = M.nome;
    j.nsis.uninstallDisplayName = M.nome;
  }
  if (Array.isArray(j.publish)) j.publish = [{ provider: 'generic', url: M.urlAtualizacoes }];
  // o leitor da marca precisa estar no pacote
  if (Array.isArray(j.files)) {
    for (const precisa of ['marca.js', 'marca/usada.json']) {
      if (!j.files.includes(precisa)) j.files.push(precisa);
    }
    // e as marcas dos OUTROS revendedores não podem ir
    j.files = j.files.filter((f) => f !== 'marca/**/*');
  }
  fs.writeFileSync(arq, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log('  electron-builder.json: appId=' + j.appId);
  console.log('    instalador: ' + nominal);
  console.log('    atualização: ' + M.urlAtualizacoes);
}

// ── 4. imagens ─────────────────────────────────────────────────────────
{
  const pasta = M.assets ? path.join(RAIZ, M.assets) : null;
  if (pasta && fs.existsSync(pasta)) {
    const pares = [
      ['icon.png', ['assets/icon.png']],
      ['icon.ico', ['assets/icon.ico']],
      ['logo.png', ['assets/logo.png']],
      ['logo-branco.png', ['assets/logo-branco.png']],
      ['src-logo.png', ['src/logo.png']],
    ];
    let n = 0;
    for (const [origem, destinos] of pares) {
      const de = path.join(pasta, origem);
      if (!fs.existsSync(de)) continue;   // marca sem esse arquivo: mantém o da VL
      for (const d of destinos) fs.copyFileSync(de, path.join(RAIZ, d));
      n++;
    }
    console.log('  imagens: ' + n + ' arquivo(s) de ' + M.assets);
  } else {
    console.log('  imagens: mantidas as da VL');
  }
}

// ── 5. textos das telas ────────────────────────────────────────────────
if (M.marca !== 'vl') {
  require('./textos-marca')(M);
} else {
  console.log('  telas: já estão com os textos da VL');
}

// ── 5b. site ───────────────────────────────────────────────────────────
if (M.marca !== 'vl') {
  require('./site-marca')(M);
} else {
  console.log('  site: já está com os dados da VL');
}

// ── 6. a marca do pacote ───────────────────────────────────────────────
{
  const dir = path.join(RAIZ, 'marca');
  fs.mkdirSync(dir, { recursive: true });
  const dados = {
    nome: M.nome,
    nomeCurto: M.nomeCurto,
    appId: M.appId,
    pasta: M.pasta,
    modelo: M.modelo,
    supabase: M.supabase,
    site: M.site,
    github: M.github,
    assets: M.assets,
    cores: M.cores,
  };
  fs.writeFileSync(path.join(dir, 'usada.json'), JSON.stringify(dados, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'ATIVA.txt'), M.marca + '\n', 'utf8');
  console.log('  marca/usada.json: ' + M.nome + ' (só esta entra no pacote)');
}

console.log('');
console.log('pronto. marque "' + M.marca + '" aplicada ao build.');
