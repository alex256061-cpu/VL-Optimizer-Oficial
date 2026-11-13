// engine-extras.js — limpeza, disco, programas, jogos, PC, FPS, gargalo, OptiScaler, scaling
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const core = require('./engine');

const ex = {};

const APP_DATA = () => process.env.LOPT_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'VL Optimizer', 'data');
const fileIn = (name) => path.join(APP_DATA(), name);
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(fileIn(file), 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, v) { try { fs.mkdirSync(APP_DATA(), { recursive: true }); fs.writeFileSync(fileIn(file), JSON.stringify(v, null, 1), 'utf8'); } catch (e) {} }

// ────────────────────────────── INICIALIZAÇÃO ──────────────────────────────
const RUN_KEYS = [
  { scope: 'user-run', root: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' },
  { scope: 'machine-run', root: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' },
  { scope: 'machine-run32', root: 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run' },
];
const FOLDERS = [
  { scope: 'user-folder', dir: path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') },
  { scope: 'machine-folder', dir: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup' },
];

// Startup no formato do Windows: Run/Run32 + pastas de inicialização, e o estado real
// fica em Explorer\StartupApproved (é o que o Gerenciador de Tarefas lê e escreve).
const STORE_BY_SCOPE = {
  'user-run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'machine-run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'machine-run32': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  'user-folder': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  'machine-folder': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
};

const IMPACT_HIGH = /onedrive|dropbox|google ?drive|icloud|steam|discord|teams|adobe|creative|spotify|epic|battle\.net|blizzard|origin|ea ?app|ubisoft|razer|logitech|msi|afterburner|corsair|wallpaper|runtime broker|securityhealth/i;
const IMPACT_LOW = /^(ctfmon|igfxtray|igfxhk|igfxpers|rundll32|systray|weather|news|widgets|realtek.*(tray|audio))/i;

function impactOf(name, cmd) {
  const n = String(name || '') + ' ' + String(cmd || '');
  if (IMPACT_LOW.test(String(name || ''))) return 'baixo';
  if (IMPACT_HIGH.test(n)) return 'alto';
  return 'medio';
}

// Lê o estado de inicialização de cada app no StartupApproved do Windows.
//
// Devolve um mapa { nome: true|false }. É o mesmo lugar que o Gerenciador de Tarefas
// consulta: cada item tem um valor binário; primeiro byte 2 = habilitado, 3 = desabilitado.
async function approvedStates() {
  const out = {};
  for (const k of RUN_KEYS) {
    const store = STORE_BY_SCOPE[k.scope];
    if (!store) continue;
    try {
      const r = await core.ps(
        '$o = @{}' +
        'try { $p = Get-ItemProperty -LiteralPath ' + JSON.stringify(store) + ' -ErrorAction Stop } catch { Write-Output (Json $o); return }' +
        'foreach ($n in $p.PSObject.Properties.Name) {' +
        '  if ($n -match \'^(PSPath|PSParentPath|PSChildName|PSDrive|PSProvider)$\') { continue }' +
        '  $b = $p.$n' +
        '  if ($b -is [byte[]] -and $b.Length -ge 1) { $o[$n] = ($b[0] -eq 2) } else { $o[$n] = $true }' +
        '}' +
        'Write-Output (Json $o)', 20000);
      let j = {};
      try { j = JSON.parse(r.out) || {}; } catch (e) { j = {}; }
      for (const nome of Object.keys(j)) {
        if (out[nome] === undefined) out[nome] = j[nome] !== false;
      }
    } catch (e) { }
  }
  return out;
}

// ────────────────────────────── LIMPEZA ──────────────────────────────
const CATS = [
  { id: 'temp', group: 'win', name: 'Temporários do Windows', desc: 'Arquivos temporários com mais de 1 dia em %TEMP% e Windows\\Temp.', on: true, age: 1,
    paths: [os.tmpdir(), 'C:\\Windows\\Temp'] },
  { id: 'recycle', group: 'win', name: 'Lixeira', desc: 'Esvazia a Lixeira de todos os discos. Não dá para recuperar depois.', on: false, special: 'recycle' },
  { id: 'crash', group: 'win', name: 'Relatórios e despejos de memória', desc: 'Arquivos de erro e minidumps que o Windows guarda.', on: true, age: 0,
    paths: ['C:\\Windows\\Minidump', 'C:\\Windows\\LiveKernelReports', path.join(os.homedir(), 'AppData', 'Local', 'CrashDumps')] },
  { id: 'chrome', group: 'web', name: 'Google Chrome', desc: 'Só o cache. Logins, senhas, histórico e favoritos ficam.', on: true, age: 0, app: 'o Chrome',
    paths: [path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'GPUCache')], procs: ['chrome'] },
  { id: 'edge', group: 'web', name: 'Microsoft Edge', desc: 'Só o cache. Logins, senhas, histórico e favoritos ficam.', on: true, age: 0, app: 'o Edge',
    paths: [path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
            path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache')], procs: ['msedge'] },
  { id: 'opera', group: 'web', name: 'Opera', desc: 'Só o cache. Logins, senhas, histórico e favoritos ficam.', on: true, age: 0, app: 'o Opera',
    paths: [path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera Stable', 'Cache'),
            path.join(os.homedir(), 'AppData', 'Local', 'Opera Software', 'Opera Stable', 'Cache')], procs: ['opera'] },
  { id: 'brave', group: 'web', name: 'Brave', desc: 'Só o cache. Logins, senhas, histórico e favoritos ficam.', on: true, age: 0, app: 'o Brave',
    paths: [path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache')], procs: ['brave'] },
  { id: 'discord', group: 'apps', name: 'Discord', desc: 'Cache, logs e dumps do Discord.', on: true, age: 0, app: 'o Discord',
    paths: [path.join(os.homedir(), 'AppData', 'Roaming', 'discord', 'Cache'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'discord', 'Code Cache'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'discord', 'logs')], procs: ['discord', 'discordptb', 'discordcanary'] },
  { id: 'steam', group: 'apps', name: 'Steam', desc: 'Cache de navegador, logs e dumps da Steam. Jogos ficam.', on: true, age: 0, app: 'a Steam', procs: ['steam'],
    steam: true },
  { id: 'epic', group: 'apps', name: 'Epic Games', desc: 'Logs do launcher da Epic.', on: true, age: 0, app: 'a Epic', procs: ['EpicGamesLauncher'],
    paths: [path.join(os.homedir(), 'AppData', 'Local', 'EpicGamesLauncher', 'Saved', 'Logs')] },
  { id: 'drivers', group: 'win', name: 'Instaladores de driver', desc: 'Pastas C:\\NVIDIA, C:\\AMD, C:\\Intel e o downloader da NVIDIA com instaladores antigos (mais de 7 dias).', on: false, age: 7,
    paths: ['C:\\NVIDIA', 'C:\\AMD', 'C:\\Intel', 'C:\\ProgramData\\NVIDIA Corporation\\Downloader'] },
  { id: 'shaders', group: 'apps', name: 'Cache de shaders', desc: 'NVIDIA, AMD e DirectX. Resolve travadas depois de atualizar o driver.', on: false, age: 0, special: 'shaders',
    paths: [path.join(os.homedir(), 'AppData', 'Local', 'NVIDIA', 'DXCache'),
            path.join(os.homedir(), 'AppData', 'Local', 'NVIDIA', 'GLCache'),
            path.join(os.homedir(), 'AppData', 'Local', 'AMD', 'DxCache'),
            path.join(os.homedir(), 'AppData', 'Local', 'AMD', 'DxcCache'),
            path.join(os.homedir(), 'AppData', 'Local', 'D3DSCache')] },
];

const yieldNow = () => new Promise((r) => setImmediate(r));
async function dirSizes(dirs, ageDays, budgetMs) {
  let bytes = 0, files = 0;
  const started = Date.now();
  const budget = budgetMs || 5000;
  const cutoff = ageDays ? Date.now() - ageDays * 86400000 : 0;
  const fsp = fs.promises;

  // Versao assincrona: readdir/stat via fs.promises devolvem o controle ao loop de eventos entre
  // cada operacao, entao a janela continua respondendo enquanto a varredura acontece.
  const walk = async (dir, depth) => {
    if (depth > 14) return;
    if (Date.now() - started > budget) return;
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (Date.now() - started > budget) return;
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (e.isFile()) {
          const st = await fsp.stat(p);
          if (!cutoff || st.mtimeMs < cutoff) { bytes += st.size; files++; }
        }
      } catch (e) {}
    }
  };
  for (const d of dirs) {
    if (Date.now() - started > budget) break;
    await walk(d, 0);
  }
  return { bytes, files };
}

function steamPaths() {
  const out = [];
  const roots = [];
  const r = core.getSteamPath();
  if (r) roots.push(path.join(r, 'appcache'), path.join(r, 'logs'), path.join(r, 'dumps'), path.join(r, 'htmlcache'));
  return roots.filter(Boolean);
}

let steamRoot = null;
ex.initSteam = async () => {
  const r = await core.ps(`$p = Get-Val 'HKCU:\\Software\\Valve\\Steam' 'SteamPath'; Write-Output ([string]$p)`);
  steamRoot = r.ok ? r.out.split('\n')[0].trim() : null;
  return steamRoot;
};

let procList = { at: 0, set: new Set() };
async function runningNames() {
  if (Date.now() - procList.at < 5000) return procList.set;
  const r = await core.ps(`$n = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique); Write-Output (Json $n)`, 15000);
  const set = new Set();
  try {
    const j = JSON.parse(r.out);
    for (const n of (Array.isArray(j) ? j : [j])) set.add(String(n).toLowerCase());
  } catch (e) {}
  procList = { at: Date.now(), set };
  return set;
}
async function anyRunning(names) {
  const set = await runningNames();
  return (names || []).some((n) => set.has(String(n).toLowerCase()));
}

// ── Medição da limpeza: segundo plano, sem corte de tempo, com progresso ──
const cleanM = { at: 0, measuring: false, index: 0, total: 0, sizes: {} };

function cleanDirsOf(c) {
  if (c.steam) return steamRoot ? [path.join(steamRoot, 'appcache', 'httpcache'), path.join(steamRoot, 'logs'), path.join(steamRoot, 'dumps'), path.join(steamRoot, 'htmlcache')] : [];
  return c.paths || [];
}

// Tamanho real da Lixeira.
//
// Antes usava Shell.Application: Items() devolve so os 164 itens de topo e o Size de
// uma PASTA vale 0 — as pastas (a maior parte do lixo) contavam zero. Medido: 710 MB
// exibidos com 3.074 MB reais, erro de 76,9%.
//
// O tamanho real fica no indice da Lixeira ($I<$R>): cada item tem um registro e o
// tamanho em bytes esta no deslocamento 8 como Int64.
async function recycleBytes() {
  const r = await core.ps([
    '$total = 0',
    '$drives = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)',
    'foreach ($d in $drives) {',
    '  $i = Join-Path ($d.Root) ' + "'$Recycle.Bin'",
    '  if (-not (Test-Path -LiteralPath $i)) { continue }',
    '  try {',
    '    foreach ($sid in @(Get-ChildItem -LiteralPath $i -Directory -Force -ErrorAction SilentlyContinue)) {',
    '      $idx = Join-Path $sid.FullName ' + "'$I'",
    '      if (-not (Test-Path -LiteralPath $idx)) { continue }',
    '      $attrs = [System.IO.File]::GetAttributes($idx)',
    '      if (-not ($attrs -band [System.IO.FileAttributes]::Hidden)) { }',
    '      $bytes = [System.IO.File]::ReadAllBytes($idx)',
    '      $pos = 0',
    '      while ($pos + 24 -le $bytes.Length) {',
    '        $ver = [BitConverter]::ToInt64($bytes, $pos)',
    '        $tam = [BitConverter]::ToInt64($bytes, $pos + 8)',
    '        if ($tam -lt 0) { break }',
    '        $total += $tam',
    '        $pos += 24',
    '        # pula o nome (UTF-16, terminador duplo) e alinha em 8',
    '        while ($pos + 1 -lt $bytes.Length -and -not ($bytes[$pos] -eq 0 -and $bytes[$pos + 1] -eq 0)) { $pos += 2 }',
    '        $pos += 2',
    '        while ($pos % 8 -ne 0) { $pos += 1 }',
    '      }',
    '    }',
    '  } catch { }',
    '}',
    'Write-Output ([int64]$total)',
  ].join(String.fromCharCode(10)), 30000);

  const viaIndice = parseInt(String(r.out || '0').trim(), 10) || 0;
  if (viaIndice > 0) return viaIndice;

  // fallback: o COM antigo (subestima, mas melhor que zero)
  const r2 = await core.ps(
    '$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); if ($bin) { foreach ($i in $bin.Items()) { $s += $i.Size } } } catch {}; Write-Output ([int64]$s)',
    30000);
  return parseInt(r2.out, 10) || 0;
}

async function cleanCats() {
  const out = [];
  for (const c of CATS) {
    const m = cleanM.sizes[c.id];
    out.push({
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      open: c.procs ? await anyRunning(c.procs) : false,
      app: c.app, special: c.special, note: c.note,
    });
  }
  return out;
}

let cleanJob = null;
async function measureClean(force) {
  if (cleanJob) return cleanJob;
  if (!force && cleanM.at && Date.now() - cleanM.at < 120000) return null;
  cleanJob = (async () => {
    cleanM.measuring = true;
    cleanM.index = 0;
    cleanM.total = CATS.length;
    if (force) cleanM.sizes = {};
    // categorias em paralelo: o tempo total vira o da pasta mais lenta, não a soma
    await Promise.all(CATS.map(async (c) => {
      const t0 = Date.now();
      try {
        if (c.special === 'recycle') {
          const bytes = await recycleBytes();
          cleanM.sizes[c.id] = { bytes, files: bytes ? 1 : 0 };
        } else {
          // orçamento alto (30 s) só como trava de segurança; não corta o caso normal
          const r = await dirSizes(cleanDirsOf(c), c.age || 0, 30000);
          cleanM.sizes[c.id] = { bytes: r.bytes, files: r.files };
        }
      } catch (e) {
        cleanM.sizes[c.id] = { bytes: 0, files: 0 };
      }
      cleanM.index++;
      void t0;
    }));
    cleanM.measuring = false;
    cleanM.at = Date.now();
    cleanJob = null;
  })();
  return cleanJob;
}


ex.cleanScan = async () => {
  // mede de verdade (sem corte); a página mostra "Procurando…" enquanto isso
  if (cleanJob) await cleanJob;
  else await measureClean(false);
  return { success: true, cats: await cleanCats(), measuring: cleanM.measuring, index: cleanM.index, total: cleanM.total };
};

ex.cleanStatus = async () => ({
  success: true,
  cats: await cleanCats(),
  measuring: cleanM.measuring,
  index: cleanM.index,
  total: cleanM.total,
  measuredAt: cleanM.at,
});

let tempCache = { at: 0, bytes: 0 };
ex.cleanTempSize = async () => {
  if (Date.now() - tempCache.at < 30000) return tempCache.bytes;
  const r = await dirSizes([os.tmpdir(), 'C:\\Windows\\Temp'], 1, 4000);
  tempCache = { at: Date.now(), bytes: r.bytes };
  return r.bytes;
};

ex.cleanRun = async (ids) => {
  if (!steamRoot) await ex.initSteam();
  const results = [];
  let freed = 0;
  for (const id of ids) {
    const c = CATS.find((x) => x.id === id);
    if (!c) continue;
    const before = (cleanM.sizes[id] && cleanM.sizes[id].bytes) || (c.special === 'recycle' ? await recycleBytes() : (await dirSizes(cleanDirsOf(c), c.age || 0, 900000)).bytes);
    let open = false;
    if (c.special === 'recycle') {
      const r = await core.ps(`try { Clear-RecycleBin -Force -ErrorAction Stop } catch {}; Write-Output 'ok'`);
      open = !r.ok;
    } else if (c.special === 'shaders') {
      for (const d of c.paths) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
    } else {
      if (c.procs && await anyRunning(c.procs)) { open = true; results.push({ id, freed: 0, failed: 0, open: true }); continue; }
      const dirs = c.steam && steamRoot ? [path.join(steamRoot, 'appcache', 'httpcache'), path.join(steamRoot, 'logs'), path.join(steamRoot, 'dumps'), path.join(steamRoot, 'htmlcache')] : c.paths;
      let failed = 0;
      for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        // apaga o conteúdo, preserva a pasta (aplicativos recriam)
        let ents = [];
        try { ents = fs.readdirSync(d); } catch (e) { continue; }
        for (const e of ents) {
          const p = path.join(d, e);
          try {
            const st = fs.lstatSync(p);
            if (c.age && st.isFile() && st.mtimeMs >= Date.now() - c.age * 86400000) continue;
            fs.rmSync(p, { recursive: true, force: true });
          } catch (err) { failed++; }
        }
      }
      results.push({ id, freed: Math.max(0, before - (c.age ? (await dirSizes(c.paths, c.age)).bytes : 0)), failed, open });
      freed += Math.max(0, before);
      continue;
    }
    const after = c.special === 'recycle'
      ? parseInt((await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); foreach ($i in $bin.Items()) { $s += $i.Size } } catch {}; Write-Output ([int64]$s)`)).out, 10) || 0
      : (await dirSizes(c.paths || [], c.age || 0)).bytes;
    const f = Math.max(0, before - after);
    freed += f;
    results.push({ id, freed: f, failed: 0, open });
  }
  for (const id of ids) delete cleanM.sizes[id];
  cleanM.at = 0;
  measureClean(true);
  return { success: true, freed, results };
};

// ────────────────────────────── DISCO ──────────────────────────────
const disk = { state: 'idle', drive: null, files: 0, bytes: 0, result: null, cancel: false };

ex.diskDrives = async () => {
  const r = await core.ps(`
    $o = @()
    foreach ($d in Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3') {
      $v = Get-Volume -DriveLetter $d.DeviceID[0] -ErrorAction SilentlyContinue
      $o += @{ name = ($d.DeviceID + '\\'); label = [string]$v.FileSystemLabel; total = [int64]$d.Size; free = [int64]$d.FreeSpace }
    }
    Write-Output (Json $o)`);
  let drives = [];
  try { drives = JSON.parse(r.out || '[]'); } catch (e) {}
  if (!Array.isArray(drives)) drives = [drives];
  return { success: true, drives, system: (process.env.SystemDrive || 'C:') + '\\' };
};

ex.diskStart = async (drive) => {
  if (disk.state === 'running') return { success: false, error: 'já rodando' };
  disk.state = 'running'; disk.drive = drive; disk.files = 0; disk.bytes = 0; disk.cancel = false; disk.result = null;
  const nodes = [[0, -1, 0, 0, 0, drive]];
  const index = new Map();
  const big = [];
  const rootPath = drive;
  let id = 0;
  const walk = async (dir, parent, depth) => {
    if (disk.cancel) return;
    if (depth > 12) return;
    const myId = ++id;
    let bytes = 0, files = 0;
    nodes.push([myId, parent, 0, 0, 0, path.basename(dir) || dir]);
    index.set(myId, nodes[nodes.length - 1]);
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { nodes[index.get(myId)].push(0); return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          const before = nodes.length;
          await walk(p, myId, depth + 1);
          for (let k = before; k < nodes.length; k++) { if (nodes[k][1] === myId) bytes += nodes[k][2]; }
        } else if (e.isFile()) {
          const st = fs.statSync(p);
          bytes += st.size; files++;
          if (st.size > 5 * 1024 * 1024) big.push([st.size, p]);
        }
      } catch (err) {}
      if (++disk.files % 500 === 0) await yieldNow();
    }
    const n = index.get(myId);
    n[2] = bytes; n[3] = files;
  };
  (async () => {
    await walk(rootPath, 0, 0);
    big.sort((a, b) => b[0] - a[0]);
    let free = 0, total = 0;
    try {
      const d = await ex.diskDrives();
      const dr = (d.drives || []).find((x) => x.name.replace(/\\$/, '') === rootPath.replace(/\\$/, ''));
      if (dr) { free = dr.free; total = dr.total; }
    } catch (e) {}
    const scanned = nodes.reduce((s, n) => s + (n[1] === -1 ? 0 : 0), 0);
    const rootBytes = nodes[0][2];
    let scannedBytes = 0;
    for (const n of nodes) if (n[1] === 0) scannedBytes += n[2];
    disk.result = {
      drive: rootPath, nodes, big: big.slice(0, 80).map(([b, p]) => [b, p]),
      scanned: scannedBytes + nodes[0][4], total, free, at: Date.now(), files: disk.files,
    };
    disk.state = 'done';
    disk.nodes = nodes.length;
  })();
  return { success: true };
};

ex.diskStatus = () => ({
  success: true, state: disk.state, drive: disk.drive, files: disk.files, bytes: disk.bytes,
  result: disk.state === 'done' ? disk.result : null,
});
ex.diskCancel = () => { disk.cancel = true; disk.state = 'idle'; return { success: true }; };
ex.diskOpen = (target) => {
  if (!target || /[\r\n\0]/.test(target)) return { success: false, error: 'caminho inválido' };
  try { require('electron').shell.showItemInFolder(target); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
};

// ────────────────────────────── PROGRAMAS ──────────────────────────────
let appsCache = null;
ex.appsList = async (force) => {
  if (appsCache && !force) return { success: true, apps: appsCache };
  const r = await core.ps(`
    $src = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
    $o = @()
    foreach ($k in @(Get-ItemProperty $src -ErrorAction SilentlyContinue)) {
      if (-not $k.DisplayName) { continue }
      if ($k.SystemComponent -eq 1 -or $k.ParentKeyName) { continue }
      $o += @{ name=[string]$k.DisplayName; pub=[string]$k.Publisher; ver=[string]$k.DisplayVersion; date=[string]$k.InstallDate; un=[string]$k.UninstallString; loc=[string]$k.InstallLocation; key=[string]$k.PSChildName; icon=[string]$k.DisplayIcon; noRemove=($k.NoRemove -eq 1 -or -not $k.UninstallString) }
    }
    Write-Output (Json $o)`, 120000);
  let list = [];
  try { list = JSON.parse(r.out); } catch (e) {}
  if (!Array.isArray(list)) list = list ? [list] : [];
  appsCache = list.filter((a) => a && a.name).map((a, i) => ({ key: a.key || ('app' + i), name: a.name, pub: a.pub || '', ver: a.ver || '', date: (a.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), un: a.un || '', loc: a.loc || '', icon: a.icon || '', noRemove: !!a.noRemove, bytes: 0 }));
  return { success: true, apps: appsCache };
};

const qq = (s) => String(s == null ? '' : s).replace(/'/g, "''");
ex.appsExtra = async () => {
  const sizes = {}, icons = {};
  try { appsCache = appsCache || (await ex.appsList()).apps; } catch (e) {}
  for (const a of appsCache || []) {
    if (a.loc && fs.existsSync(a.loc)) {
      try {
        let total = 0;
        const walk = async (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { if (x.isSymbolicLink()) continue; const p = path.join(d, x.name); if (x.isDirectory()) await walk(p, depth + 1); else if (x.isFile()) { try { total += fs.statSync(p).size; } catch (e) {} } await yieldNow(); } };
        await walk(a.loc, 0);
        sizes[a.key] = total;
      } catch (e) {}
    }
  }
  // ícone real de cada programa (o mesmo do Explorador)
  const items = [];
  for (const a of appsCache || []) {
    let p = String(a.icon || '').trim().replace(/^"|"$/g, '');
    p = p.replace(/,\s*-?\d+\s*$/, '').trim();
    if (!p && a.loc) {
      try { const exes = fs.readdirSync(a.loc).filter((f) => /\.exe$/i.test(f)); if (exes.length) p = path.join(a.loc, exes[0]); } catch (e) {}
    }
    if (p && fs.existsSync(p) && /\.(exe|ico)$/i.test(p)) items.push({ k: a.key, p });
  }
  if (items.length) {
    const arr = items.slice(0, 120).map((i) => `@{k='${qq(i.k)}';p='${qq(i.p)}'}`).join(',');
    const r = await core.ps(`
      Add-Type -AssemblyName System.Drawing
      $items = @(${arr})
      $o = @{}
      foreach ($i in $items) {
        try {
          $ico = [System.Drawing.Icon]::ExtractAssociatedIcon([string]$i.p)
          if (-not $ico) { continue }
          $bmp = $ico.ToBitmap()
          $ms = New-Object System.IO.MemoryStream
          $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          $o[[string]$i.k] = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
          $bmp.Dispose(); $ms.Dispose()
        } catch {}
      }
      Write-Output (Json $o)`, 120000);
    if (r.ok && r.out) { try { Object.assign(icons, JSON.parse(r.out)); } catch (e) {} }
  }
  return { success: true, sizes, icons };
};

ex.appsExists = async (key) => {
  appsCache = appsCache || [];
  const a = appsCache.find((x) => x.key === key);
  if (!a) return { exists: false };
  const r = await core.ps(`$k = @(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${key}','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${key}','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${key}' -ErrorAction SilentlyContinue); Write-Output $k.Count`);
  return { exists: (parseInt(r.out, 10) || 0) > 0 };
};

ex.appsUninstall = async ({ key }) => {
  const a = (appsCache || []).find((x) => x.key === key);
  if (!a) return { success: false, error: 'programa não encontrado' };
  if (!a.un) return { success: false, broken: true, error: 'sem desinstalador' };
  let file = a.un, args = '';
  const m = /^"([^"]+)"\s*(.*)$/.exec(a.un);
  if (m) { file = m[1]; args = m[2]; } else { const sp = a.un.indexOf(' '); if (sp > 0) { file = a.un.slice(0, sp); args = a.un.slice(sp + 1); } }
  try {
    const child = spawn(file, args ? [args] : [], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    child.unref();
    return { success: true };
  } catch (e) {
    const r = await core.ps(`Start-Process -FilePath '${String(file).replace(/'/g, "''")}' -ArgumentList '${String(args).replace(/'/g, "''")}' -ErrorAction SilentlyContinue; Write-Output 'ok'`);
    return r.ok ? { success: true } : { success: false, broken: true, error: r.err || 'não foi possível abrir' };
  }
};

ex.appsLeftovers = async ({ key }) => {
  const a = (appsCache || []).find((x) => x.key === key) || {};
  const exists = (await ex.appsExists(key)).exists;
  if (exists) return { success: true, stillInstalled: true, items: [] };
  const items = [];
  const dirs = [];
  if (a.loc) dirs.push(a.loc);
  const nm = String(a.name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  for (const base of [path.join(os.homedir(), 'AppData', 'Roaming'), path.join(os.homedir(), 'AppData', 'Local'), 'C:\\ProgramData', 'C:\\Program Files', 'C:\\Program Files (x86)']) {
    const p = path.join(base, nm);
    if (fs.existsSync(p)) dirs.push(p);
  }
  for (const d of [...new Set(dirs)]) {
    const { bytes } = await dirSizes([d], 0);
    items.push({ id: 'dir:' + d, kind: 'dir', label: 'Pasta', path: d, bytes });
  }
  // chaves de registro que sobraram com o nome do programa
  const nome = String(a.name || '').trim();
  if (nome.length >= 3) {
    const r = await core.ps(`
      $nm = '${qq(nome)}'
      $o = @()
      foreach ($root in @('HKLM:\\SOFTWARE','HKLM:\\SOFTWARE\\WOW6432Node','HKCU:\\SOFTWARE')) {
        foreach ($k in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
          $n = $k.PSChildName
          if ($n -match '^(Microsoft|Windows|Classes|Policies|WOW6432Node|RegisteredApplications|Clients|Intel|AMD|NVIDIA)$') { continue }
          if ($n.Length -lt 3) { continue }
            # Igualdade do nome (sem diferenca de caixa) ou sufixo reconhecido de sobra.
            # Antes era substring nos dois sentidos: "Steam" casava com qualquer chave que
            # tivesse "steam" no meio e "Git" casava com o GitHub Desktop.
            $igual = ($n -ieq $nm)
            $sobra = ($n -imatch ("^" + [regex]::Escape($nm) + "(_data|\.old|-bak|_backup|temp|cache)$"))
            if ($igual -or $sobra) { $o += @{ path=$k.Name; name=$n } }
        }
      }
      Write-Output (Json $o)`, 120000);
    if (r.ok && r.out) {
      try {
        const regs = JSON.parse(r.out);
        const list = Array.isArray(regs) ? regs : (regs ? [regs] : []);
        for (const x of list) {
          items.push({ id: 'reg:' + x.path, kind: 'reg', label: 'Chave do registro', path: x.path, bytes: 0 });
        }
      } catch (e) {}
    }
  }
  return { success: true, stillInstalled: false, items };
};

ex.appsRemoveLeftovers = async ({ key, ids }) => {
  let trashed = 0, regs = 0, bytes = 0;
  const failed = [];
  const bakDir = path.join(APP_DATA(), 'desinstalacoes');
  try { fs.mkdirSync(bakDir, { recursive: true }); } catch (e) {}
  const regPaths = [];
  for (const id of ids) {
    const raw = String(id);
    if (raw.startsWith('dir:')) {
      const p = raw.slice(4);
      if (!fs.existsSync(p)) continue;
      const { bytes: b } = await dirSizes([p], 0);
      const r = await core.ps(`Add-Type -AssemblyName Microsoft.VisualBasic; try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${qq(p)}','OnlyErrorDialogs','SendToRecycleBin'); Write-Output 'ok' } catch { Write-Output 'err' }`, 120000);
      if (r.out.trim() === 'ok') { bytes += b; trashed++; }
      else failed.push(p);
    } else if (raw.startsWith('reg:')) {
      regPaths.push(raw.slice(4));
    }
  }
  if (regPaths.length) {
    // Cada chave: exporta para .reg, CONFIRMA que o arquivo existe, e só então apaga.
    //
    // Antes o nome do arquivo era montado dentro do PowerShell com 4 barras no fonte
    // ('[\\\\/:]'), que chegam como 2 barras — e em PowerShell \\ é barra literal.
    // Nenhum \ do caminho era trocado: o reg export tentava gravar numa subpasta
    // inexistente, falhava calado (2>$null) e a chave era apagada SEM BACKUP NENHUM,
    // enquanto a função devolvia regs:1 e a tela dizia "o backup fica em desinstalacoes".
    let regs = 0;
    for (const chave of regPaths) {
      const nomeSeguro = String(chave).replace(/[\\/:*?"<>|]/g, '_');
      const arquivoBak = path.join(bakDir, nomeSeguro + '.reg');
      const psChave = String(chave)
        .replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM:')
        .replace(/^HKEY_CURRENT_USER/i, 'HKCU:')
        .replace(/^HKEY_CLASSES_ROOT/i, 'HKCR:')
        .replace(/^HKEY_USERS/i, 'HKU:');

      // 1. exportar
      await core.ps('reg export "' + chave + '" "' + arquivoBak + '" /y', 60000);
      // 2. conferir. Sem um .reg valido, NAO apagar.
      let tamanho = 0;
      try { tamanho = fs.existsSync(arquivoBak) ? fs.statSync(arquivoBak).size : 0; } catch (e) { tamanho = 0; }
      if (tamanho < 20) { failed.push('backup falhou, chave mantida: ' + chave); continue; }
      // 3. so agora apagar
      // usar concatenacao simples (evita aninhamento de aspas)
      const scriptDel = "Remove-Item -LiteralPath '" + qq(psChave) + "' -Recurse -Force -ErrorAction Stop; Write-Output 'ok'";
      const del = await core.ps(scriptDel, 60000);
      if (del.ok && String(del.out || '').includes('ok')) regs++;
      else failed.push('nao apagou: ' + chave);
    }
  }
  return { success: true, trashed, bytes, regs, failed };
};

// ────────────────────────────── JOGOS ──────────────────────────────
let gamesCache = null;
const findGameExe = (dir) => {
  if (!dir || !fs.existsSync(dir)) return '';
  const folder = path.basename(dir).toLowerCase();
  const cands = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.exe$/i.test(e.name)) {
        try { const st = fs.statSync(p); if (st.size > 60 * 1024) cands.push({ p, size: st.size, name: e.name }); } catch (err) {}
      }
    }
  };
  walk(dir, 0);
  if (!cands.length) return '';
  const scored = cands.map((c) => {
    const n = c.name.toLowerCase().replace(/\.exe$/, '');
    let sc = c.size;
    if (/launcher|unins|setup|crash|report|updater|service|tool|redist|vc_redist|dxsetup/.test(n)) sc /= 20;
    if (/(gta|fivem|cs2|valorant|fortnite|game|shipping|win64)/.test(n)) sc *= 2;
    if (n === folder || folder.includes(n) || n.includes(folder)) sc *= 5;
    return { p: c.p, s: sc };
  }).sort((a, b) => b.s - a.s);
  return scored[0].p;
};

// apps do Steam que não são jogos (não entram em Meus jogos)
const NON_GAME = /^(steamworks common redistributables|steamvr|steam linux runtime|proton|steam client|wallpaper engine|lossless scaling)$/i;

ex.gamesScan = async () => {
  const games = [];
  if (!steamRoot) await ex.initSteam();
  try {
    if (steamRoot) {
      const libs = [steamRoot];
      try {
        const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
      } catch (e) {}
      const seen = new Set();
      for (const lib of libs) {
        const appsDir = path.join(lib, 'steamapps');
        let files = [];
        try { files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) { continue; }
        for (const f of files) {
          try {
            const txt = fs.readFileSync(path.join(appsDir, f), 'utf8');
            const name = (/"name"\s+"([^"]+)"/.exec(txt) || [])[1];
            const appid = (/appmanifest_(\d+)\.acf/.exec(f) || [])[1];
            const dir = (/"installdir"\s+"([^"]+)"/.exec(txt) || [])[1];
            if (!name || !appid || seen.has(appid) || NON_GAME.test(name.trim())) continue;
            seen.add(appid);
            games.push({ id: 'steam:' + appid, name, dir: dir ? path.join(appsDir, 'common', dir) : '', exe: dir ? findGameExe(path.join(appsDir, 'common', dir)) : '', gpu: true, canClean: true, appid: String(appid), steamId: String(appid), store: 'steam', bytes: 0 });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  // Epic
  try {
    const manif = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
    for (const f of fs.readdirSync(manif)) {
      if (!f.endsWith('.item')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(manif, f), 'utf8'));
        if (j.DisplayName && j.InstallLocation) games.push({ id: 'epic:' + j.AppName, name: j.DisplayName, dir: j.InstallLocation, exe: findGameExe(j.InstallLocation), gpu: true, canClean: true, store: 'epic', bytes: 0 });
      } catch (e) {}
    }
  } catch (e) {}
  // FiveM
  const fivem = path.join(os.homedir(), 'AppData', 'Local', 'FiveM');
  if (fs.existsSync(fivem)) games.push({ id: 'fivem', name: 'FiveM (GTA RP)', dir: path.join(fivem, 'FiveM.app'), exe: path.join(fivem, 'FiveM.app', 'FiveM.exe'), gpu: true, canClean: true, store: 'fivem', bytes: 0 });
  await Promise.all(games.map(async (g) => {
    if (!g.dir || !fs.existsSync(g.dir)) return;
    try {
      const r = await dirSizes([g.dir], 0, 4000);
      g.bytes = r.bytes;
    } catch (e) {}
  }));
  for (const g of games) { g.installed = true; g.running = !!g.running; g.sizeLabel = fmtBytes(g.bytes); }
  gamesCache = games;
  return { success: true, games };
};

const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (!n) return '';
  const u = [['TB', 1024 ** 4], ['GB', 1024 ** 3], ['MB', 1024 ** 2]];
  for (const [suf, v] of u) if (n >= v) return (n / v).toLocaleString('pt-BR', { maximumFractionDigits: n / v >= 100 ? 0 : 1 }) + ' ' + suf;
  return Math.round(n / 1024) + ' KB';
};

ex.gamesStatus = async () => {
  if (!gamesCache) await ex.gamesScan();
  try {
    const r = await core.ps(`$n = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique); Write-Output (Json $n)`);
    let names = [];
    try { const j = JSON.parse(r.out); names = Array.isArray(j) ? j : [j]; } catch (e) {}
    const set = new Set(names.map((n) => String(n).toLowerCase()));
    for (const g of gamesCache || []) {
      const base = g.exe ? path.basename(g.exe, path.extname(g.exe)).toLowerCase() : '';
      g.running = !!(base && set.has(base)) || (g.store === 'fivem' && set.has('fivem'));
    }
  } catch (e) {}
  return { scanning: false, games: gamesCache };
};

ex.setAutoMode = (on) => {
  writeJson('auto-mode.json', { on: !!on });
  return { success: true };
};

ex.gameClean = async ({ id }) => {
  const g = (gamesCache || []).find((x) => x.id === id);
  if (!g) return { success: false, error: 'jogo não encontrado' };
  if (g.store === 'fivem') {
    const base = path.join(os.homedir(), 'AppData', 'Local', 'FiveM', 'FiveM.app', 'data');
    for (const sub of ['cache', 'server-cache', 'server-cache-priv']) {
      try { fs.rmSync(path.join(base, sub), { recursive: true, force: true }); } catch (e) {}
    }
    return { success: true };
  }
  if (g.store === 'steam') {
    const root = steamRoot ? path.join(steamRoot, 'steamapps', 'shadercache', g.appid) : null;
    if (root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {} }
    return { success: true };
  }
  return { success: true };
};

ex.shaderClean = async () => {
  for (const d of CATS.find((c) => c.id === 'shaders').paths) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  return { success: true };
};

// FiveM graphics
function fivemSettingsFile() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'FiveM');
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 5) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.toLowerCase() === 'settings.xml') hits.push(p);
    }
  };
  walk(base, 0);
  return hits.sort((a, b) => b.length - a.length)[0] || null;
}
const FIVEM_BAK = () => path.join(APP_DATA(), 'fivem-settings.backup.xml');

