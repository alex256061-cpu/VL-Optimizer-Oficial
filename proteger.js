// ══════════════════════════════════════════════════════════════════════════
// PROTETOR CONTRA AGENTES EM PARALELO
//
// Hoje dois engenheiros editaram o mesmo arquivo (engine-extras.js) ao mesmo
// tempo. O arquivo quebrou, um deles reverteu do backup e o trabalho do outro
// se perdeu. Foi a segunda vez no mesmo dia.
//
// Esta ferramenta tira um "retrato" (hash) dos arquivos do projeto. Antes de
// publicar ou depois de uma rodada de agentes, rode outra vez: qualquer arquivo
// cujo hash mudou sem autorização aparece no relatório.
//
// Uso:
//   node proteger.js marcar     tira o retrato
//   node proteger.js conferir   compara com o retrato
//   node proteger.js listar     mostra o retrato atual
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = __dirname;
const RETRATO = path.join('C:\\VLTemp', 'retrato-arquivos.json');

const IGNORAR = new Set(['node_modules', '.git', 'release', 'dist', 'build', 'shots', '.originais-vl']);

function varrer(dir, rel) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (e.isDirectory()) {
      if (IGNORAR.has(e.name)) continue;
      out.push(...varrer(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name));
    } else {
      out.push(rel ? rel + '/' + e.name : e.name);
    }
  }
  return out;
}

function hashDe(rel) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, rel))).digest('hex').slice(0, 16);
  } catch (e) { return null; }
}

function retrato() {
  const arqs = varrer(RAIZ, '').filter((f) => /\.(js|ps1|json|html|css)$/.test(f) && !f.startsWith('package-lock'));
  const mapa = {};
  for (const f of arqs) mapa[f] = hashDe(f);
  return mapa;
}

const acao = process.argv[2] || 'listar';

if (acao === 'marcar') {
  const m = retrato();
  fs.writeFileSync(RETRATO, JSON.stringify({ quando: new Date().toISOString(), arquivos: m }, null, 2), 'utf8');
  console.log('retrato salvo em ' + RETRATO);
  console.log('arquivos: ' + Object.keys(m).length);
  process.exit(0);
}

if (acao === 'listar') {
  const m = retrato();
  console.log('arquivos do projeto: ' + Object.keys(m).length);
  Object.keys(m).sort().forEach((f) => console.log('  ' + m[f] + '  ' + f));
  process.exit(0);
}

if (acao === 'conferir') {
  if (!fs.existsSync(RETRATO)) {
    console.log('Nao existe retrato. Rode: node proteger.js marcar');
    process.exit(1);
  }
  const antes = JSON.parse(fs.readFileSync(RETRATO, 'utf8')).arquivos || {};
  const agora = retrato();
  const mudou = [];
  const sumiu = [];
  const novo = [];
  for (const f of Object.keys(antes)) {
    if (!(f in agora)) sumiu.push(f);
    else if (antes[f] !== agora[f]) mudou.push(f);
  }
  for (const f of Object.keys(agora)) {
    if (!(f in antes)) novo.push(f);
  }

  console.log('');
  console.log('=== CONFERENCIA ===');
  if (!mudou.length && !sumiu.length && !novo.length) {
    console.log('nada mudou desde o retrato.');
    process.exit(0);
  }
  if (mudou.length) {
    console.log('');
    console.log('MUDARAM (' + mudou.length + '):');
    mudou.sort().forEach((f) => console.log('  ' + f));
  }
  if (sumiu.length) {
    console.log('');
    console.log('SUMIRAM (' + sumiu.length + '):');
    sumiu.sort().forEach((f) => console.log('  ' + f));
  }
  if (novo.length) {
    console.log('');
    console.log('NOVOS (' + novo.length + '):');
    novo.sort().forEach((f) => console.log('  ' + f));
  }
  console.log('');
  process.exit(1);
}

console.log('uso: node proteger.js marcar | conferir | listar');
