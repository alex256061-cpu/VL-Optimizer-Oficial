const fs = require('fs');
const path = require('path');
const os = require('os');

const sandbox = path.join(os.tmpdir(), 'opti-sandbox');
fs.rmSync(sandbox, { recursive: true, force: true });
fs.mkdirSync(sandbox, { recursive: true });
fs.writeFileSync(path.join(sandbox, 'game.exe'), 'dummy');
fs.writeFileSync(path.join(sandbox, 'dxgi.dll'), 'ORIGINAL-DXGI');

process.env.LOPT_DATA_DIR = path.join(os.tmpdir(), 'lopt-opti-data');
const ex = require('C:/Users/lucas larado/Desktop/deeepvl/l-optimizer/engine-extras.js');

(async () => {
  const exe = path.join(sandbox, 'game.exe');
  console.log('analyze antes:', JSON.stringify(await ex.optiAnalyze({ exe })).slice(0, 300));
  let t = Date.now();
  const dl = await ex.optiDownload();
  console.log('download:', JSON.stringify(dl), (Date.now() - t) + 'ms');
  if (!dl.success) process.exit(1);
  t = Date.now();
  const inst = await ex.optiInstall({ exe, dll: 'dxgi.dll', opts: { upscaler: 'fsr31', fg: true, spoof: false } });
  console.log('install:', JSON.stringify(inst), (Date.now() - t) + 'ms');
  console.log('arquivos:', fs.readdirSync(sandbox).slice(0, 20).join(', '));
  console.log('dxgi tamanho:', fs.statSync(path.join(sandbox, 'dxgi.dll')).size, '| backup:', fs.existsSync(path.join(sandbox, 'dxgi.dll.lopt-backup')), fs.readFileSync(path.join(sandbox, 'dxgi.dll.lopt-backup'), 'utf8'));
  const ini = fs.readFileSync(path.join(sandbox, 'OptiScaler.ini'), 'utf8');
  console.log('ini Dx12Upscaler:', /^Dx12Upscaler=.*$/m.exec(ini)[0], '| Enabled:', /^Enabled=.*$/m.exec(ini)[0], '| Dxgi:', /^Dxgi=.*$/m.exec(ini)[0]);
  const st = await ex.optiStatus();
  console.log('status installs:', (st.installs || []).length);
  const un = await ex.optiUninstall({ dir: sandbox });
  console.log('uninstall:', JSON.stringify(un));
  console.log('restou:', fs.readdirSync(sandbox).join(', ') || '(vazio)');
  console.log('dxgi restaurado:', fs.readFileSync(path.join(sandbox, 'dxgi.dll'), 'utf8'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