function parseFivemValues(xml) {
  const v = {};
  for (const k of ['MSAA', 'GrassQuality', 'MaxLodScale', 'SamplingMode', 'Windowed', 'ShadowQuality', 'TextureQuality', 'ShaderQuality', 'CityDensity', 'ParticleQuality', 'ReflectionQuality', 'ExtendedDistanceScaling']) {
    const m = new RegExp(`<${k}[^>]*value="([^"]*)"`, 'i').exec(xml);
    if (m) v[k] = m[1];
  }
  return v;
}

// Verifica se algum dos processos está aberto (por nome, sem o .exe).
// Usado pelo FiveM antes de mexer no arquivo de configuração: com o jogo aberto,
// a alteração seria sobrescrita quando ele fechasse.
async function processRunning(nomes) {
  const lista = (Array.isArray(nomes) ? nomes : [nomes])
    .filter(Boolean)
    .map((x) => String(x).replace(/[^A-Za-z0-9._-]/g, ""));
  if (!lista.length) return false;

  // montar o filtro do PowerShell: $_.ProcessName -ieq "FiveM" -or ...
  const partes = lista.map((x) => "$_.ProcessName -ieq " + String.fromCharCode(34) + x + String.fromCharCode(34));
  const filtro = partes.join(" -or ");

  try {
    const script =
      "$r = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { " + filtro + " });" +
      " if ($r.Count -gt 0) { Write-Output " + String.fromCharCode(39) + "1" + String.fromCharCode(39) + " } else { Write-Output " + String.fromCharCode(39) + "0" + String.fromCharCode(39) + " }";
    const r = await core.ps(script, 15000);
    return String(r.out || "").trim() === "1";
  } catch (e) {
    return false;
  }
}

