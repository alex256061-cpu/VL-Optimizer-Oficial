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

  // readFileSync(path.join(__dirname, 'x'))  e  path.join(__dirname, 'x')
  const dirnameRefs = [...src.matchAll(/path\.join\(\s*__dirname\s*,\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
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
