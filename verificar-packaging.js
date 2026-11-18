// ══════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE PACKAGING
//
// Dois engenheiros acharam hoje o mesmo defeito: um require() apontando para um
// arquivo que não estava em "files" no electron-builder.json. O app sai do build
// sem o arquivo e morre no require na primeira execução.
//
//   engine-disco.js       -> quebrou a 1.4.33 (engine-extras carrega no topo)
//   assinatura-update.js  -> ia quebrar o próximo build
//
// Esta ferramenta:
//   1. lista TODO require('./x') do projeto
//   2. lista TODO readFileSync(path.join(__dirname, 'x'))
//   3. confere se cada um está coberto pelo "files" do electron-builder.json
//   4. falha (exit 1) se faltar algum
//
// Uso: node verificar-packaging.js
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const EB = JSON.parse(fs.readFileSync(path.join(RAIZ, 'electron-builder.json'), 'utf8'));
const files = EB.files || [];

// ── 1. Quais arquivos o asar vai ter? ──────────────────────────────────
// Traduz cada padrão de "files" para um teste.
function coberto(rel) {
  const r = rel.replace(/\\/g, '/');
  for (const p of files) {
    if (!p) continue;
    const pat = p.replace(/\\/g, '/');
    if (pat.startsWith('!')) continue;
    if (pat === r) return true;
    if (pat.endsWith('/**/*')) {
      const base = pat.slice(0, -5); // remove '/**/*'
      if (r === base || r.startsWith(base + '/')) return true;
    }
    if (pat.endsWith('/**')) {
      const base = pat.slice(0, -3);
      if (r === base || r.startsWith(base + '/')) return true;
    }
    if (pat.endsWith('/*')) {
      const base = pat.slice(0, -2);
      if (path.posix.dirname(r) === base) return true;
    }
  }
  return false;
}

// ── 2. Varre o projeto ─────────────────────────────────────────────────
const ignorarDir = new Set(['node_modules', '.git', 'release', 'dist', 'build', 'site', 'ferramentas', '.originais-vl', 'shots', 'backup']);
const jsRaiz = [];
function andar(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (ignorarDir.has(e.name)) continue;
      andar(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name);
    } else {
      jsRaiz.push(rel ? rel + '/' + e.name : e.name);
    }
  }
}
andar(RAIZ, '');

const problemas = [];
const ok = [];

for (const rel of jsRaiz) {
  if (!rel.endsWith('.js')) continue;

  // Só interessa o require de um arquivo que VAI para o pacote.
  // Ferramentas de build (textos-marca.js, native/scaler/build.js, gerar-build.js,
  // publicar.js...) não entram no asar: os requires delas nunca rodam no app do
  // cliente. Verificá-las gerava "FALTA NO BUILD" falso e impedia ligar esta
  // ferramenta no publicar.js — furo que o auditor s1 apontou.
  if (!coberto(rel)) continue;

  const full = path.join(RAIZ, rel);
  let src;
  try { src = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }

  // require('./x') e require('../x') — só os que resolvem dentro do projeto
  const reqs = [...src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    let alvo = path.posix.normalize(path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), r));
    if (!alvo.endsWith('.js') && !alvo.endsWith('.json')) alvo += '.js';
    if (alvo.startsWith('..')) continue;           // fora do projeto
    if (!fs.existsSync(path.join(RAIZ, alvo))) continue; // não existe mesmo (opcional)
    if (coberto(alvo)) ok.push(alvo);
    else problemas.push({ de: rel, arquivo: alvo, tipo: "require('./" + r + "')" });
  }

  // Só caminhos usados em LEITURA: os de escrita (writeFileSync, appendFileSync,
  // mkdirSync) são arquivos que o app CRIA em runtime e não precisam ir no pacote.
  //
  // Antes o regex pegava tudo e o verificador acusava "FALTA NO BUILD: smoke.png",
  // "uitest.log" e "site" — todos falsos, e por isso ele não podia ser ligado no
  // publicar.js.
  const RE_LEITURA = /(?:readFileSync|readFile|readdirSync|existsSync|createReadStream|statSync|openSync|loadFile|readJson|readFileAsync)\(\s*(?:path\.join\()?\s*__dirname\s*,\s*['"]([^'"]+)['"]/g;
  const dirnameRefs = [...src.matchAll(RE_LEITURA)].map((m) => m[1]);
  // Exceções: caminhos que só existem em MODOS DE DESENVOLVIMENTO, nunca no app
  // do cliente. Cada uma precisa do motivo escrito — sem isso, a exceção vira
  // desculpa e o verificador perde a utilidade.
  const EXCECOES = new Map([
    // "site": só usado no modo --siteshot (tirar print do site). O asar não tem a
    // pasta e o app do cliente nunca entra nesse ramo do código.
    ['site'],
  ]);
  for (const [k] of EXCECOES) {
    const i = dirnameRefs.indexOf(k);
    if (i >= 0) dirnameRefs.splice(i, 1);
  }
  // Também vale a forma em duas etapas: const p = path.join(__dirname, 'x') seguido
  // de um readFileSync(p). Nesse caso o arquivo é exigido (é o padrão do main.js
  // para os .ps1). Mantemos a captura antiga, mas só quando o caminho aparece perto
  // de uma leitura.
  for (const m of src.matchAll(/path\.join\(\s*__dirname\s*,\s*['"]([^'"]+)['"]/g)) {
    const alvo = m[1];
    if (dirnameRefs.includes(alvo)) continue;
    // procura a variável que recebeu esse caminho e vê se ela é lida
    const antes = src.slice(Math.max(0, m.index - 200), m.index);
    const varM = /(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(antes);
    if (varM) {
      const nome = varM[1];
      const depois = src.slice(m.index, m.index + 400);
      if (new RegExp('(?:readFileSync|readFile|readdirSync|existsSync|createReadStream|statSync|openSync|loadFile)\\(\\s*' + nome + '\\b').test(depois)) {
        dirnameRefs.push(alvo);
      }
    }
  }
  for (const r of dirnameRefs) {
    if (r.includes('..')) continue;
    const alvo = path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), r.replace(/\\/g, '/'));
    if (!fs.existsSync(path.join(RAIZ, alvo))) continue;
    if (coberto(alvo)) ok.push(alvo);
    else problemas.push({ de: rel, arquivo: alvo, tipo: "path.join(__dirname, '" + r + "')" });
  }
}

// ── 3. Relatório ───────────────────────────────────────────────────────
console.log('');
console.log('=== VERIFICADOR DE PACKAGING ===');
console.log('');
const uniqOk = [...new Set(ok)];
console.log('referencias verificadas e cobertas: ' + uniqOk.length);
uniqOk.sort().forEach((f) => console.log('  OK   ' + f));
console.log('');

if (problemas.length === 0) {
  console.log('NENHUM PROBLEMA. Todo require e todo __dirname tem o arquivo no build.');
  process.exit(0);
}

console.log('*** ' + problemas.length + ' PROBLEMA(S) ***');
console.log('');
const vistos = new Set();
for (const p of problemas) {
  const chave = p.arquivo;
  if (vistos.has(chave)) continue;
  vistos.add(chave);
  console.log('  FALTA NO BUILD: ' + p.arquivo);
  console.log('    referenciado por: ' + p.de);
  console.log('    como: ' + p.tipo);
  console.log('    CORRIGIR: adicionar "' + p.arquivo + '" no files[] do electron-builder.json');
  console.log('');
}
process.exit(1);