ex.fivemGfxStatus = async () => {
  const file = fivemSettingsFile();
  // await: sem isso, 'running' era uma Promise e o JSON saia {}.
  const running = await processRunning(['FiveM', 'FiveM_b2372_GTAProcess', 'GTA5']);
  if (!file) return { success: false, installed: !!fs.existsSync(path.join(os.homedir(), 'AppData', 'Local', 'FiveM')), file: null, running };
  let xml = '';
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  const values = parseFivemValues(xml);
  const idx = { 0: 0, 5: 0, 4: 1, 3: 2, 2: 3, 1: 4 };
  return { success: true, installed: true, file, running, backup: fs.existsSync(FIVEM_BAK()), values, preset: null, scaleIndex: idx[Number(values.SamplingMode)] ?? 0 };
};

ex.fivemGfxApply = async ({ preset, scaling, borderless }) => {
  const file = fivemSettingsFile();
  if (!file) return { success: false, error: 'Abra o FiveM uma vez e feche para ele criar o arquivo de configuração.' };
  if (await processRunning(['FiveM', 'GTA5'])) return { success: false, error: 'O FiveM está aberto. Feche o jogo para mudar os gráficos.' };
  let xml = fs.readFileSync(file, 'utf8');
  if (!fs.existsSync(FIVEM_BAK())) fs.writeFileSync(FIVEM_BAK(), xml, 'utf8');
  const set = (tag, val) => {
    const re = new RegExp(`<${tag}([^>]*)value="[^"]*"`, 'i');
    if (re.test(xml)) xml = xml.replace(re, `<${tag}$1value="${val}"`);
  };
  if (preset === 'fps') { set('MSAA', '0'); set('GrassQuality', '0'); set('MaxLodScale', '0'); set('ShadowQuality', '0'); }
  if (preset === 'balanced') { set('MSAA', '0'); set('GrassQuality', '1'); set('MaxLodScale', '1'); set('ShadowQuality', '1'); }
  if (scaling != null) {
    const map = ['0', '5', '4', '3', '2'];
    set('SamplingMode', map[scaling] ?? '0');
  }
  if (borderless != null) set('Windowed', borderless ? '2' : '0');
  fs.writeFileSync(file, xml, 'utf8');
  return { success: true };
};

ex.fivemGfxRestore = async () => {
  const file = fivemSettingsFile();
  if (!file || !fs.existsSync(FIVEM_BAK())) return { success: false, error: 'sem backup' };
  fs.copyFileSync(FIVEM_BAK(), file);
  return { success: true };
};

// ────────────────────────────── PC INFO ──────────────────────────────
// ── Sensores reais: nvidia-smi para GPU, contadores de confiabilidade para disco ──
const NVSM = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
const numOrNull = (v) => {
  if (v == null) return null;
  const t = String(v).trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
};
function nvQuery() {
  return new Promise((resolve) => {
    if (!fs.existsSync(NVSM)) return resolve([]);
    execFile(NVSM, ['--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,power.limit,fan.speed,clocks.gr,clocks.mem', '--format=csv,noheader,nounits'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const line of String(stdout).trim().split(/\r?\n/)) {
        const c = line.split(',').map((x) => x.trim());
        if (c.length < 11) continue;
        out.push({
          name: c[0],
          temp: numOrNull(c[1]), usage: numOrNull(c[2]), memUsage: numOrNull(c[3]),
          memUsed: numOrNull(c[4]), memTotal: numOrNull(c[5]),
          power: numOrNull(c[6]), powerLimit: numOrNull(c[7]), fan: numOrNull(c[8]),
          clock: numOrNull(c[9]), memClock: numOrNull(c[10]),
        });
      }
      resolve(out);
    });
  });
}

let diskSensorCache = { at: 0, list: [] };
async function diskSensors(force) {
  if (!force && Date.now() - diskSensorCache.at < 15000) return diskSensorCache.list;
  const r = await core.ps(`
    $o = @()
    foreach ($d in @(Get-PhysicalDisk -ErrorAction SilentlyContinue)) {
      $c = $null
      try { $c = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}
      $o += @{
        id = [string]$d.DeviceId; name = [string]$d.FriendlyName
        media = [string]$d.MediaType; bus = [string]$d.BusType; bytes = [int64]$d.Size
        health = [string]$d.HealthStatus; fw = [string]$d.FirmwareVersion
        temp = $(if ($c -and $null -ne $c.Temperature) { [int]$c.Temperature } else { $null })
        wear = $(if ($c -and $null -ne $c.Wear) { [int]$c.Wear } else { $null })
        hours = $(if ($c -and $null -ne $c.PowerOnHours) { [int64]$c.PowerOnHours } else { $null })
      }
    }
    Write-Output (Json $o)`, 60000);
  let list = [];
  if (r.ok && r.out) { try { const j = JSON.parse(r.out); list = Array.isArray(j) ? j : [j]; } catch (e) {} }
  diskSensorCache = { at: Date.now(), list };
  return list;
}


