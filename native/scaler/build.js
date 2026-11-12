// build.js — compila os shaders FSR 1.0 (HLSL -> CSO) e injeta no app.
// Usa fxc.exe do Windows SDK. Se não achar, tenta dxc.exe.
// Rode na máquina de build: `node native/scaler/build.js`
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'shaders');
const TARGET = ['cs_5_0'];
const ENTRIES = [
  { file: 'fsr1_easu.hlsl', entry: 'Fsr1EasuCS', out: 'fsr1_easu.cso' },
  { file: 'fsr1_rcas.hlsl', entry: 'Fsr1RcasCS', out: 'fsr1_rcas.cso' },
];

function findCompiler() {
  // fxc.exe do Windows SDK (10.x), mais recente primeiro
  const roots = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const vers = fs.readdirSync(root)
      .filter((v) => /^10\./.test(v))
      .sort()
      .reverse();
    for (const v of vers) {
      for (const arch of ['x64', 'x86']) {
        const p = path.join(root, v, arch, 'fxc.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  // fallback: caminho no PATH
  try {
    execSync('fxc /?', { stdio: 'ignore' });
    return 'fxc';
  } catch (e) {}
  return null;
}

function main() {
  const fxc = findCompiler();
  if (!fxc) {
    console.error('fxc.exe não encontrado. Instale o Windows SDK (Debugging Tools / HLSL Compiler).');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  let ok = 0;
  for (const e of ENTRIES) {
    const src = path.join(SRC, e.file);
    const dst = path.join(OUT, e.out);
    const cmd = [
      '/nologo',
      '/T', TARGET[0],
      '/E', e.entry,
      '/I', SRC,
      '/Fo', dst,
      src,
    ];
    try {
      execFileSync(fxc, cmd, { stdio: 'pipe' });
      const size = fs.statSync(dst).size;
      console.log(`OK  ${e.out}  ${size} bytes`);
      ok++;
    } catch (err) {
      console.error(`ERR ${e.out}`);
      console.error(String(err.stdout || err.message));
      process.exitCode = 1;
    }
  }
  console.log(`\n${ok}/${ENTRIES.length} shaders compilados em ${OUT}`);
}

main();
