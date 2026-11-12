// build-exe.js — compila o motor nativo (engine_main.cpp) com o MSVC do Windows SDK
// Uso: node native/scaler/build-exe.js
// Gera: native/scaler/fsr1_engine.exe
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'engine_main.cpp');
const OUT = path.join(ROOT, 'fsr1_engine.exe');

function vsPaths() {
  const found = [];
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (fs.existsSync(vswhere)) {
    try {
      const out = execFileSync(vswhere, ['-all', '-products', '*', '-format', 'json'], { encoding: 'utf8' });
      for (const inst of JSON.parse(out)) {
        if (inst.installationPath && fs.existsSync(inst.installationPath)) found.push(inst.installationPath);
      }
    } catch (e) {}
  }
  for (const p of [
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program', // instalação truncada nesta máquina
  ]) if (fs.existsSync(p) && !found.includes(p)) found.push(p);
  return found;
}

function dirs(root) {
  try { return fs.readdirSync(root); } catch (e) { return []; }
}

function findToolset() {
  for (const vs of vsPaths()) {
    const msvcRoot = path.join(vs, 'VC', 'Tools', 'MSVC');
    const versions = dirs(msvcRoot).filter((v) => /^\d+\./.test(v)).sort().reverse();
    for (const v of versions) {
      const tool = path.join(msvcRoot, v);
      const bin = path.join(tool, 'bin', 'Hostx64', 'x64');
      const cl = path.join(bin, 'cl.exe');
      if (!fs.existsSync(cl)) continue;

      for (const sdk of ['C:\\Program Files (x86)\\Windows Kits\\10', 'C:\\Program Files\\Windows Kits\\10']) {
        if (!fs.existsSync(sdk)) continue;
        const sdkVers = dirs(path.join(sdk, 'Include'))
          .filter((x) => /^10\./.test(x) && fs.existsSync(path.join(sdk, 'Include', x, 'um', 'windows.h')))
          .sort().reverse();
        if (!sdkVers.length) continue;
        return { vs, tool, cl, bin, sdk, sdkVer: sdkVers[0] };
      }
    }
  }
  return null;
}

function envFor(t) {
  const sdkInc = path.join(t.sdk, 'Include', t.sdkVer);
  const sdkLib = path.join(t.sdk, 'Lib', t.sdkVer);
  const inc = [
    path.join(t.tool, 'include'),
    path.join(sdkInc, 'ucrt'),
    path.join(sdkInc, 'shared'),
    path.join(sdkInc, 'um'),
    path.join(sdkInc, 'winrt'),
    path.join(sdkInc, 'cppwinrt'),
  ];
  const lib = [
    path.join(t.tool, 'lib', 'x64'),
    path.join(sdkLib, 'ucrt', 'x64'),
    path.join(sdkLib, 'um', 'x64'),
  ];
  const env = { ...process.env };
  env.INCLUDE = inc.join(';');
  env.LIB = lib.join(';');
  env.Path = t.bin + ';' + (env.Path || env.PATH || '');
  return env;
}

function main() {
  const t = findToolset();
  if (!t) {
    console.error('MSVC não encontrado. Instale os Build Tools do VS 2022 com "Desenvolvimento de desktop com C++".');
    process.exit(1);
  }
  console.log('MSVC:', t.tool);
  console.log('SDK :', t.sdkVer);

  const args = [
    '/nologo', '/EHsc', '/std:c++17', '/O2', '/MT', '/W3', '/permissive-',
    '/DUNICODE', '/D_UNICODE',
    '/Fo' + path.join(ROOT, 'engine_main.obj'),
    '/Fe' + OUT,
    SRC,
    '/link', '/SUBSYSTEM:CONSOLE',
  ];

  console.log('compilando...');
  try {
    execFileSync(t.cl, args, { stdio: 'inherit', cwd: ROOT, env: envFor(t) });
  } catch (e) {
    console.error('falha na compilação');
    process.exit(1);
  }
  if (!fs.existsSync(OUT)) { console.error('binário não gerado'); process.exit(1); }
  console.log('OK', OUT, fs.statSync(OUT).size, 'bytes');
}

main();