let pcinfoCache = { at: 0, data: null };
ex.pcinfoGet = async (opts) => {
  const force = !!(opts && opts.force);
  if (!force && pcinfoCache.data && Date.now() - pcinfoCache.at < 120000) return pcinfoCache.data;
  const r = await core.ps(String.raw`
    $cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
    $cpu = Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'
    $cpuKey = 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0'
    $cpuReg = Get-ItemProperty $cpuKey -ErrorAction SilentlyContinue
    $uc = $cpuReg.'Update Revision'
    $ident = [string]$cpuReg.Identifier
    $micro = $null
    if ($uc) { try { $b = @($uc) | ForEach-Object { [int]$_ }; if ($b.Count -ge 4) { $micro = ([int64]$b[0] + [int64]$b[1] * 256 + [int64]$b[2] * 65536 + [int64]$b[3] * 16777216) } } catch {} }
    $cm = @(Get-CimInstance Win32_CacheMemory -ErrorAction SilentlyContinue)
    $l1 = [int](($cm | Where-Object { $_.Level -eq 3 } | Measure-Object -Property InstalledSize -Sum).Sum)
    $l2 = [int](($cm | Where-Object { $_.Level -eq 4 } | Measure-Object -Property InstalledSize -Sum).Sum)
    $l3 = [int](($cm | Where-Object { $_.Level -eq 5 } | Measure-Object -Property InstalledSize -Sum).Sum)
    if (-not $l2) { $l2 = [int]$cpu.L2CacheSize }
    if (-not $l3) { $l3 = [int]$cpu.L3CacheSize }
    $vramMap = @{}
    try {
      $cls = Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' }
      foreach ($k in $cls) {
        $pp = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        $q = $pp.'HardwareInformation.qwMemorySize'
        if ($q -and $pp.DriverDesc) { $vramMap[[string]$pp.DriverDesc] = [int64]$q }
      }
    } catch {}
    $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; vram=$(if ($vramMap.ContainsKey([string]$_.Name)) { $vramMap[[string]$_.Name] } else { [int64]$_.AdapterRAM }); driver=$_.DriverVersion; driverDate=$(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }); integrated=($_.Name -match 'Intel|UHD|Vega|Radeon\(TM\) Graphics|Radeon Graphics'); maker=[string]$_.AdapterCompatibility; device=[string]$_.DeviceID } })
    $mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{ bank=[string]$_.BankLabel; slot=[string]$_.DeviceLocator; maker=[string]$_.Manufacturer; part=[string]$_.PartNumber; bytes=[int64]$_.Capacity; type=[int]$_.SMBIOSMemoryType; form=[int]$_.FormFactor; speed=[int]$_.Speed; cfg=[int]$_.ConfiguredClockSpeed } })
    $disks = @(Get-PhysicalDisk | ForEach-Object { $d = Get-Disk -Number $_.DeviceId -ErrorAction SilentlyContinue; $volsD = @(Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | ForEach-Object { $_.DriveLetter } | Where-Object { $_ }); @{ id=[string]$_.DeviceId; name=[string]$_.FriendlyName; media=[string]$_.MediaType; bus=[string]$_.BusType; bytes=[int64]$_.Size; health=$_.HealthStatus; letters=@($volsD); wear=$null; hours=$null; fw=[string]$_.FirmwareVersion; temp=$null } })
    $vols = @(Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { @{ letter=$_.DriveLetter; label=[string]$_.FileSystemLabel; fs=[string]$_.FileSystem; bytes=[int64]$_.Size; free=[int64]$_.SizeRemaining } })
    $board = Get-CimInstance Win32_BaseBoard
    $bios = Get-CimInstance Win32_BIOS
    $sys = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem
    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    $batNew = $null
    try {
      $bs = Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1
      $bf = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
      $bc = Get-CimInstance -Namespace root\wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1
      $bst = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($bs) { $batNew = @{ name=[string]$bs.DeviceName; design=[int]$bs.DesignedCapacity; full=$(if ($bf) { [int]$bf.FullChargedCapacity } else { 0 }); cycles=$(if ($bc) { [int]$bc.CycleCount } else { 0 }); percent=$(if ($bst) { [int]$bst.RemainingCapacity } else { 0 }); charging=$(if ($bst) { [bool]$bst.Charging } else { $false }); ac=$(if ($bst) { [bool]$bst.PowerOnline } else { $false }) } }
    } catch {}
    $monitors = @()
    try {
      $mon = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)
      $ids = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue)
      for ($i = 0; $i -lt $mon.Count; $i++) {
        $year = 0
        if ($i -lt $ids.Count) { $year = [int]$ids[$i].YearOfManufacture }
        $monitors += @{ wcm = [double]$mon[$i].MaxHorizontalImageSize; hcm = [double]$mon[$i].MaxVerticalImageSize; year = $year; active = [bool]$mon[$i].Active }
      }
    } catch {}
    $net = @(Get-CimInstance Win32_NetworkAdapter -Filter 'NetEnabled=True' | ForEach-Object { @{ name=[string]$_.Name; desc=[string]$_.Description; speed=[int64]$_.Speed; media=[string]$_.AdapterType; driver='' } })
    # CPU: o registro em HARDWARE\DESCRIPTION\System\CentralProcessor\0 tem apenas
    # ProcessorNameString e ~MHz — NAO tem Name, NumberOfCores, NumberOfLogicalProcessors
    # nem Socket. Ler esses campos devolvia "" e 0 sem erro, e a tela mostrava
    # "Processador: Não detectado" num Ryzen 7 7800X3D. O WMI tem tudo.
    $cpuW = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $cpuNome = [string]$cpuReg.ProcessorNameString
    $cpuCores = 0
    $cpuThreads = 0
    $cpuMhz = [int]$cpuReg.'~MHz'
    $cpuSocket = ''
    $cpuVendor = [string]$cpuReg.Identifier
    $cpuFam = 0
    $cpuMod = 0
    $cpuStep = 0
    if ($cpuW) {
      if ($cpuW.Name) { $cpuNome = [string]$cpuW.Name }
      $cpuCores = [int]$cpuW.NumberOfCores
      $cpuThreads = [int]$cpuW.NumberOfLogicalProcessors
      if ($cpuW.MaxClockSpeed) { $cpuMhz = [int]$cpuW.MaxClockSpeed }
      if ($cpuW.SocketDesignation) { $cpuSocket = [string]$cpuW.SocketDesignation }
      if ($cpuW.Manufacturer) { $cpuVendor = [string]$cpuW.Manufacturer }
      $cpuFam = [int]$cpuW.Family
      $cpuMod = [int]$cpuW.Model
      $cpuStep = [int]$cpuW.Stepping
    }
    if ($cpuThreads -eq 0) { $cpuThreads = [Environment]::ProcessorCount }
    if ($cpuCores -eq 0 -and $cpuThreads -gt 0) { $cpuCores = [int][math]::Max(1, $cpuThreads / 2) }
    $o = [ordered]@{
      cpu = @{ name=$cpuNome; vendor=$cpuVendor; cores=$cpuCores; threads=$cpuThreads; maxMhz=$cpuMhz; socket=$cpuSocket; family=$cpuFam; model=$cpuMod; stepping=$cpuStep; identifier=[string]$ident;
               cache=@{ l1=$l1; l2=$l2; l3=$l3 }; features=@(); microcode=$micro }
      gpus = $gpus; mem = @{ modules = $mem; slots = [int]((Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1).MemoryDevices) }
      disks = $disks; vols = $vols; displays = @(); monitors = $monitors; nets = $net; battery = $batNew
      board = @{ maker=[string]$board.Manufacturer; model=[string]$board.Product; version=[string]$board.Version; biosVendor=[string]$bios.Manufacturer; biosVersion=[string]$bios.SMBIOSBIOSVersion; biosDate=$(if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { '' }); uefi=($env:firmware_type -eq 'UEFI'); secureBoot=$null; tpm=''; sysMaker=[string]$sys.Manufacturer; sysModel=[string]$sys.Model }
      win = @{ name=[string]$cv.ProductName; display=[string]$cv.DisplayVersion; build=[string]$cv.CurrentBuild; arch=$env:PROCESSOR_ARCHITECTURE; installed=$(if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { '' }) }
      bootAt = [int64]([DateTimeOffset]$os.LastBootUpTime).ToUnixTimeMilliseconds()
    }
    Write-Output (Json $o)`, 180000);
  if (!r.ok) return { success: false, error: r.err || 'falha' };
  try {
    const info = JSON.parse(r.out);
    // AMD reporta Family 107/Model 0 no CIM; o Identifier traz os valores reais.
    try {
      const id = String((info.cpu && info.cpu.identifier) || '');
      const m = /Family\s+(\d+)\s+Model\s+(\d+)\s+Stepping\s+(\d+)/i.exec(id);
      if (m) { info.cpu.family = Number(m[1]); info.cpu.model = Number(m[2]); info.cpu.stepping = Number(m[3]); }
    } catch (e) {}

    // Instruções da CPU: só o que dá para provar.
    //
    // Duas tentativas anteriores erraram:
    //   - regex de nome + `fam >= 25` anunciava AVX-512 em todo Zen 4 (Ryzen 7000
    //     desktop não tem) e negava no 11700K, que tem;
    //   - IsProcessorFeaturePresent com IDs chutados: a tabela do Windows é outra
    //     (6=SSE, 10=SSE2, 13=SSE3, 36=SSSE3, 37=SSE4.1, 38=SSE4.2, 39=AVX, 40=AVX2,
    //     41=AVX512F). Lendo 40 eu chamava de AVX512F — e ele respondeu True num
    //     7800X3D, que não tem AVX-512.
    //
    // Aqui só entram as instruções que o Windows reporta com o ID certo e que são
    // estáveis. AVX-512 fica de fora: dentro do PowerShell 5.1 deste app não existe
    // fonte confiável (sem .NET Intrinsics, CPUID não exposto), e informar errado é
    // pior que não informar.
    try {
      const PF = [
        [6, 'SSE'], [10, 'SSE2'], [13, 'SSE3'], [36, 'SSSE3'],
        [37, 'SSE4.1'], [38, 'SSE4.2'], [39, 'AVX'], [40, 'AVX2'],
      ];
      const linhasAf = [
        'Add-Type -Namespace VL -Name PF -MemberDefinition \'[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint f);\'',
        '$o = @()',
        PF.map(([id, nome]) => `try { if ([VL.PF]::IsProcessorFeaturePresent(${id})) { $o += \'${nome}\' } } catch { }`).join(String.fromCharCode(10)),
        'Write-Output (Json $o)',
      ];
      const rAf = await core.ps(linhasAf.join(String.fromCharCode(10)), 20000);
      let achadas = [];
      try { const j = JSON.parse(rAf.out); achadas = Array.isArray(j) ? j : (j ? [j] : []); } catch (e) { achadas = []; }
      // FMA/BMI/F16C vêm junto com AVX2 em todo processador que tem AVX2 (2013+).
      const set = new Set(achadas);
      if (set.has('AVX2')) { set.add('FMA3'); set.add('BMI1'); set.add('BMI2'); set.add('F16C'); }
      info.cpu.features = [...set];
    } catch (e) { info.cpu.features = []; }
    // displays via electron (screens)
    try {
      const { screen } = require('electron');
      const mons = Array.isArray(info.monitors) ? info.monitors : [];
      info.displays = screen.getAllDisplays().map((d, i) => {
        const m = mons[i] || mons.find((x) => x.active) || {};
        const cm = Math.hypot(m.wcm || 0, m.hcm || 0);
        return { name: d.label || ('Tela ' + (i + 1)), w: d.size.width, h: d.size.height, hz: d.displayFrequency || 60, primary: d.id === screen.getPrimaryDisplay().id, scale: Math.round((d.scaleFactor || 1) * 100), depth: 8, inches: cm > 20 ? Math.round((cm / 2.54) * 10) / 10 : null, year: m.year || null };
      });
    } catch (e) { info.displays = []; }
    info.mem.total = (info.mem.modules || []).reduce((a, m) => a + m.bytes, 0);
    const result = { success: true, info };
    pcinfoCache = { at: Date.now(), data: result };
    return result;
  } catch (e) { return { success: false, error: 'resposta inválida', raw: String(r.out || '').slice(0, 900) }; }
};

let lastLive = null;
ex.pcinfoLive = async () => {
  const [base, gpus] = await Promise.all([
    core.ps(`
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $ram = Get-CimInstance Win32_OperatingSystem
      $per = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { [int]$_.PercentProcessorTime })
      $mhz = [int]((Get-CimInstance Win32_Processor).CurrentClockSpeed)
      $coreMhz = @()
      foreach ($p in @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '_Total' })) { $coreMhz += [int]$p.ProcessorFrequency }
      $o = @{ cpu = @{ usage=[int]$cpu; mhz=$mhz; coreMhz=$coreMhz; cores=$per; temp=$null }; ram = @{ used=([int64]($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory) * 1024); total=([int64]$ram.TotalVisibleMemorySize * 1024); cache=$null }; gpus = @(); disks = @{} }
      Write-Output (Json $o)`, 30000),
    nvQuery(),
  ]);
  if (!base.ok) return { success: false, error: base.err || 'falha' };
  let live;
  try { live = JSON.parse(base.out); } catch (e) { return { success: false, error: 'resposta inválida' }; }
  live.gpus = gpus;
  const disks = await diskSensors(false);
  const map = {};
  for (const d of disks) if (d.temp != null) map[d.id] = d.temp;
  live.disks = map;
  lastLive = live;
  return { success: true, ...live };
};

ex.getHardware = async () => {
  const r = await core.ps(`
    $cpu = Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'
    $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
    $m = @(Get-CimInstance Win32_PhysicalMemory)
    $ram = [math]::Round(($m | Measure-Object -Property Capacity -Sum).Sum / 1GB)
    $rate = ($m | Select-Object -First 1).ConfiguredClockSpeed
    $ddr = if (($m | Select-Object -First 1).SMBIOSMemoryType -eq 34) { 'DDR5' } else { 'DDR4' }
    $o = @{ cpu=([string]$cpu.ProcessorNameString).Trim(); cpuDetail=("$([Environment]::ProcessorCount) threads"); gpu=$gpu.Name; gpuDetail=("driver $($gpu.DriverVersion)"); ram="$ram GB $ddr-$rate"; ramDetail="$($m.Count) pente(s)" }
    Write-Output (Json $o)`, 60000);
  try { return JSON.parse(r.out); } catch (e) { return { cpu: '—', gpu: '—', ram: '—' }; }
};

// Amostra anterior de os.cpus(), para calcular o uso entre duas leituras.
let cpuAmostra = null;
function cpuInstantaneo() {
  const cpus = os.cpus() || [];
  let idle = 0, total = 0;
  for (const x of cpus) {
    const t = x.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

ex.getStats = async () => {
  // CPU: diferenca entre duas amostras de os.cpus(). A primeira chamada devolve 0 e guarda a base.
  const agora = cpuInstantaneo();
  let cpu = 0;
  if (cpuAmostra) {
    const di = agora.idle - cpuAmostra.idle;
    const dt = agora.total - cpuAmostra.total;
    if (dt > 0) cpu = Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
  }
  cpuAmostra = agora;

  // RAM: direto do Node.
  const totalRam = os.totalmem();
  const livreRam = os.freemem();
  const ram = totalRam > 0 ? Math.round(((totalRam - livreRam) / totalRam) * 100) : 0;

  // GPU: nvidia-smi responde em ~120 ms. Sem ele, fica 0.
  let gpu = 0;
  try {
    const r = await core.ps(`& 'C:\\Windows\\System32\\nvidia-smi.exe' --query-gpu=utilization.gpu --format=csv,noheader,nounits`, 8000);
    if (r.ok && r.out) gpu = parseInt(String(r.out).trim().split('\n')[0], 10) || 0;
  } catch (e) { }

  return { cpu, ram, gpu };
};

ex.getMemStats = async () => {
  const r = await core.ps(`
    $os = Get-CimInstance Win32_OperatingSystem
    $total = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    $free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    $used = [math]::Round($total - $free, 1)
    $m = @(Get-CimInstance Win32_PhysicalMemory)
    $sticks = @()
    $i = 0
    foreach ($s in $m) {
      $i++
      $gen = if ($s.SMBIOSMemoryType -eq 34) { 'DDR5' } elseif ($s.SMBIOSMemoryType -eq 26) { 'DDR4' } else { 'DDR' }
      $form = if ($s.FormFactor -eq 12) { 'sodimm' } else { 'dimm' }
      $sticks += @{ empty=$false; label=[string]$s.DeviceLocator; gb=[math]::Round($s.Capacity/1GB); gen=$gen; form=$form; mts=[int]$s.ConfiguredClockSpeed; maker=[string]$s.Manufacturer; part=[string]$s.PartNumber }
    }
    Write-Output (Json @{ used=$used; total=$total; pct=[math]::Round($used/$total*100); cache=$null; sticks=$sticks })`, 60000);
  try { return JSON.parse(r.out); } catch (e) { return { used: 0, total: 0, pct: 0, sticks: [] }; }
};

ex.getProcesses = async () => {
  const r = await core.ps(`$o = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 30 | ForEach-Object { @{ pid=$_.Id; name=$_.ProcessName + '.exe'; ram=[math]::Round($_.WorkingSet64/1MB) } }); Write-Output (Json $o)`);
  try { return { success: true, processes: JSON.parse(r.out) }; } catch (e) { return { success: true, processes: [] }; }
};

ex.killProcess = async (pid) => {
  const r = await core.ps(`Stop-Process -Id ${parseInt(pid, 10) || 0} -Force -ErrorAction SilentlyContinue; Write-Output 'ok'`);
  return { success: r.ok };
};

ex.ramClean = async () => {
  const r = await core.ps(`
    $before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    Get-Process | Where-Object { $_.WorkingSet64 -gt 200MB -and $_.ProcessName -notmatch 'System|Idle|explorer' } | ForEach-Object { try { [System.GC]::Collect() } catch {} }
    $after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    Write-Output ([math]::Round(($after - $before) / 1MB, 1))`, 30000);
  return { success: true, freed: parseFloat(r.out) || 0 };
};

// ────────────────────────────── FPS (PresentMon) ──────────────────────────────
const PM = path.join(__dirname, 'bin', 'PresentMon.exe');
const fps = {
  proc: null, targetPid: null, targetName: '', frames: [], low: [], fps: 0, ft: 0, low1: 0,
  overlay: readJson('fps-overlay.json', { on: false, pos: 0, show: { frametime: true, low1: true, name: true } }),
  base: null, sessions: readJson('fps-sessions.json', { a: null, b: null }),
  recording: null, hotkey: 'Ctrl+Alt+B',
};

// FPS médio do grupo dos piores frametimes.
//
// O indicador "1% low" é a média dos 1% piores quadros, e não o pior quadro sozinho.
// Usar um quadro só produzia números otimistas (168 em vez de 136 num teste real) e
// escondia exatamente o travamento que o jogador sente.
function lowFromFrametimes(lista, fracao) {
  const arr = (Array.isArray(lista) ? lista : []).filter((x) => x > 0 && isFinite(x));
  if (!arr.length) return 0;
  const piores = [...arr].sort((a, b) => b - a);
  // floor, nao round. Medido contra o CSV de referencia (2541 quadros):
  //   1% com round = 136,0  (alvo 135,97)  ok
  //   0,1% com round = 109,4 (alvo 107,71) erro +1,57%
  //   0,1% com floor = 107,7 (alvo 107,71) exato
  // O 0,1% de 2541 quadros = 2,541; round dava 3 e incluia um quadro a mais.
  const qtd = Math.max(1, Math.floor(piores.length * fracao));
  const media = piores.slice(0, qtd).reduce((s, x) => s + x, 0) / qtd;
  return media > 0 ? Math.round((1000 / media) * 10) / 10 : 0;
}
function stopPM() {
  if (fps.proc) { try { fps.proc.kill(); } catch (e) {} fps.proc = null; }
  fps.frames = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;
}

function startPM(pid) {
  stopPM();
  fps.targetPid = pid;
  try {
    const p = spawn(PM, ['--process_id', String(pid), '--output_stdout', '--no_console_stats', '--terminate_on_proc_exit', '--stop_existing_session', '--session_name', 'LOPT_TARGET'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    fps.proc = p;
    fps.denied = false;
    fps.pmError = null;
    try {
      p.stderr.on('data', (d) => {
        const t = String(d);
        if (/access denied|elevated privilege|administrative/i.test(t)) fps.denied = true;
        const m = /error:\s*([^\r\n]+)/i.exec(t);
        if (m) fps.pmError = m[1].trim();
      });
    } catch (e) {}
    let buf = '';
    let header = null, ftIdx = -1;
    const pushFrame = (ft) => {
      if (!isFinite(ft) || ft <= 0) return;
      const t = Date.now();
      fps.frames.push({ t, ft });
      // janela de 10 s para o 1% low (o resto serve só para a média curta)
      while (fps.frames.length && t - fps.frames[0].t > 10000) fps.frames.shift();
      if (fps.frames.length > 2400) fps.frames.shift();
      const recent = fps.frames.slice(-120);
      fps.ft = recent.reduce((a, b) => a + b.ft, 0) / (recent.length || 1);
      fps.fps = Math.round(1000 / fps.ft);
      // 1% low = média dos 1% piores frametimes, não um único quadro.
      // Pegar um quadro só dava +24% de erro contra a referência (168 em vez de 136).
      fps.low1 = lowFromFrametimes(fps.frames.map((f) => f.ft), 0.01);
      fps.low01 = lowFromFrametimes(fps.frames.map((f) => f.ft), 0.001);
    };
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!header) {
          if (/Application|ProcessID/i.test(line)) {
            header = line.split(',');
            ftIdx = header.findIndex((h) => /MsBetweenPresents|MsBetweenDisplayChange/i.test(h));
            fps.cols = header;
          }
          continue;
        }
        const cols = line.split(',');
        if (cols.length < 3) continue;
        if (!fps.targetName && cols[0]) fps.targetName = cols[0].replace(/\.exe$/i, '') + '.exe';
        pushFrame(parseFloat(cols[ftIdx >= 0 ? ftIdx : cols.length - 1]));
      }
    });
    p.on('exit', () => { if (fps.proc === p) { fps.proc = null; } });
  } catch (e) { fps.proc = null; }
}

function baseLive() {
  if (!fps.base) return null;
  const now = fps.fps || 0;
  if (fps.base.name && fps.targetName && fps.base.name !== fps.targetName) return null;
  return { fps: fps.base.fps, now, gain: fps.base.fps ? (now - fps.base.fps) / fps.base.fps * 100 : null, fresh: now === 0 };
}

function overlayPayload() {
  const ov = fps.overlay || {};
  return {
    live: fps.proc && fps.fps ? { fps: fps.fps, frametime: fps.ft, low1: fps.low1, name: fps.targetName, base: baseLive() } : (fps.fps ? { fps: fps.fps, frametime: fps.ft, low1: fps.low1, name: fps.targetName, base: baseLive() } : null),
    show: ov.show || {}, right: ov.pos === 1 || ov.pos === 3, bottom: ov.pos === 2 || ov.pos === 3,
    sys: lastSys,
  };
}

let lastSys = { cpu: null, cpuTemp: null, gpu: null, gpuTemp: null, ramUsed: null, ramTotal: null };
async function sysSample() {
  // CPU e RAM vem do proprio Node: neste Windows os contadores de performance respondem
  // "nenhum contador valido" para \Processor(_Total).
  try {
    const cpus = os.cpus() || [];
    let idle = 0, total = 0;
    for (const x of cpus) {
      const t = x.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.irq + t.idle;
    }
    if (sysAmostra) {
      const di = idle - sysAmostra.idle;
      const dt = total - sysAmostra.total;
      if (dt > 0) lastSys.cpu = Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
    }
    sysAmostra = { idle, total };
    const tot = os.totalmem(), liv = os.freemem();
    lastSys.ramTotal = Math.round(tot / 1048576);
    lastSys.ramUsed = Math.round((tot - liv) / 1048576);
  } catch (e) { }

  // GPU pelo nvidia-smi (~120 ms).
  try {
    const g = await nvQuery();
    if (g && g.length) {
      lastSys.gpu = Math.round(g[0].usage || 0);
      if (g[0].temp != null) lastSys.gpuTemp = g[0].temp;
    }
  } catch (e) { }

  return lastSys;
}
// FPS por aplicativo, para a lista do medidor mostrar o número ao lado de cada jogo.
//
// startListCapture() e listCap nunca existiram: fpsStatus() explodia com ReferenceError
// logo no começo e a tela do medidor ficava sem nenhum dado. Aqui está a peça que faltava.
//
// O medidor principal continua sendo o PresentMon (startPM/fps.frames), preso ao jogo alvo.
// Esta captura é leve: reaproveita as amostras do alvo e guarda por nome de processo.
const listCap = {
  apps: new Map(),      // nome normalizado do processo -> { frames: [{t, ft}], fps }
  started: false,
  denied: false,
  lastPoll: 0,
  timer: null,
};

// Liga a captura. Idempotente: chamar várias vezes não empilha timers.
function startListCapture() {
  if (listCap.started) return;
  listCap.started = true;
  listCap.timer = setInterval(() => {
    try {
      // Copia as amostras recentes do alvo atual para o registro por aplicativo.
      // fps.frames já é alimentado pelo PresentMon; só replicamos.
      // Sem jogo alvo, não inventar o nome "jogo": a cobertura por processo nunca casaria
      // e todos os jogos apareceriam com FPS 0.
      const nomeAlvo = String(fps.targetName || '').replace(/\.exe$/i, '').toLowerCase();
      if (!nomeAlvo) return;
      const alvo = nomeAlvo;
      if (!fps.frames.length) return;
      let rec = listCap.apps.get(alvo);
      if (!rec) { rec = { frames: [] }; listCap.apps.set(alvo, rec); }
      rec.frames = fps.frames.slice(-600);

      // FPS = quadros / duração real da amostra.
      // Antes filtrava por "agora - última amostra" e dividia a contagem pela soma dos
      // frametimes, o que dava 216 fps onde a média real era 226,7.
      const agora = Date.now();
      const janela = rec.frames.filter((fr) => agora - fr.t <= 3000 && fr.ft > 0);
      if (janela.length > 2) {
        const duracaoMs = janela[janela.length - 1].t - janela[0].t;
        rec.fps = duracaoMs > 0 ? Math.round((janela.length - 1) / (duracaoMs / 1000)) : 0;
      } else {
        rec.fps = 0;
      }
      // solta apps sem quadro há mais de 15 s
      for (const [nome, r] of listCap.apps) {
        if (r.frames.length && agora - r.frames[r.frames.length - 1].t > 15000) listCap.apps.delete(nome);
      }
    } catch (e) { }
  }, 1000);
  if (listCap.timer.unref) listCap.timer.unref();
}

let sysAmostra = null;
ex.fpsStatus = async () => {
  if (!fps.proc && !fps.targetPid) {
    // auto-alvo: só um jogo conhecido, nunca o primeiro processo que aparecer
    try {
      const games = (await ex.gamesStatus()).games || [];
      const names = new Set(games.map((g) => String(g.name || '').toLowerCase()));
      const r = await core.ps(`$o = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne ${process.pid} } | ForEach-Object { @{ id=$_.Id; name=$_.ProcessName } }); Write-Output (Json $o)`);
      let procs = [];
      try { procs = JSON.parse(r.out); } catch (e) {}
      if (!Array.isArray(procs)) procs = procs ? [procs] : [];
      const game = procs.find((p) => names.has(String(p.name || '').toLowerCase()) || /fivem|gta|cs2|valorant|fortnite|warzone|apex|rust|pubg|league|rocket|overwatch|minecraft/i.test(p.name || ''));
      if (game) { startPM(Number(game.id)); fps.targetName = game.name + '.exe'; }
    } catch (e) {}
  }
  startListCapture();
  listCap.lastPoll = Date.now();
  const procs = await ex.getProcesses();
  const base = fps.base ? { fps: fps.base.fps, name: fps.base.name } : null;
  const byApp = {};
  for (const [app, rec] of listCap.apps) {
    // só o que teve quadros recentes
    if (rec.frames.length && Date.now() - rec.frames[rec.frames.length - 1].t < 3000 && rec.fps) {
      byApp[app.replace(/\.exe$/i, '').toLowerCase()] = rec.fps;
    }
  }
  return {
    success: true,
    live: fps.fps ? { fps: fps.fps, frametime: fps.ft, low1: fps.low1, name: fps.targetName, base: baseLive() } : null,
    processes: (procs.processes || []).map((p) => {
      const key = String(p.name).replace(/\.exe$/i, '').toLowerCase();
      return { pid: p.pid, name: p.name, fps: byApp[key] || 0 };
    }),
    pinned: fps.targetPid, overlay: fps.overlay, recording: fps.recording,
    sessions: { a: fps.sessions.a, b: fps.sessions.b }, base, hotkey: fps.hotkey,
    needsAdmin: !!(fps.denied || listCap.denied) && !fps.fps,
    success: !(fps.pmError && !fps.fps),
    error: fps.pmError && !fps.fps ? 'Medidor: ' + fps.pmError : undefined,
  };
};

ex.fpsSetTarget = async (pid) => {
  if (!pid) { fps.targetPid = null; stopPM(); return { success: true }; }
  const r = await core.ps(`$p = Get-Process -Id ${parseInt(pid, 10)} -ErrorAction SilentlyContinue; if ($p) { Write-Output ($p.ProcessName + '.exe') }`);
  fps.targetName = r.out.split('\n')[0].trim();
  startPM(pid);
  return { success: true };
};

ex.fpsRecord = async ({ slot, secs, label }) => {
  if (!fps.fps) return { success: false, error: 'Abra o jogo antes de gravar.' };
  secs = [15, 30, 60].includes(secs) ? secs : 30;
  fps.recording = { slot, secs, left: secs, name: fps.targetName };
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < secs * 1000) {
    await new Promise((r) => setTimeout(r, 100));
    fps.recording.left = Math.max(0, secs - Math.round((Date.now() - t0) / 1000));
    // Guardar os frametimes BRUTOS do último 100 ms. Antes empilhava fps.ft, que já é
    // a média dos 120 quadros anteriores: o pior quadro desaparecia e o 1% low saía
    // 24% melhor que a realidade (168 em vez de 136).
    const desde = (fps.frames.length ? fps.frames[fps.frames.length - 1].t : Date.now()) - 100;
    for (let i = fps.frames.length - 1; i >= 0; i--) {
      const fr = fps.frames[i];
      if (!fr || fr.t < desde) break;
      if (fr.ft > 0) samples.push(fr.ft);
    }
    if (!samples.length && fps.ft) samples.push(fps.ft);
  }
  fps.recording = null;
  if (!samples.length) return { success: false, error: 'sem quadros medidos' };
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sorted = [...samples].sort((a, b) => b - a);
  // Percentil = média do pior grupo (1%), não o pior elemento isolado.
  const pct = (p) => lowFromFrametimes(samples, p);
  const ses = { label: String(label || '').slice(0, 40) || ('Gravação ' + new Date().toLocaleTimeString('pt-BR')), fps: Math.round(1000 / avg * 10) / 10, low1: Math.round(pct(0.01) * 10) / 10, low01: Math.round(pct(0.001) * 10) / 10, frametime: Math.round(avg * 100) / 100, secs, frames: samples.length, name: fps.targetName, at: Date.now() };
  fps.sessions[slot] = ses;
  writeJson('fps-sessions.json', fps.sessions);
  return { success: true, session: ses };
};

ex.fpsClear = (slot) => { fps.sessions[slot] = null; writeJson('fps-sessions.json', fps.sessions); return { success: true }; };
// Chaves que o overlay sabe mostrar. Serve para não aceitar lixo do renderer e para
// reconstruir um `show` vazio quando o arquivo salvo veio estragado.
const OVERLAY_CHAVES = ['fps', 'frametime', 'low1', 'cpu', 'gpu', 'ram', 'temp', 'grafico', 'name'];

// Mescla `show` CHAVE POR CHAVE, nunca trocando o objeto.
//
// Antes era Object.assign(fps.overlay, patch): raso, então um clique em "CPU" mandava
// {show:{cpu:true}} e apagava todas as outras escolhas. Cada clique deixava exatamente
// uma opção marcada — parecia botão de rádio, mas o defeito estava na escrita.
//
// O GDZ percorre as chaves recebidas e atribui uma a uma; aqui é igual.
function mesclarShow(showAtual, novo) {
  const base = (showAtual && typeof showAtual === 'object') ? showAtual : {};
  const saida = {};
  // mantém o que já existia
  for (const k of Object.keys(base)) saida[k] = base[k];
  // só aceita chaves conhecidas e valores booleanos
  if (novo && typeof novo === 'object') {
    for (const k of Object.keys(novo)) {
      if (!OVERLAY_CHAVES.includes(k)) continue;
      if (typeof novo[k] !== 'boolean') continue;
      saida[k] = novo[k];
    }
  }
  return saida;
}

ex.fpsOverlaySet = (patch) => {
  const p = patch || {};
  // tira `show` do patch para que o Object.assign não possa substituí-lo
  const semShow = {};
  for (const k of Object.keys(p)) if (k !== 'show') semShow[k] = p[k];
  Object.assign(fps.overlay, semShow);
  fps.overlay.show = mesclarShow(fps.overlay.show, p.show);
  writeJson('fps-overlay.json', fps.overlay);
  return { success: true, overlay: fps.overlay };
};
ex.fpsBaseMark = () => {
  if (!fps.fps) return { success: false, error: 'sem jogo medido' };
  fps.base = { fps: fps.fps, name: fps.targetName, at: Date.now() };
  writeJson('fps-base.json', fps.base);
  return { success: true, base: fps.base };
};
ex.fpsBaseClear = () => { fps.base = null; writeJson('fps-base.json', null); return { success: true }; };
ex.fpsRestore = () => {
  fps.base = readJson('fps-base.json', null);
  fps.overlay = readJson('fps-overlay.json', fps.overlay);
  fps.sessions = readJson('fps-sessions.json', { a: null, b: null });
};
ex.fpsTick = async () => { await sysSample(); return overlayPayload(); };
ex.fpsOverlayPayload = overlayPayload;

// ────────────────────────────── GARGALO ──────────────────────────────
// Lista os processos com janela aberta, para a tela escolher qual é o jogo.
//
// Devolve SEMPRE uma lista em `games`. A tela precisa escolher UM item dela — testar
// `game.pid` na resposta inteira (como era antes) dava sempre falso e o fluxo do
// gargalo nunca passava daí.
//
// `ignore` é o pid que o usuário já recusou em "Não é esse": fica de fora da lista
// para o laço não voltar ao mesmo processo para sempre.
ex.bnFindGame = async (opts) => {
  const ignore = Number(opts && opts.ignore) || 0;
  // O pipeline TEM de estar dentro de @( ... ): sem os parênteses o resultado ia para
  // o stdout e $o continuava vazio, então a lista voltava sempre com 0 itens — e o
  // fluxo do gargalo ficava procurando um jogo que já estava na tela.
  const r = await core.ps([
    '$o = @(',
    '  Get-Process -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne ' + ignore + ' } |',
    '  Sort-Object -Property WorkingSet64 -Descending |',
    '  Select-Object -First 40 |',
    '  ForEach-Object { @{ name=$_.ProcessName; pid=$_.Id; title=[string]$_.MainWindowTitle; mem=$_.WorkingSet64 } }',
    ')',
    'Write-Output (Json $o)',
  ].join(String.fromCharCode(10)), 30000);
  let games = [];
  try {
    const j = JSON.parse(r.out);
    games = Array.isArray(j) ? j : (j ? [j] : []);
  } catch (e) { games = []; }
  // sem pid válido não serve para medir
  games = games.filter((g) => g && Number.isInteger(Number(g.pid)) && Number(g.pid) > 0);
  return { success: true, games };
};

ex.measureBottleneck = async ({ seconds, pid }) => {
  const secs = Math.max(5, Math.min(60, seconds || 15));
  const r = await core.ps(`
    $samples = @()
    for ($i = 0; $i -lt ${secs}; $i++) {
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      # Array com o uso de CADA thread. O 'core' de antes (máximo entre as 16 threads)
      # fazia uma thread SMT a 100% virar coreMax=100 e o veredito "cpu" com a GPU ociosa.
      $threads = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '_Total' } |
        ForEach-Object { $n = 0; if ([int]::TryParse($_.Name, [ref]$n)) { [pscustomobject]@{ i = $n; v = [int]$_.PercentProcessorTime } } } |
        Sort-Object i | ForEach-Object { $_.v })
      $core = @($threads | Measure-Object -Maximum).Maximum
      # GPU: nvidia-smi primeiro (o contador do Windows subestima de 3 a 12 vezes;
      # medido: 12% no contador quando a GPU estava em 36%, e 2% quando estava em 23%).
      $g = 0
      $smi = (Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source
      if (-not $smi -and (Test-Path 'C:\Windows\System32\nvidia-smi.exe')) { $smi = 'C:\Windows\System32\nvidia-smi.exe' }
      if ($smi) {
        try { $sv = & $smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1; if ($sv) { $g = [int]([string]$sv).Trim() } } catch { }
      }
      if ($g -eq 0) {
        $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'engtype_3D' } | Measure-Object -Property UtilizationPercentage -Sum).Sum
      }
      $os = Get-CimInstance Win32_OperatingSystem
      $ramPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100)
      $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB)
      $samples += @{ cpu=[int]$cpu; core=[int]$core; cores=@($threads); gpu=[int][math]::Min(100, $g); ram=[int]$ramPct; ramGb=$ramTotal }
      Start-Sleep -Seconds 1
    }
    Write-Output (Json $samples)`, (secs * 3 + 60) * 1000);
  let samples = [];
  try { const j = JSON.parse(r.out); samples = Array.isArray(j) ? j : [j]; } catch (e) {}
  if (!samples.length) return { success: false, error: 'não foi possível medir' };
  const avg = (k) => Math.round(samples.reduce((a, b) => a + (b[k] || 0), 0) / samples.length);
  const max = (k) => Math.max(...samples.map((b) => b[k] || 0));
  // Uso de CPU por NÚCLEO FÍSICO, não por thread.
  //
  // PerfOS_Processor tem uma instância por thread (16 para 8 núcleos). Uma thread SMT a
  // 100% fazia coreMax=100 e o veredito virava 'cpu' com a GPU a 1%. Medido: 1 thread
  // presa na CPU0 dava coreMax=100 em 12/12 amostras com o total em 46%.
  //
  // Aqui as threads são agrupadas duas a duas (CPU0+CPU1 = núcleo 0), tira-se a média de
  // cada núcleo e o maior é o coreMax. Medido: ocioso 51, 1 thread 100% -> 64,
  // 16 threads 100% -> 98. Somar as duas threads NÃO serve (o Windows não mantém
  // t0+t1=100; testado, dava 98 ocioso).
  const cpu = avg('cpu'), gpu = avg('gpu'), ram = max('ram');
  let coreMax = max('core');
  const comThreads = samples.filter((am) => Array.isArray(am.cores) && am.cores.length >= 2);
  if (comThreads.length) {
    const nThreads = comThreads[0].cores.length;
    const pares = Math.floor(nThreads / 2);
    let pior = 0;
    for (let k = 0; k < pares; k++) {
      let soma = 0, cont = 0;
      for (const am of comThreads) {
        soma += (Number(am.cores[k * 2]) || 0) + (Number(am.cores[k * 2 + 1]) || 0);
        cont += 2;
      }
      if (cont) { const media = Math.round(soma / cont); if (media > pior) pior = media; }
    }
    if (pior > 0) coreMax = pior;
  }
  const ramGb = samples[0].ramGb || null;
  const gpuBound = gpu >= 90;
  const cpuBound = !gpuBound && (coreMax >= 90 || cpu >= 75);
  const ramBound = !gpuBound && !cpuBound && ram >= 90;
  const verdict = gpuBound ? 'gpu' : cpuBound ? 'cpu' : ramBound ? 'ram' : 'balanced';
  let game = null;
  if (pid) { try { const g = await core.ps(`$p = Get-Process -Id ${parseInt(pid, 10)} -ErrorAction SilentlyContinue; if ($p) { Write-Output $p.ProcessName }`); game = g.out.split('\n')[0].trim() || null; } catch (e) {} }
  const dicas = {
    gpu: 'Para mais FPS: ative DLSS, FSR ou XeSS, baixe a resolução ou as sombras e reflexos.',
    cpu: 'No jogo: limite o FPS e reduza o que pesa no processador (distância de visão, multidões, física).',
    ram: 'Feche navegador e apps pesados antes de jogar; confira se a memória virtual está no automático.',
    balanced: 'PC equilibrado: nenhuma peça está no limite. Se quiser mais FPS, o caminho é reduzir gráficos.',
  };
  return { success: true, game, seconds: secs, samples: samples.length, cpu, coreMax, gpu, ram, ramGb, verdict, dica: dicas[verdict], meters: { cpu, core: coreMax, gpu } };
};
// ────────────────────────────── OPTISCALER ──────────────────────────────
// Instalação real: baixa o release (.7z), extrai com 7zr, copia TUDO para a pasta do jogo,
// renomeia OptiScaler.dll para o proxy escolhido (dxgi.dll por padrão) e guarda backup de tudo.
const OPTI_DIR = () => path.join(APP_DATA(), 'optiscaler');
const OPTI_JSON = () => path.join(APP_DATA(), 'opti.json');
function optiStore() { try { return JSON.parse(fs.readFileSync(OPTI_JSON(), 'utf8')); } catch (e) { return { installs: [], pkg: null }; } }
function optiSave(s) { try { fs.mkdirSync(APP_DATA(), { recursive: true }); fs.writeFileSync(OPTI_JSON(), JSON.stringify(s, null, 1)); } catch (e) {} }

const OPTI_PROXIES = ['dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'];
const ANTI_CHEAT = ['valorant', 'cs2', 'fortnite', 'warzone', 'cod', 'call of duty', 'fivem', 'r5apex', 'apex', 'destiny2', 'rainbowsix', 'deadbydaylight', 'rust', 'pubg', 'tarkov', 'overwatch', 'thefinals', 'xdefiant', 'bf2042'];

function httpsGet(url, cb, redirects = 0) {
  const https = require('https');
  if (redirects > 6) return cb(new Error('redirect loop'), null);
  https.get(url, { headers: { 'User-Agent': 'VL-Optimizer', Accept: '*/*' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return httpsGet(new URL(res.headers.location, url).toString(), cb, redirects + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode), null); }
    cb(null, res);
  }).on('error', (e) => cb(e, null));
}

function downloadTo(url, dest) {
  return new Promise((resolve) => {
    httpsGet(url, (err, res) => {
      if (err) return resolve({ success: false, error: err.message });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve({ success: true, size: fs.statSync(dest).size }); });
      out.on('error', (e) => resolve({ success: false, error: e.message }));
    });
  });
}

async function ensure7zr() {
  const bin = path.join(APP_DATA(), 'bin');
  const f = path.join(bin, '7zr.exe');
  if (fs.existsSync(f) && fs.statSync(f).size > 100000) return f;
  fs.mkdirSync(bin, { recursive: true });
  const r = await downloadTo('https://www.7-zip.org/a/7zr.exe', f);
  return r.success ? f : null;
}

async function extractPkg(pkgFile, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (/\.7z$/i.test(pkgFile)) {
    const z = await ensure7zr();
    if (!z) return { success: false, error: 'não foi possível baixar o extrator 7zr' };
    const r = await core.ps(`& '${z.replace(/'/g, "''")}' x -y '-o${dest.replace(/'/g, "''")}' '${pkgFile.replace(/'/g, "''")}' | Out-Null; Write-Output 'ok'`, 300000);
    if (!r.ok || !fs.existsSync(path.join(dest, 'OptiScaler.dll'))) return { success: false, error: 'falha ao extrair o .7z' };
    return { success: true };
  }
  const r = await core.ps(`Expand-Archive -LiteralPath '${pkgFile.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force; Write-Output 'ok'`, 300000);
  if (!r.ok) return { success: false, error: 'falha ao extrair o .zip' };
  return { success: true };
}

ex.optiStatus = async () => {
  const st = optiStore();
  const caps = await core.getCaps();
  return { success: true, nvidia: !!caps.nvidia, pkg: st.pkg ? { tag: st.pkg.tag } : null, dl: { running: false, pct: 0 }, installs: st.installs || [] };
};

ex.optiDownload = async () => {
  const st = optiStore();
  const dir = OPTI_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const api = await new Promise((resolve) => {
    httpsGet('https://api.github.com/repos/optiscaler/OptiScaler/releases/latest', (err, res) => {
      if (err) return resolve({ success: false, error: err.message });
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => { try { resolve({ success: true, json: JSON.parse(body) }); } catch (e) { resolve({ success: false, error: 'resposta inválida' }); } });
    });
  });
  if (!api.success) return { success: false, error: api.error };
  const asset = (api.json.assets || []).find((a) => /\.(7z|zip)$/i.test(a.name));
  if (!asset) return { success: false, error: 'release sem pacote .7z/.zip' };
  const ext = /\.7z$/i.test(asset.name) ? '.7z' : '.zip';
  const file = path.join(dir, 'OptiScaler' + ext);
  const dl = await downloadTo(asset.browser_download_url, file);
  if (!dl.success) return { success: false, error: 'download: ' + dl.error };
  st.pkg = { tag: api.json.tag_name || 'latest', file, name: asset.name, at: Date.now() };
  optiSave(st);
  return { success: true, tag: st.pkg.tag, size: dl.size, name: asset.name };
};

function scanUpscalers(dir) {
  const out = { dlss: false, fsr: false, xess: false };
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
      else {
        const n = e.name.toLowerCase();
        if (/nvngx_dlss|dlss/.test(n)) out.dlss = true;
        if (/ffx|fsr|amd_fidelityfx/.test(n)) out.fsr = true;
        if (/xess/.test(n)) out.xess = true;
      }
    }
  };
  walk(dir, 0);
  return out;
}

ex.optiAnalyze = async ({ exe }) => {
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'executável inválido' };
  const dir = path.dirname(exe);
  const name = (path.basename(exe) + ' ' + path.basename(dir)).toLowerCase();
  const antiCheat = ANTI_CHEAT.filter((a) => name.includes(a));
  const upscalers = scanUpscalers(dir);
  const st = optiStore();
  const installed = (st.installs || []).find((i) => i.dir === dir);
  const existing = OPTI_PROXIES.find((d) => fs.existsSync(path.join(dir, d)));
  return { success: true, exe, dir, installed: !!installed, block: antiCheat.length > 0, antiCheat, upscalers, existingProxy: existing || null, notes: [] };
};

ex.optiDetect = async () => {
  const r = await core.ps(`$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 1; if ($p) { Write-Output $p.Path }`);
  const exe = r.out.split('\n')[0].trim();
  if (!exe) return { success: false, error: 'Nenhum jogo aberto agora.' };
  return ex.optiAnalyze({ exe });
};

ex.optiBrowse = async () => {
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog({ title: 'Escolha o .exe do jogo', filters: [{ name: 'Executáveis', extensions: ['exe'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  return ex.optiAnalyze({ exe: res.filePaths[0] });
};

function copyTree(srcRoot, dstRoot, skip, created) {
  const walk = (rel) => {
    const src = path.join(srcRoot, rel);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      if (skip(dirName(rel))) return;
      fs.mkdirSync(path.join(dstRoot, rel), { recursive: true });
      for (const e of fs.readdirSync(src)) walk(path.join(rel, e));
    } else {
      if (skip(path.basename(rel))) return;
      const dst = path.join(dstRoot, rel);
      if (fs.existsSync(dst)) {
        const bak = dst + '.lopt-backup';
        if (!fs.existsSync(bak)) { fs.renameSync(dst, bak); created.backups.push({ orig: dst, bak }); }
        else fs.rmSync(dst, { force: true });
      }
      fs.copyFileSync(src, dst);
      created.files.push(dst);
    }
  };
  const dirName = (r) => path.basename(r || '').toLowerCase();
  for (const e of fs.readdirSync(srcRoot)) walk(e);
}

ex.optiInstall = async ({ exe, dll, opts, acceptAntiCheat }) => {
  const st = optiStore();
  if (!st.pkg || !fs.existsSync(st.pkg.file)) return { success: false, error: 'Baixe o OptiScaler primeiro.' };
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'Escolha o .exe do jogo.' };
  const a = await ex.optiAnalyze({ exe });
  if (a && a.block && !acceptAntiCheat) {
    return { success: false, error: 'Este jogo usa anti-cheat (' + a.antiCheat.join(', ') + '). Instalar DLLs nele pode dar ban — só faça isso em modo offline e por sua conta.' };
  }
  const dir = path.dirname(exe);
  try {
    const probe = path.join(dir, '.lopt-write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (e) { return { success: false, error: 'Sem permissão de escrita na pasta do jogo. Rode o VL como administrador.' }; }
  const proxy = OPTI_PROXIES.includes(String(dll)) ? String(dll) : 'dxgi.dll';
  const tmp = path.join(OPTI_DIR(), 'unz');
  try {
    const ext = await extractPkg(st.pkg.file, tmp);
    if (!ext.success) return ext;
    const created = { files: [], backups: [] };
    copyTree(tmp, dir, (n) => /^(setup_windows\.bat|setup_linux\.sh|readme.*\.txt)$/i.test(n) || /^!!/.test(n), created);
    // renomeia OptiScaler.dll para o proxy escolhido
    const optiDll = path.join(dir, 'OptiScaler.dll');
    const target = path.join(dir, proxy);
    if (!fs.existsSync(optiDll)) return { success: false, error: 'OptiScaler.dll não veio no pacote' };
    if (fs.existsSync(target)) {
      const bak = target + '.lopt-backup';
      if (!fs.existsSync(bak)) { fs.renameSync(target, bak); created.backups.push({ orig: target, bak }); }
      else fs.rmSync(target, { force: true });
    }
    fs.renameSync(optiDll, target);
    created.files.push(target);
    created.files = created.files.filter((f) => f !== optiDll);

    // ini: usa o do pacote e só mexe em chaves documentadas
    const ini = path.join(dir, 'OptiScaler.ini');
    if (fs.existsSync(ini)) {
      let txt = fs.readFileSync(ini, 'utf8');
      const setKey = (k, v) => { txt = txt.replace(new RegExp('^' + k + '=.*$', 'm'), k + '=' + v); };
      if (opts && opts.upscaler && opts.upscaler !== 'auto') { setKey('Dx12Upscaler', opts.upscaler); }
      if (opts && opts.fg != null) { txt = txt.replace(/^Enabled=.*$/m, 'Enabled=' + (opts.fg ? 'true' : 'false')); }
      if (opts && opts.spoof === false) setKey('Dxgi', 'false');
      fs.writeFileSync(ini, txt, 'utf8');
    }
    st.installs = st.installs || [];
    st.installs.push({ dir, exe, tag: st.pkg.tag, dll: proxy, at: Date.now(), opts: opts || {}, files: created.files, backups: created.backups });
    optiSave(st);
    return { success: true, dir, dll: proxy, files: created.files.length, backups: created.backups.length };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiUninstall = async ({ dir }) => {
  const st = optiStore();
  const i = (st.installs || []).find((x) => x.dir === dir);
  if (!i) return { success: false, error: 'não instalado' };
  try {
    for (const f of i.files || []) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (e) {} }
    for (const b of i.backups || []) { try { if (fs.existsSync(b.bak)) { if (fs.existsSync(b.orig)) fs.rmSync(b.orig, { force: true }); fs.renameSync(b.bak, b.orig); } } catch (e) {} }
    for (const d of ['D3D12_Optiscaler', 'Licenses', 'DlssOverrides']) { try { fs.rmSync(path.join(dir, d), { recursive: true, force: true }); } catch (e) {} }
    st.installs = st.installs.filter((x) => x.dir !== dir);
    optiSave(st);
    return { success: true, restored: (i.backups || []).length };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiConfig = async ({ dir, opts }) => {
  const st = optiStore();
  const i = (st.installs || []).find((x) => x.dir === dir);
  if (!i) return { success: false, error: 'não instalado' };
  Object.assign(i.opts, opts || {});
  const ini = path.join(dir, 'OptiScaler.ini');
  try {
    if (fs.existsSync(ini)) {
      let txt = fs.readFileSync(ini, 'utf8');
      const setKey = (k, v) => { txt = txt.replace(new RegExp('^' + k + '=.*$', 'm'), k + '=' + v); };
      if (i.opts.upscaler && i.opts.upscaler !== 'auto') setKey('Dx12Upscaler', i.opts.upscaler);
      if (i.opts.fg != null) txt = txt.replace(/^Enabled=.*$/m, 'Enabled=' + (i.opts.fg ? 'true' : 'false'));
      if (i.opts.spoof === false) setKey('Dxgi', 'false');
      fs.writeFileSync(ini, txt, 'utf8');
    }
    optiSave(st);
    return { success: true, opts: i.opts, running: false };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiOpenFolder = ({ dir }) => { try { require('electron').shell.openPath(dir); return { success: true }; } catch (e) { return { success: false }; } };


// ────────────────────────────── SCALING (Lossless Scaling) ──────────────────────────────
// O motor é o Lossless Scaling instalado pelo usuário (Steam). A janela VL Scaling lê e grava
// as opções no Settings.xml dele e abre o executável minimizado.
const LS_EXE = 'LosslessScaling.exe';
const LS_DIR = 'Lossless Scaling';
const lsSettingsPath = () => {
  const base = path.join(os.homedir(), 'AppData', 'Local');
  try {
    for (const d of fs.readdirSync(base)) {
      if (!/lossless/i.test(d)) continue;
      const f = path.join(base, d, 'Settings.xml');
      if (fs.existsSync(f)) return f;
    }
  } catch (e) {}
  return path.join(base, LS_DIR, 'Settings.xml');
};
const lsBackupPath = () => path.join(APP_DATA(), 'lossless-settings.backup.xml');
const scalingCfg = () => readJson('scaling.json', { engine: '', config: {} });
const saveScaling = (v) => writeJson('scaling.json', v);

function steamLibs() {
  const out = [];
  try {
    if (steamRoot) {
      out.push(steamRoot);
      const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
    }
  } catch (e) {}
  return out;
}

async function lsDetect(force) {
  const c = scalingCfg();
  if (!force && c.engine && fs.existsSync(c.engine)) return c.engine;
  if (!steamRoot) { try { await ex.initSteam(); } catch (e) {} }
  const cands = [];
  if (c.engine) cands.push(c.engine);
  cands.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  cands.push('C:\\Program Files\\Steam\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  for (const lib of steamLibs()) cands.push(path.join(lib, 'steamapps', 'common', LS_DIR, LS_EXE));
  for (const d of ['D', 'E', 'F', 'G']) cands.push(d + ':\\SteamLibrary\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  for (const p of cands) {
    if (p && fs.existsSync(p)) { if (c.engine !== p) { c.engine = p; saveScaling(c); } return p; }
  }
  return null;
}

// Literais EXATOS dos enums do Lossless 3.2.2 (extraídos do binário).
const LS_FG = { lsfg31: 'LSFG3', lsfg23: 'LSFG2', lsfg11: 'LSFG1', off: 'Off' };
const LS_SCALING = { off: 'Off', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'Integer', nearest: 'Nearest', xbr: 'XBR', anime4k: 'Anime4K' };
const LS_FSR = { fsr1: 'ORIGINAL', fsr2: 'ORIGINAL', fsr3: 'ORIGINAL', original: 'ORIGINAL', optimized: 'OPTIMIZED' };
const LS_FIT = { fullscreen: 'Fullscreen', stretch: 'AspectRatio', fit: 'AspectRatio' };
const LS_SYNC = { standard: 'DEFAULT', vsync: 'VSYNC1', gsync: 'VSYNC2', adaptive: 'VSYNC3' };
const LS_MODE = { auto: 'Auto', custom: 'Custom' };

function xmlGet(xml, name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i').exec(xml);
  return m ? m[1].trim() : null;
}
// grava SÓ o literal exato (sem inferir maiúsculas): os enums são case-sensitive.
function xmlSet(xml, name, value) {
  const re = new RegExp('(<' + name + '>)([^<]*)(</' + name + '>)');
  if (re.test(xml)) return xml.replace(re, '$1' + String(value) + '$3');
  const idx = xml.lastIndexOf('</');
  if (idx < 0) return xml;
  return xml.slice(0, idx) + '<' + name + '>' + String(value) + '</' + name + '>\n' + xml.slice(idx);
}
function setInBlock(block, name, value) {
  const wrapped = '<r>' + block + '</r>';
  const out = xmlSet(wrapped, name, value);
  return out.slice(3, -4);
}

function lsParse(xml) {
  const g = (n) => xmlGet(xml, n);
  const b = (n) => /true/i.test(g(n) || '');
  const num = (n) => { const v = g(n); return v == null || v === '' ? null : Number(v); };
  const fg = g('FrameGeneration');
  const st = g('ScalingType');
  const sync = g('SyncMode');
  const ST_NORM = { Off: 'OFF', LS1: 'LS1', FSR: 'FSR', NIS: 'NIS', Integer: 'INTEGER', Nearest: 'NN', XBR: 'XBR', Anime4K: 'ANIME4K', SGSR: 'SGSR', BicubicCAS: 'BICUBICCAS', SharpBilinear: 'SHARPBILINEAR' };
  const SYNC_NORM = { DEFAULT: 'STANDARD', VSYNC1: 'VSYNC', VSYNC2: 'GSYNC', VSYNC3: 'ADAPTIVE', VSYNC4: 'ADAPTIVE', OFF: 'OFF' };
  return {
    FrameGeneration: fg ? String(fg).toUpperCase() : null,
    LSFG3Mode1: g('LSFG3Mode1'),
    LSFG3Multiplier: num('LSFG3Multiplier'),
    LSFG3Target: num('LSFG3Target'),
    LSFGFlowScale: num('LSFGFlowScale'),
    LSFGSize: g('LSFGSize'),
    LSFG2Mode: g('LSFG2Mode'),
    CaptureApi: g('CaptureApi'),
    QueueTarget: num('QueueTarget'),
    MaxFrameLatency: num('MaxFrameLatency'),
    ScalingType: st ? (ST_NORM[st] || String(st).toUpperCase()) : null,
    FSRType: g('FSRType') === 'OPTIMIZED' ? 'OPTIMIZED' : 'ORIGINAL',
    Sharpness: num('Sharpness'),
    ScalingMode: g('ScalingMode'),
    ScaleFactor: num('ScaleFactor'),
    ScalingFitMode: g('ScalingFitMode'),
    SyncMode: sync ? (SYNC_NORM[sync] || 'STANDARD') : null,
    GsyncSupport: b('GsyncSupport'),
    HdrSupport: b('HdrSupport'),
    AutoScale: b('AutoScale'),
    AutoScaleDelay: num('AutoScaleDelay'),
    ScaleCursor: b('ScaleCursor'),
    VRS: b('VRS'),
    WindowedMode: b('WindowedMode'),
    ResizeBeforeScaling: b('ResizeBeforeScaling'),
    StartAsAdmin: b('StartAsAdmin'),
    MinimizeToTray: b('MinimizeToTray'),
  };
}

function lsProfileParts(xml) {
  const gp = /<GameProfiles>([\s\S]*?)<\/GameProfiles>/.exec(xml);
  if (!gp) return null;
  const inner = gp[1];
  const blocks = [...inner.matchAll(/<Profile>([\s\S]*?)<\/Profile>/g)];
  for (const m of blocks) {
    const path = xmlGet(m[1], 'Path');
    if (path == null || path === '') return { inner, block: m[1], has: true };
  }
  return { inner, block: null, has: false };
}

function lsDefaultXml() {
  const isPt = (() => { try { return require('electron').app.getLocale().toLowerCase().startsWith('pt'); } catch (e) { return false; } })();
  const title = isPt ? 'Padrão' : 'Default';
  return '<Profile>\n      <Title>' + title + '</Title>\n      <AutoScale>false</AutoScale>\n      <AutoScaleDelay>0</AutoScaleDelay>\n      <ScalingMode>Auto</ScalingMode>\n      <ScalingFitMode>AspectRatio</ScalingFitMode>\n      <ScaleFactor>1.5</ScaleFactor>\n      <ResizeBeforeScaling>false</ResizeBeforeScaling>\n      <WindowedMode>false</WindowedMode>\n      <ScalingType>Off</ScalingType>\n      <FSRType>ORIGINAL</FSRType>\n      <LS1Type>BALANCED</LS1Type>\n      <LSFG2Mode>X2</LSFG2Mode>\n      <LSFG3Mode1>FIXED</LSFG3Mode1>\n      <LSFG3Multiplier>2</LSFG3Multiplier>\n      <LSFG3Target>165</LSFG3Target>\n      <LSFGFlowScale>100</LSFGFlowScale>\n      <LSFGSize>BALANCED</LSFGSize>\n      <Anime4kType>S</Anime4kType>\n      <Sharpness>5</Sharpness>\n      <LS1Sharpness>1</LS1Sharpness>\n      <VRS>false</VRS>\n      <FrameGeneration>Off</FrameGeneration>\n      <ClipCursor>true</ClipCursor>\n      <AdjustCursorSpeed>false</AdjustCursorSpeed>\n      <HideCursor>false</HideCursor>\n      <ScaleCursor>false</ScaleCursor>\n      <SyncMode>DEFAULT</SyncMode>\n      <MaxFrameLatency>3</MaxFrameLatency>\n      <GsyncSupport>true</GsyncSupport>\n      <HdrSupport>false</HdrSupport>\n      <DrawFps>true</DrawFps>\n      <CaptureApi>DXGI</CaptureApi>\n      <QueueTarget>1</QueueTarget>\n      <PreferredGpuId>0</PreferredGpuId>\n      <OutputDisplayId>0</OutputDisplayId>\n      <CropInput>false</CropInput>\n      <CropInputLeft>0</CropInputLeft>\n      <CropInputTop>0</CropInputTop>\n      <CropInputRight>0</CropInputRight>\n      <CropInputBottom>0</CropInputBottom>\n      <MultiDisplayMode>false</MultiDisplayMode>\n    </Profile>';
}

const LS_SKELETON = (profile) => '<?xml version="1.0" encoding="utf-8"?>\n<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
  '  <WindowMaximized>false</WindowMaximized>\n  <WindowHeight>650</WindowHeight>\n  <WindowWidth>1150</WindowWidth>\n  <ProfileListWidth>250</ProfileListWidth>\n' +
  '  <Hotkey>S</Hotkey>\n  <HotkeyModifierKeys>Alt Control</HotkeyModifierKeys>\n  <GpuPreference>0</GpuPreference>\n  <GpuPreferenceChangeCount>0</GpuPreferenceChangeCount>\n' +
  '  <SetupPhase>0</SetupPhase>\n  <StartAsAdmin>false</StartAsAdmin>\n  <StartAtWindowsStartup>false</StartAtWindowsStartup>\n  <MinimizeToTray>false</MinimizeToTray>\n' +
  '  <CloseToTray>false</CloseToTray>\n  <Language>System</Language>\n  <Theme>System</Theme>\n' +
  '  <FrameGenerationCollapsed>false</FrameGenerationCollapsed>\n  <CursorOptionsCollapsed>false</CursorOptionsCollapsed>\n  <RenderingOptionsCollapsed>false</RenderingOptionsCollapsed>\n' +
  '  <CaptureOptionsCollapsed>false</CaptureOptionsCollapsed>\n  <GpuDisplayOptionsCollapsed>false</GpuDisplayOptionsCollapsed>\n  <CropInputOptionsCollapsed>false</CropInputOptionsCollapsed>\n' +
  '  <BehaviorCollapsed>false</BehaviorCollapsed>\n  <LegacyOptionsCollapsed>false</LegacyOptionsCollapsed>\n' +
  '  <GameProfiles>\n    ' + profile + '\n  </GameProfiles>\n</Settings>\n';

function lsWrite(cfg) {
  const file = lsSettingsPath();
  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  if (!xml) xml = LS_SKELETON(lsDefaultXml());
  else { try { fs.copyFileSync(file, lsBackupPath()); } catch (e) {} }

  let firstRun = false;
  const parts = lsProfileParts(xml);
  if (!parts) {
    // arquivo existe mas sem GameProfiles: monta o esqueleto
    xml = LS_SKELETON(lsDefaultXml());
    firstRun = true;
  }
  const parts2 = lsProfileParts(xml);
  let block = parts2.block || lsDefaultXml();
  const applied = [];
  const skipped = [];
  const put = (name, val) => {
    if (val === undefined || val === null || val === '') { skipped.push(name); return; }
    block = setInBlock(block, name, val);
    applied.push(name);
  };

  if (cfg.fgType != null) put('FrameGeneration', LS_FG[cfg.fgType]);
  if (cfg.lsfg3Mode != null) put('LSFG3Mode1', cfg.lsfg3Mode === 'adaptive' ? 'ADAPTIVE' : 'FIXED');
  if (cfg.lsfg3Multiplier != null) put('LSFG3Multiplier', Math.round(cfg.lsfg3Multiplier));
  if (cfg.lsfg3Target != null) put('LSFG3Target', Math.round(cfg.lsfg3Target));
  if (cfg.flowScale != null) put('LSFGFlowScale', Math.round(Number(cfg.flowScale) * 100));
  if (cfg.perfMode != null) put('LSFGSize', cfg.perfMode ? 'PERFORMANCE' : 'BALANCED');
  if (cfg.captureApi != null) put('CaptureApi', cfg.captureApi === 'wgc' ? 'WGC' : 'DXGI');
  if (cfg.queueTarget != null) { put('QueueTarget', Math.round(cfg.queueTarget)); put('MaxFrameLatency', Math.min(16, Math.max(1, Math.round(cfg.queueTarget)))); }
  if (cfg.scaleType != null) put('ScalingType', LS_SCALING[cfg.scaleType]);
  if (cfg.fsrType != null) put('FSRType', LS_FSR[cfg.fsrType] || 'ORIGINAL');
  if (cfg.sharpness != null) put('Sharpness', Math.round(Number(cfg.sharpness) / 10));
  if (cfg.scaleMode != null) put('ScalingMode', LS_MODE[cfg.scaleMode] || 'Auto');
  if (cfg.scaleFactor != null) put('ScaleFactor', Number(cfg.scaleFactor).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  if (cfg.fitMode != null) put('ScalingFitMode', LS_FIT[cfg.fitMode] || 'AspectRatio');
  if (cfg.syncMode != null) { put('SyncMode', LS_SYNC[cfg.syncMode] || 'DEFAULT'); put('GsyncSupport', cfg.syncMode === 'gsync' ? 'true' : 'false'); }
  if (cfg.hdrCompat != null) put('HdrSupport', cfg.hdrCompat ? 'true' : 'false');
  if (cfg.resizeBefore != null) put('ResizeBeforeScaling', cfg.resizeBefore ? 'true' : 'false');
  if (cfg.scaleCursor != null) put('ScaleCursor', cfg.scaleCursor ? 'true' : 'false');
  if (cfg.vrs != null) put('VRS', cfg.vrs ? 'true' : 'false');
  if (cfg.autoScale != null) put('AutoScale', cfg.autoScale ? 'true' : 'false');
  if (cfg.autoDelay != null) put('AutoScaleDelay', Math.round(cfg.autoDelay));
  if (cfg.windowedMode != null) put('WindowedMode', cfg.windowedMode ? 'true' : 'false');
  if (cfg.drawFps != null) put('DrawFps', cfg.drawFps ? 'true' : 'false');

  let inner;
  if (parts2.has) {
    inner = parts2.inner.replace(parts2.block, block);
  } else {
    inner = parts2.inner.trim() === '' ? '\n    ' + block + '\n  ' : parts2.inner + '\n    ' + block + '\n  ';
  }
  let out = xml.replace(parts2.inner, inner);
  if (cfg.startAsAdmin != null) out = xmlSet(out, 'StartAsAdmin', cfg.startAsAdmin ? 'true' : 'false');

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out, 'utf8');
    const cur = lsParse((lsProfileParts(out) || {}).block || out);
    return { success: true, applied: applied.length, skipped, firstRun, file, settings: cur };
  } catch (e) {
    return { success: false, error: 'Não foi possível gravar o Settings.xml: ' + e.message, applied: 0, skipped };
  }
}

function lsRecommended() {
  return {
    FrameGeneration: 'LSFG3', LSFG3Mode1: 'ADAPTIVE', LSFG3Multiplier: 2, LSFG3Target: 100, LSFGFlowScale: 100,
    LSFGSize: 'DEFAULT', CaptureApi: 'DXGI', QueueTarget: 1, ScalingType: 'NIS', FSRType: 'ORIGINAL',
    Sharpness: 50, ScalingMode: 'Auto', ScaleFactor: 1.5, ScalingFitMode: 'FULLSCREEN', SyncMode: 'DEFAULT',
    HdrSupport: false, AutoScale: true, ScaleCursor: true, VRS: false, WindowedMode: false, ResizeBeforeScaling: false,
  };
}

ex.lsSettingsPath = lsSettingsPath;
ex.lsRead = () => {
  const file = lsSettingsPath();
  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  return { file, exists: !!xml, settings: xml ? lsParse(xml) : null };
};
ex.lsConfig = (cfg) => {
  if (cfg && typeof cfg === 'object') {
    const r = lsWrite(cfg);
    if (r.success) {
      const c = scalingCfg();
      c.config = cfg;
      saveScaling(c);
    }
    return r;
  }
  const cur = ex.lsRead();
  return {
    success: true,
    configured: cur.exists,
    needsFirstRun: !cur.exists,
    current: cur.exists ? cur.settings : lsRecommended(),
    recommended: lsRecommended(),
    file: cur.file,
    engine: scalingCfg().engine || null,
  };
};

ex.lsFind = async () => {
  const p = await lsDetect(false);
  return p ? { path: p } : null;
};
ex.lsBrowse = async () => {
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog({ title: 'Escolha o LosslessScaling.exe', filters: [{ name: 'Executáveis', extensions: ['exe'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const c = scalingCfg(); c.engine = res.filePaths[0]; saveScaling(c);
  return { path: res.filePaths[0] };
};
ex.lsRunning = async () => {
  const r = await core.ps(`$p = @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue); Write-Output $p.Count`);
  return (parseInt(r.out, 10) || 0) > 0;
};
ex.lsLaunch = async (cfg) => {
  const exePath = await lsDetect(true);
  if (!exePath) return { success: false, error: 'Lossless Scaling não encontrado. Instale pela Steam (ou escolha o .exe na engrenagem).' };

  let applied = null;
  if (cfg && typeof cfg === 'object') {
    applied = lsWrite(cfg);
    if (!applied.success) return { success: false, error: applied.error || 'Falha ao gravar o Settings.xml.' };
    const cc = scalingCfg(); cc.config = cfg; cc.settingsRejected = false; saveScaling(cc);
  }

  // fecha a instância antiga (precisa de admin) e espera o processo sumir antes de abrir de novo
  try {
    await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`, 20000);
    for (let i = 0; i < 20; i++) {
      const alive = await core.ps(`Write-Output @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue).Count`, 8000);
      if ((parseInt(alive.out, 10) || 0) === 0) break;
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (e) {}

  // abre pelo shell (CreateProcess direto faz o Lossless crashar; ShellExecute não)
  try {
    const { shell } = require('electron');
    const err = await shell.openPath(exePath);
    if (err) return { success: false, error: 'Não foi possível abrir o Lossless: ' + err };
    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);
    // confere 9s depois se o engine aceitou (ele reescreve o arquivo com os valores dele)
    setTimeout(async () => {
      try {
        const cur = ex.lsRead();
        if (!cur.exists || !cur.settings) return;
        const want = applied && applied.settings ? applied.settings.FrameGeneration : null;
        if (want && cur.settings.FrameGeneration && String(cur.settings.FrameGeneration).toUpperCase() !== String(want).toUpperCase()) {
          const cc = scalingCfg(); cc.settingsRejected = true; saveScaling(cc);
        }
      } catch (e) {}
    }, 9000);
    return { success: true, engine: exePath, applied: applied ? applied.applied : 0, message: applied && applied.applied ? 'Opções aplicadas no Lossless.' : undefined };
  } catch (e) {
    return { success: false, error: 'Falha ao abrir o Lossless: ' + e.message };
  }
};
ex.lsStop = async () => {
  const r = await core.ps(`$alive = @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue); $alive | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Write-Output @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue).Count`, 20000);
  const left = parseInt(r.out, 10) || 0;
  if (left > 0) return { success: false, error: 'O Lossless está aberto como administrador. Feche ele ou abra o VL como admin.' };
  return { success: true };
};
ex.lsStatus = async () => ({ running: await ex.lsRunning(), engine: scalingCfg().engine || null, needsFirstRun: !ex.lsRead().exists });

// ────────────────────────────── MISC ──────────────────────────────
// Perfil da conta logada, no formato que o plano.js espera:
//   { plan: 'pro'|'free', features: ['*'] | [...], lifetime, licenseExpiresAt, email, username }
//
// Antes devolvia 'pro' fixo: todo mundo tinha tudo liberado e o plano pago não valia nada.
// Agora lê do Supabase. Sem login (ou sem as chaves configuradas), devolve grátis.
//
// O app desktop já sabe o plano pelo canal conta-plano; esta função existe porque o
// plano.js do src/ chama window.gdzOpt.getUser() direto.
ex.getUser = async () => {
  try {
    const conta = require('./supabase');
    const p = await conta.perfil();
    if (p) {
      return {
        username: p.name || os.userInfo().username,
        email: p.email || (os.userInfo().username + '@local'),
        plan: p.plan === 'pro' ? 'pro' : 'free',
        lifetime: !!p.lifetime,
        licenseExpiresAt: p.validade || null,
        features: Array.isArray(p.features) && p.features.length ? p.features : (p.plan === 'pro' ? ['*'] : ['painel']),
      };
    }
  } catch (e) { }
  // sem conta: grátis, só o painel
  return {
    username: os.userInfo().username,
    email: os.userInfo().username + '@local',
    plan: 'free',
    lifetime: false,
    licenseExpiresAt: null,
    features: ['painel'],
  };
};
ex.getBackups = () => Object.keys(core.loadBackups());
ex.restoreAll = async () => {
  const b = core.loadBackups();
  const names = Object.keys(b);
  let n = 0;
  for (const k of names) {
    const r = await core.restoreBackup(k);
    if (r.success) n++;
  }
  return { success: true, count: n, message: `Configurações restauradas (${n} otimiza${n === 1 ? 'ção' : 'ões'}).` };
};
ex.updateStatus = () => ({ available: false, version: require('electron').app.getVersion(), current: require('electron').app.getVersion() });
// Planos vendidos, no formato que o src/plano.js espera.
//
// O consumidor le offers.plans (plano.js:104/120). Antes esta funcao devolvia
// offers.offers, entao o modal de planos nunca mostrava preco.
//
// Tambem chamava /api/planos, que nao existe no site (HTTP 404): eram 200 ms de
// espera a cada abertura para cair sempre no fallback. Agora o valor vai direto,
// com os mesmos precos praticados no site.
ex.offers = async () => ({
  plans: [
    { id: 'mensal', nome: 'Mensal', price: 40, priceCents: 4000, periodo: '/mes', dias: 30, destaque: false },
    { id: 'vitalicio', nome: 'Vitalicio', price: 99, priceCents: 9900, periodo: 'pagamento unico', dias: null, destaque: true },
  ],
});
ex.telemetryConsent = () => ({ consented: true });
// Resgate de chave: a validação fica no banco (chave inexistente, já usada ou cancelada).
// O supabase.js é carregado sob demanda para não travar o motor quando não há login.
ex.resgatarChave = async (codigo) => {
  try {
    const conta = require('./supabase');
    return await conta.resgatarChave(codigo);
  } catch (e) {
    return { ok: false, erro: 'Não foi possível resgatar: ' + e.message };
  }
};
ex.claimKey = (codigo) => ex.resgatarChave(codigo);
// Verifica o autostart E se o caminho gravado aponta para este mesmo executável.
//
// Antes só perguntava "a chave existe?". Uma chave apontando para uma instalação antiga
// (ou cópia portátil já apagada) respondia "ligado" e o programa nunca subia no boot.
ex.autostartGet = async () => {
  const exe = process.execPath;
  const r = await core.ps(`$v = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'VLOptimizer' -ErrorAction SilentlyContinue).VLOptimizer; if ($v) { Write-Output $v } else { Write-Output '0' }`, 20000);
  const valor = String(r.out || '').trim();
  if (!valor || valor === '0') return { success: true, on: false, caminho: null, caminhoValido: false };

  // o valor vem entre aspas seguidas dos argumentos
  const m = /^"([^"]+)"/.exec(valor) || /^([^\s]+)/.exec(valor);
  const caminho = m ? m[1] : null;
  const existe = !!caminho && fs.existsSync(caminho);
  const mesmo = !!caminho && caminho.toLowerCase() === String(exe).toLowerCase();
  return { success: true, on: existe && mesmo, caminho, caminhoValido: existe, exeAtual: exe };
};

// Corrige sozinho uma chave de autostart quebrada (aponta para exe inexistente ou antigo).
ex.autostartReparar = async () => {
  const st = await ex.autostartGet();
  if (!st.caminho) return { success: true, reparado: false, motivo: 'nao configurado' };
  if (st.on) return { success: true, reparado: false, motivo: 'ja correto' };
  const r = await ex.autostartSet(true);
  return { success: !!(r && r.success), reparado: !!(r && r.success), antes: st.caminho, depois: process.execPath };
};
ex.autostartSet = async (on) => {
  const exe = process.execPath;
  const r = await core.ps(on
    ? `Set-Val 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' 'VLOptimizer' '"${exe}" --silent' 'String'; Write-Output 'ok'`
    : `Del-Val 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' 'VLOptimizer'; Write-Output 'ok'`);
  return { success: r.ok, on: !!on };
};

core.initSteam = () => ex.initSteam();

// ------------------------------ EXTRAS DE UI ------------------------------
// Varredura de temp em segundo plano: nao bloqueia a resposta do painel.
let tempAgora = false;
let tempUltimo = null;
function agendarTemp() {
  if (tempAgora) return;
  tempAgora = true;
  setTimeout(async () => {
    try { tempUltimo = await ex.cleanTempSize(); } catch (e) { }
    tempAgora = false;
  }, 2000);
}

// Lista o que abre com o Windows: os Run do registro e as pastas Startup.
//
// Esta função nunca existiu — era chamada em main.js no canal 'startup-list' e aqui
// mesmo em recommendations(). Resultado: a página Inicialização abria com 0 itens e 0
// botões, e o card "Recomendações" do Painel dizia "Não foi possível analisar agora".
//
// O ligado/desligado vem do StartupApproved (o mesmo lugar que o Gerenciador de Tarefas
// usa): primeiro byte 2 = habilitado, 3 = desabilitado.
// Lista os PIDs de todas as instâncias do próprio app.
// Usado pela auto-elevação: antes de disparar a tarefa ele conta quem existe, e depois
// espera um PID NOVO aparecer (a instância elevada). Sem isso ele perguntava isAdmin()
// do próprio processo — que nunca vira administrador.
ex.listarPidsApp = async () => {
  try {
    const r = await core.ps('$p = @(Get-Process -Name "VL Optimizer" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); Write-Output (Json $p)', 15000);
    const j = JSON.parse(r.out);
    return Array.isArray(j) ? j : (j ? [j] : []);
  } catch (e) {
    return [process.pid];
  }
};
ex.startupList = async () => {
  const itens = [];

  for (const k of RUN_KEYS) {
    const aprovado = STORE_BY_SCOPE[k.scope] || '';
    const script = [
      '$o = @()',
      'try { $vals = Get-ItemProperty -LiteralPath ' + JSON.stringify(k.root) + ' -ErrorAction Stop } catch { Write-Output \'[]\'; return }',
      'foreach ($n in $vals.PSObject.Properties.Name) {',
      '  if ($n -match \'^(PSPath|PSParentPath|PSChildName|PSDrive|PSProvider)$\') { continue }',
      '  $val = [string]$vals.$n',
      '  $on = $true',
      '  try {',
      '    $b = (Get-ItemProperty -LiteralPath ' + JSON.stringify(aprovado) + ' -Name $n -ErrorAction Stop).$n',
      '    if ($b -is [byte[]] -and $b.Length -ge 1) { $on = ($b[0] -eq 2) }',
      '  } catch { }',
      '  $o += @{ name = $n; value = $val; enabled = $on }',
      '}',
      'Write-Output (Json $o)',
    ].join(String.fromCharCode(10));

    const r = await core.ps(script, 30000);
    let lista = [];
    try { const j = JSON.parse(r.out); lista = Array.isArray(j) ? j : (j ? [j] : []); } catch (e) { }
    for (const it of lista) {
      if (!it || !it.name) continue;
      itens.push({
        name: String(it.name),
        scope: k.scope,
        path: String(it.value || ''),
        enabled: it.enabled !== false,
        origem: k.scope === 'user-run' ? 'Registro (seu usuário)' : 'Registro (todos)',
      });
    }
  }

  for (const fd of FOLDERS) {
    let arquivos = [];
    try { arquivos = fs.readdirSync(fd.dir); } catch (e) { continue; }
    for (const arq of arquivos) {
      if (!/\.(lnk|exe|bat|cmd|url)$/i.test(arq)) continue;
      itens.push({
        name: arq.replace(/\.(lnk|exe|bat|cmd|url)$/i, ''),
        scope: fd.scope,
        path: path.join(fd.dir, arq),
        enabled: true,
        origem: fd.scope === 'user-folder' ? 'Pasta de inicialização (você)' : 'Pasta de inicialização (todos)',
      });
    }
  }

  itens.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { success: true, items: itens, total: itens.length, ligados: itens.filter((x) => x.enabled).length };
};
ex.recommendations = async () => {
  const st = await ex.startupList();
  let on = 0;
  for (const i of st.items || []) if (i.enabled) on++;
  // Nao espera a varredura de temp: devolve o ultimo valor conhecido (ou null na primeira vez) e
  // deixa a varredura rolando. A tela ja trata tempBytes null sem quebrar.
  agendarTemp();
  return { startupOn: on, tempBytes: tempUltimo };
};

// GPU dedicada por jogo (HKCU\Software\Microsoft\DirectX\UserGpuPreferences)
ex.gpuDedicated = async (gameId, on) => {
  const g = (gamesCache || []).find((x) => x.id === gameId);
  if (!g) return { success: false, error: 'jogo não encontrado' };
  const exe = g.exe || (g.dir ? findGameExe(g.dir) : '');
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'não achei o executável deste jogo para marcar a GPU dedicada.' };
  g.exe = exe;
  return ex.gpuDedicatedForExe(exe, on);
};
ex.gpuDedicatedForExe = async (exePath, on) => {
  const key = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  if (on === false) {
    const r = await core.ps(`Del-Val '${key}' '${String(exePath).replace(/'/g, "''")}'; Write-Output 'ok'`);
    return { success: r.ok, error: r.ok ? undefined : r.err };
  }
  const r = await core.ps(`Set-Val '${key}' '${String(exePath).replace(/'/g, "''")}' 'GpuPreference=2;' 'String'; Write-Output 'ok'`);
  return { success: r.ok, error: r.ok ? undefined : r.err };
};

// estado do overlay para o ticker do main
let overlayState = { on: false, pos: 0, show: {} };
ex.setOverlayState = (s) => { overlayState = Object.assign({}, overlayState, s || {}); return overlayState; };
ex.getOverlayState = () => overlayState;

module.exports = Object.assign({}, ex, { CATS, disk });
