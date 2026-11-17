// engine-extras.js — limpeza, disco, programas, jogos, PC, FPS, gargalo, OptiScaler, scaling
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const core = require('./engine');
const disco = require('./engine-disco');
const MARCA = require('./marca');

const ex = {};

// Pasta de dados DESTA marca (ver o mesmo ajuste em features.js).
const APP_DATA = () => process.env.LOPT_DATA_DIR || path.join(MARCA.dirDados, 'data');
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
//
// As 16 categorias do GDZ (CLEAN_CATS, gdz-SEM-MANGLE.js linha 4945), na mesma ordem,
// com o mesmo grupo, a mesma idade, o mesmo `top` e o mesmo padrão de ligada/desligada
// (só a Lixeira vem desmarcada). Os nomes e as descrições são as do GDZ.
//
// `t` é o PowerShell que lista os alvos, exatamente como no GDZ: ele é avaliado dentro
// de `Alvos { ... }` no script, que joga fora o que está vazio e não existe. É assim que
// o Opera GX, o Firefox (perfis), a Epic (webcache*) e a pasta de perfis do Chromium
// entram sem o JavaScript precisar adivinhar caminhos.
//
// `procs` é a trava de app aberto: mesma regra de `-like` do GDZ (`FiveM*` casa
// FiveM, FiveM_b3095_GTAProcess etc.).
const CLEAN_WEB_DESC = 'Imagens e arquivos de sites guardados. Logins, senhas, histórico e favoritos ficam.';

const CATS = [
  { id: 'temp', group: 'win', on: true, age: 1, top: true,
    name: 'Arquivos temporários',
    desc: 'Do Windows e dos programas, com mais de 1 dia. O que está em uso fica.',
    t: `@($env:TEMP, "$env:SystemRoot\\Temp") | Where-Object { $_ -match '\\\\(Temp|Tmp)(\\\\\\d+)?\\\\?$' }` },
  { id: 'recycle', group: 'win', on: false, special: 'recycle',
    name: 'Lixeira',
    desc: 'Esvazia a Lixeira de todos os discos. Depois disso não dá para recuperar o que estava nela.' },
  { id: 'crash', group: 'win', on: true, age: 0,
    name: 'Relatórios de erro e despejos de memória',
    desc: 'Relatórios de travamento que o Windows guarda depois de enviar e as cópias da memória feitas nas telas azuis.',
    note: 'Investigando uma tela azul? Desmarque para não perder o arquivo dela.',
    t: `"$env:ProgramData\\Microsoft\\Windows\\WER\\ReportArchive"; "$env:ProgramData\\Microsoft\\Windows\\WER\\ReportQueue"; "$env:ProgramData\\Microsoft\\Windows\\WER\\Temp"; "$L\\Microsoft\\Windows\\WER"; "$L\\CrashDumps"; "$env:SystemRoot\\Minidump"; "$env:SystemRoot\\MEMORY.DMP"; "$env:SystemRoot\\LiveKernelReports"` },
  { id: 'logs', group: 'win', on: true, age: 7,
    name: 'Logs antigos do Windows',
    desc: 'Registros de instalação e de atualização com mais de 7 dias. O Windows cria outros quando precisa.',
    t: `Sub "$env:SystemRoot\\Logs" @('CBS', 'DISM', 'MoSetup', 'WindowsUpdate', 'NetSetup', 'SIH', 'waasmedic', 'dosvc')` },
  { id: 'delivery', group: 'win', on: true, special: 'delivery',
    name: 'Cache de entrega de atualizações',
    desc: 'Pedaços de atualizações do Windows e da Store guardados para repassar a outros PCs. O Windows baixa de novo o que precisar.',
    t: `"$env:SystemRoot\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache"` },
  { id: 'drivers', group: 'win', on: true, age: 0,
    name: 'Instaladores de driver já usados',
    desc: 'As pastas C:\\AMD e C:\\NVIDIA, onde os instaladores de driver de vídeo e de chipset se descompactam. O driver instalado continua funcionando.',
    t: `"$env:SystemDrive\\AMD"; "$env:SystemDrive\\NVIDIA"` },
  { id: 'chrome', group: 'web', on: true, age: 0, procs: ['chrome'], app: 'o Chrome',
    name: 'Google Chrome', desc: CLEAN_WEB_DESC,
    t: `Chromium "$L\\Google\\Chrome\\User Data"` },
  { id: 'edge', group: 'web', on: true, age: 0, procs: ['msedge'], app: 'o Edge',
    name: 'Microsoft Edge', desc: CLEAN_WEB_DESC,
    note: 'O Edge costuma ficar aberto escondido. Para fechar de vez, desligue "Edge em segundo plano" em Desempenho.',
    t: `Chromium "$L\\Microsoft\\Edge\\User Data"` },
  { id: 'brave', group: 'web', on: true, age: 0, procs: ['brave'], app: 'o Brave',
    name: 'Brave', desc: CLEAN_WEB_DESC,
    t: `Chromium "$L\\BraveSoftware\\Brave-Browser\\User Data"` },
  { id: 'opera', group: 'web', on: true, age: 0, procs: ['opera'], app: 'o Opera',
    name: 'Opera', desc: CLEAN_WEB_DESC,
    t: `Chromium "$R\\Opera Software\\Opera Stable"; Chromium "$L\\Opera Software\\Opera Stable"` },
  { id: 'operagx', group: 'web', on: true, age: 0, procs: ['opera'], app: 'o Opera GX',
    name: 'Opera GX', desc: CLEAN_WEB_DESC,
    t: `Chromium "$R\\Opera Software\\Opera GX Stable"; Chromium "$L\\Opera Software\\Opera GX Stable"` },
  { id: 'firefox', group: 'web', on: true, age: 0, procs: ['firefox'], app: 'o Firefox',
    name: 'Mozilla Firefox', desc: CLEAN_WEB_DESC,
    t: `Get-ChildItem -LiteralPath "$L\\Mozilla\\Firefox\\Profiles" -Directory -Force | ForEach-Object { Sub $_.FullName @('cache2', 'startupCache', 'thumbnails', 'jumpListCache') }` },
  { id: 'discord', group: 'apps', on: true, age: 0, procs: ['Discord', 'DiscordPTB', 'DiscordCanary'], app: 'o Discord',
    name: 'Discord',
    desc: 'Imagens, vídeos e GIFs que o Discord já baixou. Ele baixa de novo o que você abrir.',
    t: `foreach ($d in 'discord', 'discordptb', 'discordcanary') { Sub "$R\\$d" $CR }` },
  { id: 'steam', group: 'apps', on: true, age: 0, procs: ['steam', 'steamwebhelper'], app: 'a Steam',
    name: 'Steam',
    desc: 'Páginas da loja e da comunidade guardadas, logs e relatórios de erro. Jogos e saves não são tocados.',
    t: `$sp = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Valve\\Steam').SteamPath; if ($sp) { Sub ($sp -replace '/', '\\') @('appcache\\httpcache', 'logs', 'dumps') }; "$L\\Steam\\htmlcache"` },
  { id: 'epic', group: 'apps', on: true, age: 0, procs: ['EpicGamesLauncher'], app: 'a Epic Games',
    name: 'Epic Games Launcher',
    desc: 'Páginas da loja guardadas e logs do launcher. Jogos não são tocados.',
    t: `Get-ChildItem -LiteralPath "$L\\EpicGamesLauncher\\Saved" -Directory -Filter 'webcache*' -Force | ForEach-Object { $_.FullName }; "$L\\EpicGamesLauncher\\Saved\\Logs"` },
  { id: 'fivem', group: 'apps', on: true, age: 0, procs: ['FiveM*'], app: 'o FiveM',
    name: 'FiveM: logs e relatórios de crash',
    desc: 'Logs e cópias da memória que o FiveM grava quando fecha com erro. O cache dos servidores fica (ele se limpa em Meus jogos).',
    t: `"$L\\FiveM\\FiveM.app\\logs"; "$L\\FiveM\\FiveM.app\\crashes"` },
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
const cleanM = { at: 0, measuring: false, index: 0, total: 0, sizes: {}, exists: {}, open: {} };

// Cabeçalho PowerShell da limpeza — cópia fiel do CLEAN_PS_HEAD do GDZ (linha 4925).
//
// `Sub`, `Chromium`, `Aberto`, `Alvos`, `Medir` e `Lixeira` são as funções que o GDZ usa
// em cada categoria. É aqui que mora metade do comportamento:
//   - `Chromium` aplica o cache nos perfis (pasta com Preferences), não só no Default;
//   - `Aberto` bloqueia quando o processo está rodando (`-like`, então 'FiveM*' funciona);
//   - `Alvos` descarta o que está vazio e o que não existe;
//   - `Medir`/`Clean` são chamados no motor C# (engine-disco.js).
const CLEAN_PS_HEAD = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$L = $env:LOCALAPPDATA; $R = $env:APPDATA',
  'function Sub($p, $names) { foreach ($n in $names) { Join-Path $p $n } }',
  "$CR = @('Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache')",
  '# Navegador Chromium: o cache de cada perfil (pasta com Preferences) e o de shaders da raiz.',
  'function Chromium($root) {',
  '  if (-not (Test-Path -LiteralPath $root)) { return }',
  "  $perfis = @($root) + @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'Preferences') } | ForEach-Object { $_.FullName })",
  '  foreach ($p in $perfis) { Sub $p $CR }',
  "  Sub $root @('ShaderCache', 'GrShaderCache', 'GraphiteDawnCache')",
  '}',
  '$rodando = @(Get-Process | ForEach-Object { $_.Name })',
  'function Aberto($nomes) { foreach ($n in $nomes) { if ($rodando | Where-Object { $_ -like $n }) { return $true } }; return $false }',
  'function Alvos($bloco) { @(@(& $bloco) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique) }',
  'function Medir($t, $idade, $topo) { $b = 0; $n = 0; foreach ($p in $t) { $m = if ($topo) { [GDZ.Disk]::MeasureTop($p, $idade) } else { [GDZ.Disk]::Measure($p, $idade) }; $b += $m[0]; $n += $m[1] }; @($b, $n) }',
  '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  "function Lixeira { @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { Join-Path $_.RootDirectory.FullName ('$Recycle.Bin\\' + $sid) } | Where-Object { Test-Path -LiteralPath $_ }) }",
].join(String.fromCharCode(10)) + String.fromCharCode(10);

// PowerShell de uma lista de nomes: @('a','b')
const psList = (nomes) => '@(' + (nomes || []).map((n) => "'" + String(n).replace(/'/g, "''") + "'").join(',') + ')';

// Mede o que há para limpar em todas as 16 categorias, num script só (cleanScanScript).
function cleanScanScript() {
  const corpo = ['$res = @()'];
  for (const c of CATS) {
    if (c.special === 'recycle') {
      corpo.push("$m = Medir (Lixeira) 0");
      corpo.push("$res += [pscustomobject]@{ id = 'recycle'; existe = $true; bytes = $m[0]; arquivos = $m[1]; aberto = $false }");
      continue;
    }
    corpo.push('$t = Alvos { ' + c.t + ' }');
    corpo.push('$m = Medir $t ' + (c.age || 0) + ' ' + (c.top ? '$true' : '$false'));
    corpo.push("$res += [pscustomobject]@{ id = '" + c.id + "'; existe = ($t.Count -gt 0); bytes = $m[0]; arquivos = $m[1]; aberto = (Aberto " + psList(c.procs) + ') }');
  }
  corpo.push("Write-Output ('VL_DISK:' + (ConvertTo-Json -InputObject @($res) -Compress))");
  return motorDisco() + CLEAN_PS_HEAD + corpo.join(String.fromCharCode(10));
}

// Apaga as categorias pedidas (cleanRunScript). A Lixeira e o cache de entrega têm
// caminho próprio; o resto passa pela trava de app aberto e pelo motor C#.
function cleanRunScript(cats) {
  const corpo = ['$res = @()'];
  for (const c of cats) {
    if (c.special === 'recycle') {
      corpo.push('$a = Medir (Lixeira) 0');
      corpo.push('Clear-RecycleBin -Force');
      corpo.push('$d = Medir (Lixeira) 0');
      corpo.push("$res += [pscustomobject]@{ id = 'recycle'; aberto = $false; liberado = [math]::Max(0, $a[0] - $d[0]); arquivos = [math]::Max(0, $a[1] - $d[1]); falhas = 0 }");
      continue;
    }
    if (c.special === 'delivery') {
      corpo.push('$t = Alvos { ' + c.t + ' }');
      corpo.push('$a = Medir $t 0');
      corpo.push('if (Get-Command Delete-DeliveryOptimizationCache) { Delete-DeliveryOptimizationCache -Force } else { foreach ($p in $t) { [void][GDZ.Disk]::Clean($p, 0) } }');
      corpo.push('$d = Medir $t 0');
      corpo.push("$res += [pscustomobject]@{ id = 'delivery'; aberto = $false; liberado = [math]::Max(0, $a[0] - $d[0]); arquivos = [math]::Max(0, $a[1] - $d[1]); falhas = 0 }");
      continue;
    }
    corpo.push('if (Aberto ' + psList(c.procs) + ') { $res += [pscustomobject]@{ id = ' + JSON.stringify(c.id) +
      '; aberto = $true; liberado = 0; arquivos = 0; falhas = 0 } } else {');
    corpo.push('  $f = 0; $n = 0; $x = 0');
    corpo.push('  foreach ($p in (Alvos { ' + c.t + ' })) { $m = [GDZ.Disk]::' + (c.top ? 'CleanTop' : 'Clean') + '($p, ' + (c.age || 0) + '); $f += $m[0]; $n += $m[1]; $x += $m[2] }');
    corpo.push('  $res += [pscustomobject]@{ id = ' + JSON.stringify(c.id) + '; aberto = $false; liberado = $f; arquivos = $n; falhas = $x }');
    corpo.push('}');
  }
  corpo.push("Write-Output ('VL_DISK:' + (ConvertTo-Json -InputObject @($res) -Compress))");
  return motorDisco() + CLEAN_PS_HEAD + corpo.join(String.fromCharCode(10));
}

// O bloco que carrega a clase C# na frente de tudo. Vai ANTES do CLEAN_PS_HEAD e do
// corpo porque, dentro de um try de um .ps1, `Add-Type -TypeDefinition` falha com
// TypeDefinitionError (ver o comentário de separaAddType no engine.js). O bloco começa
// com "if", então o separaAddType do engine.js não o move.
function motorDisco() {
  return disco.diskPS(DATA_DIR_DISCO()) + String.fromCharCode(10);
}
function DATA_DIR_DISCO() {
  try { return core.DATA_DIR(); } catch (e) { return APP_DATA(); }
}

// Lê a linha 'VL_DISK:<json>' da saída do PowerShell.
function leJsonDisco(out) {
  const m = /^VL_DISK:(.*)$/m.exec(String(out || ''));
  if (!m) throw new Error('resposta vazia do PowerShell');
  const j = JSON.parse(m[1]);
  return Array.isArray(j) ? j : [j];
}

async function cleanCats() {
  const out = [];
  for (const c of CATS) {
    const m = cleanM.sizes[c.id];
    out.push({
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      // "existe": a categoria só aparece quando o alvo existe (regra do GDZ).
      exists: c.special === 'recycle' ? true : (cleanM.exists[c.id] === undefined ? undefined : !!cleanM.exists[c.id]),
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
    if (force) { cleanM.sizes = {}; cleanM.exists = {}; }
    try {
      // Um script só: o motor C# é carregado uma vez e as 16 categorias são medidas em
      // sequência, como no GDZ. Era uma Promise.all com uma varredura de Node por
      // categoria — não tinha MeasureTop, não contava nuvem/reparse e media a Lixeira
      // pelo índice, que é outra coisa.
      const r = await core.ps(cleanScanScript(), 120000);
      let lista = [];
      try { lista = leJsonDisco(r.out); } catch (e) {
        // Sem resposta: NÃO inventar números. Fica tudo sem medição e a tela mostra
        // "medindo" em vez de "Nada para limpar" (que era mentira).
        cleanM.measuring = false;
        cleanM.at = 0;
        cleanJob = null;
        return;
      }
      for (const x of lista) {
        if (!x || !x.id) continue;
        cleanM.sizes[x.id] = { bytes: Number(x.bytes) || 0, files: Number(x.arquivos) || 0 };
        cleanM.exists[x.id] = x.existe === undefined ? undefined : !!x.existe;
        cleanM.index++;
      }
    } catch (e) { }
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
  const pedidas = (Array.isArray(ids) ? ids : []).filter((i) => typeof i === 'string');
  const cats = CATS.filter((c) => pedidas.includes(c.id));
  if (!cats.length) return { success: false, error: 'Nada selecionado.' };
  let lista;
  try {
    const r = await core.ps(cleanRunScript(cats), 600000);
    lista = leJsonDisco(r.out);
  } catch (e) {
    return { success: false, error: 'A limpeza não terminou. Tente de novo.' };
  }
  const results = lista.map((x) => ({
    id: x.id,
    open: !!x.aberto,
    freed: Number(x.liberado) || 0,
    files: Number(x.arquivos) || 0,
    failed: Number(x.falhas) || 0,
  }));
  const freed = results.reduce((t, x) => t + x.freed, 0);
  for (const c of cats) delete cleanM.sizes[c.id];
  cleanM.at = 0;
  measureClean(true);
  return { success: true, results, freed };
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
//
// As 3 chaves Uninstall e os 5 filtros do GDZ (APPS_PS, gdz-SEM-MANGLE.js linha 5405).
// O GDZ filtra em CASCATA e cada filtro descarta a chave na hora; os que faltavam no
// nosso eram dois:
//   - ReleaseType casando Update|Hotfix  (atualizações e correções que aparecem como
//     se fossem programas instalados);
//   - sem UninstallString E não sendo MSI-GUID  (chave órfã, sem como desinstalar).
// O tamanho vem do Field EstimatedSize (KB do próprio app) × 1024, como o GDZ: antes o
// nosso devolvia bytes:0 na listagem e só 33 dos 90 programas tinham tamanho, medido
// pela varredura do disco em appsExtra. O EstimatedSize existe em 60 dos 90.
const TIPO_UID = /^\{[0-9A-Fa-f-]{36}\}$/;
let appsCache = null;
ex.appsList = async (force) => {
  if (appsCache && !force) return { success: true, apps: appsCache };
  const r = await core.ps(`
    $fontes = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    $out = New-Object System.Collections.ArrayList
    foreach ($f in $fontes) {
      foreach ($k in @(Get-ChildItem -LiteralPath $f -ErrorAction SilentlyContinue)) {
        $nome = ([string]$k.GetValue('DisplayName')).Trim()
        if (-not $nome) { continue }
        if ($k.GetValue('SystemComponent') -eq 1) { continue }
        if ($k.GetValue('ParentKeyName')) { continue }
        if ([string]$k.GetValue('ReleaseType') -match 'Update|Hotfix') { continue }
        $un = [string]$k.GetValue('UninstallString')
        $msi = $k.GetValue('WindowsInstaller') -eq 1
        if (-not $un -and -not ($msi -and $k.PSChildName -match '^\\{[0-9A-Fa-f-]{36}\\}$')) { continue }
        [void]$out.Add([pscustomobject]@{
          key = $k.Name; name = $nome; pub = ([string]$k.GetValue('Publisher')).Trim(); ver = [string]$k.GetValue('DisplayVersion')
          kb = $k.GetValue('EstimatedSize'); date = [string]$k.GetValue('InstallDate'); loc = [string]$k.GetValue('InstallLocation')
          icon = [string]$k.GetValue('DisplayIcon'); un = $un; msi = $msi; guid = $k.PSChildName
          noRemove = ($k.GetValue('NoRemove') -eq 1) })
      }
    }
    Write-Output (Json $out)`, 120000);
  let list = [];
  try { list = JSON.parse(r.out); } catch (e) {}
  if (!Array.isArray(list)) list = list ? [list] : [];

  // dedup por name|ver em minúsculas, o primeiro ganha (regra do GDZ).
  const vistos = new Set();
  const final = [];
  for (const a of list) {
    if (!a || !a.name) continue;
    // A chave vem como HKEY_LOCAL_MACHINE\... — só as 3 Uninstall valem.
    const k = String(a.key || '');
    if (!/^HKEY_(LOCAL_MACHINE|CURRENT_USER)\\SOFTWARE\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$/i.test(k)) continue;
    const chaveDedup = (String(a.name) + '|' + String(a.ver || '')).toLowerCase();
    if (vistos.has(chaveDedup)) continue;
    vistos.add(chaveDedup);
    const mData = /^(\d{4})(\d{2})(\d{2})$/.exec(String(a.date || '').trim());
    final.push({
      key: k,
      name: a.name,
      pub: a.pub || '',
      ver: a.ver || '',
      date: mData ? mData[1] + '-' + mData[2] + '-' + mData[3] : null,
      // EstimatedSize é KB e vem do próprio programa; × 1024 vira bytes. Não é medido
      // no disco — a tela mostra "—" quando o programa não informa o tamanho.
      bytes: Number(a.kb) > 0 ? Number(a.kb) * 1024 : null,
      loc: vmaCleanDir(a.loc),
      icon: String(a.icon || ''),
      un: a.un || '',
      msi: !!a.msi,
      guid: a.guid || '',
      noRemove: !!a.noRemove,
    });
  }
  appsCache = final;
  return { success: true, apps: appsCache };
};

// %VAR% -> valor do ambiente, tira aspas das pontas e a barra final; vazio é 'vazio'.
const vmaEnvPath = (s) => String(s || '').replace(/%([^%]+)%/g, (m, nome) => process.env[nome] || m);
function vmaCleanDir(s) {
  const p = vmaEnvPath(String(s || '').trim().replace(/^"+|"+$/g, '')).replace(/[\\/]+$/, '');
  return p ? path.resolve(p) : '';
}

// Separa "como desinstalar" do UninstallString — os 5 casos do parseUninstall do GDZ
// (linha 5431). É o que permite desinstalar caminhos COM ESPAÇO: o nosso anterior
// cortava no primeiro espaço, então "C:\Program Files\App\unins000.exe" virava
// "C:\Program" e o spawn falhava.
function vmaParseUninstall(un, app) {
  const s = vmaEnvPath(String(un || '').trim());
  // caso 1: MSI sem UninstallString -> usa o GUID
  if (!s && app && app.msi) return { file: 'msiexec.exe', args: '/X' + app.guid };
  // caso 2: msiexec ... /I {GUID} -> /X (instalador não desinstala)
  const mMsi = /^"?(?:[a-z]:\\[^"]*\\)?msiexec(?:\.exe)?"?\s+(.*)$/i.exec(s);
  if (mMsi) return { file: 'msiexec.exe', args: mMsi[1].replace(/\/I\s*(\{)/i, '/X$1') };
  // caso 3: começa com aspas
  if (s.startsWith('"')) {
    const fim = s.indexOf('"', 1);
    if (fim > 1) return { file: s.slice(1, fim), args: s.slice(fim + 1).trim() };
  }
  // caso 4: cresce a fatia até achar um .exe que exista (ou seja só o nome)
  const pedacos = s.split(' ');
  for (let i = 1; i <= pedacos.length; i++) {
    const cand = pedacos.slice(0, i).join(' ');
    if (/\.exe$/i.test(cand) && (!/[\\/]/.test(cand) || fs.existsSync(cand))) {
      return { file: cand, args: pedacos.slice(i).join(' ') };
    }
  }
  // caso 5: nada casou — devolve o texto inteiro
  return { file: s, args: '' };
}

// O executável do desinstalador, quando é um caminho de verdade.
function vmaUninstallExe(app) {
  const p = vmaParseUninstall(app.un, app);
  if (/[\\/]/.test(p.file) && !/\\(msiexec|rundll32)\.exe$/i.test(p.file)) return path.resolve(p.file);
  return '';
}

// "a" é igual a "b" ou está dentro de "b" (case-insensitive, sem barra final).
const vmaSameOrInside = (a, b) => {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase().replace(/\\+$/, '');
  return x === y || x.startsWith(y + '\\');
};

// Pastas que NUNCA podem ser tratadas como "sobra de um programa" (lista do GDZ,
// protectedDirs, linha 5483). Sem esta lista, uma sobra calculada errada poderia
// apontar para Program Files inteiro, para a área de trabalho ou para a pasta do app.
function vmaProtectedDirs() {
  const env = process.env;
  const home = os.homedir();
  const lista = [
    env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData,
    env.APPDATA, env.LOCALAPPDATA, env.PUBLIC,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Temp'),
    home, env.OneDrive,
    ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Saved Games', 'AppData', 'AppData\\LocalLow'].map((d) => path.join(home, d)),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Common Files'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Common Files'),
    env.ProgramData && path.join(env.ProgramData, 'Microsoft'),
    env.ProgramData && path.join(env.ProgramData, 'Package Cache'),
    path.dirname(process.execPath),
    APP_DATA(),
  ];
  return lista.filter(Boolean).map((p) => path.resolve(p));
}

// Pastas do sistema em que nada pode ser apagado (systemDirs do GDZ, linha 5489).
function vmaSystemDirs() {
  const env = process.env;
  return [
    env.SystemRoot,
    env.ProgramFiles && path.join(env.ProgramFiles, 'WindowsApps'),
    env.ProgramData && path.join(env.ProgramData, 'Package Cache'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Common Files'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Common Files'),
  ].filter(Boolean).map((p) => path.resolve(p));
}

// Existe, é caminho absoluto de disco, tem 3+ segmentos, não é pasta protegida nem do
// sistema, e não é a pasta do próprio app. Regra do safeAppDir do GDZ, linha 5493.
ex.protectedDirs = vmaProtectedDirs;
ex.safeAppDir = function (dir, outras) {
  if (!dir || !path.isAbsolute(dir) || !/^[a-z]:\\/i.test(dir)) return false;
  if (dir.split('\\').filter(Boolean).length < 3) return false;
  if (vmaProtectedDirs().some((p) => vmaSameOrInside(p, dir))) return false;
  if (vmaSystemDirs().some((p) => vmaSameOrInside(dir, p))) return false;
  if (vmaSameOrInside(path.dirname(process.execPath), dir) || vmaSameOrInside(dir, path.dirname(process.execPath))) return false;
  return !(outras || []).some((o) => o && (vmaSameOrInside(o, dir) || vmaSameOrInside(dir, o)));
};

const qq = (s) => String(s == null ? '' : s).replace(/'/g, "''");
ex.appsExtra = async () => {
  const sizes = {}, icons = {};
  try { appsCache = appsCache || (await ex.appsList()).apps; } catch (e) {}

  // Tamanho do disco, com as mesmas proteções que o GDZ aplica antes de medir
  // (apps-extra, linha 5581): só pasta com 3+ segmentos, que existe, que não é uma
  // pasta protegida do sistema e que não está DENTRO de outra pasta de programa
  // (senão o mesmo disco seria contado duas vezes). A medição usa o motor C#.
  const protegidas = ex.protectedDirs();
  const todosLoc = (appsCache || []).map((a) => a.loc).filter(Boolean);
  const paraMedir = (appsCache || []).filter((a) => {
    if (!a.loc || a.loc.split('\\').filter(Boolean).length < 3) return false;
    if (!fs.existsSync(a.loc)) return false;
    if (protegidas.some((p) => vmaSameOrInside(p, a.loc))) return false;
    if (todosLoc.some((o) => o.toLowerCase() !== a.loc.toLowerCase() && vmaSameOrInside(o, a.loc))) return false;
    return true;
  });
  if (paraMedir.length) {
    const linhas = ['$sw = [Diagnostics.Stopwatch]::StartNew()', '$r = @{}',
      'foreach ($x in @(' + paraMedir.map((a) => '@(' + qq(a.key) + ',' + qq(a.loc) + ')').join(',') + ')) {',
      '  if ($sw.Elapsed.TotalSeconds -gt 40) { break }',
      '  $r[$x[0]] = [GDZ.Disk]::Measure($x[1], 0)[0]',
      '}',
      "Write-Output ('VL_DISK:' + (ConvertTo-Json -InputObject $r -Compress))"].join(String.fromCharCode(10));
    try {
      const r = await core.ps(motorDisco() + linhas, 60000);
      const m = /^VL_DISK:(.*)$/m.exec(String(r.out || ''));
      if (m) {
        const j = JSON.parse(m[1]) || {};
        for (const k of Object.keys(j)) if (Number(j[k]) > 0) sizes[k] = Number(j[k]);
      }
    } catch (e) {}
  }

  // ícone real de cada programa (o mesmo do Explorador).
  // Ordem do GDZ (linha 5597): DisplayIcon sem o sufixo ",<índice>" -> o executável do
  // desinstalador. Antes o nosso caía no "primeiro .exe da pasta InstallLocation", que
  // pegava o programa errado quando a pasta tinha vários.
  const items = [];
  for (const a of appsCache || []) {
    const cands = [vmaCleanDir(String(a.icon || '').replace(/,\s*-?\d+\s*$/, '')), vmaUninstallExe(a)];
    const p = cands.find((x) => x && /\.(exe|ico)$/i.test(x) && fs.existsSync(x));
    if (p) items.push({ k: a.key, p });
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
  // A chave agora é o caminho completo do registro (HKEY_...), como no GDZ; o
  // PowerShell espera o formato PS (HKLM:\...).
  const ps = String(key)
    .replace(/^HKEY_LOCAL_MACHINE\\/i, 'HKLM:\\')
    .replace(/^HKEY_CURRENT_USER\\/i, 'HKCU:\\');
  const r = await core.ps("$k = Get-Item -LiteralPath '" + qq(ps) + "' -ErrorAction SilentlyContinue; if ($k) { Write-Output '1' } else { Write-Output '0' }");
  return { exists: String(r.out || '').trim() === '1' };
};

ex.appsUninstall = async ({ key }) => {
  const a = (appsCache || []).find((x) => x.key === key);
  if (!a) return { success: false, error: 'programa não encontrado' };
  // NoRemove=1: o próprio programa proíbe a desinstalação (mensagem do GDZ).
  if (a.noRemove) return { success: false, error: 'Este programa não permite ser desinstalado.' };
  const p = vmaParseUninstall(a.un, a);
  if (!p.file) return { success: false, broken: true, error: 'O desinstalador deste programa não existe mais.' };
  // Caminho com barra que sumiu: desinstalador já foi apagado.
  if (/[\\/]/.test(p.file) && !fs.existsSync(p.file)) {
    return { success: false, broken: true, error: 'O desinstalador deste programa não existe mais.' };
  }
  try {
    // GDZ: argv0 entre aspas + windowsVerbatimArguments, senão caminho com espaço
    // quebra (o Node separaria "C:\Program Files\App" em dois argumentos).
    const child = spawn(p.file, p.args ? [p.args] : [], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, argv0: '"' + p.file + '"' });
    child.unref();
    return { success: true };
  } catch (e) {
    const r = await core.ps(`Start-Process -FilePath '${String(p.file).replace(/'/g, "''")}' -ArgumentList '${String(p.args).replace(/'/g, "''")}' -ErrorAction SilentlyContinue; Write-Output 'ok'`);
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

// ───────────────────────── CATÁLOGO RIOT (GDZ) ─────────────────────────
// O GDZ não descobre a Riot varrendo pasta: ele tem um catálogo fixo com o
// `riot` = nome do PRODUTO, e lê o caminho de instalação do arquivo que o
// Riot Client grava em C:\ProgramData\Riot Games\Metadata\<riot>\<riot>.product_settings.yaml
// O GDZ original lê esse yaml dentro do PowerShell (script GAMES_SCAN_PS, linha 2467):
//   $y = "C:\ProgramData\Riot Games\Metadata\$($g.riot)\$($g.riot).product_settings.yaml"
//   if (Test-Path -LiteralPath $y) { $m = [regex]::Match((Get-Content -LiteralPath $y -Raw),
//     'product_install_full_path:\s*"([^"]+)"'); if ($m.Success) { $dirs += ($m.Groups[1].Value -replace '/', '\') } }
// Aqui o mesmo regex é aplicado em Node (fs), com a mesma regra: só "..." com
// aspas, e as barras "/" viram "\".
const RIOT_DEFAULT_DIR = 'C:\\ProgramData\\Riot Games\\Metadata';
let riotDir = RIOT_DEFAULT_DIR;
// só para o teste com dados falsos apontar para uma árvore temporária
ex.__setRiotDir = (d) => { riotDir = d || RIOT_DEFAULT_DIR; };
ex.__setSteamRoot = (d) => { steamRoot = d; };

// Jogos Riot do catálogo do GDZ (só os dois com `riot`, copiados de GAMES).
// `exe` = mesmo glob relativo do GDZ; o `riot` é o nome do produto do Riot Client.
const RIOT_GAMES = [
  { id: 'valorant', name: 'Valorant', opt: 'Valorant', riot: 'valorant.live',
    exe: 'ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe', proc: 'VALORANT-Win64-Shipping.exe' },
  { id: 'lol', name: 'League of Legends', opt: 'LoL', riot: 'league_of_legends.live',
    exe: 'Game\\League of Legends.exe', proc: 'League of Legends.exe' },
];

// Equivale ao trecho do PowerShell do GDZ: devolve a pasta de instalação do
// produto Riot, ou null. Regex literal do GDZ: product_install_full_path:\s*"([^"]+)"
async function riotInstallPath(produto) {
  if (!produto || !/^[a-z0-9_.]+$/i.test(String(produto))) return null;
  const yaml = path.join(riotDir, String(produto), String(produto) + '.product_settings.yaml');
  let txt = '';
  try { txt = await fs.promises.readFile(yaml, 'utf8'); } catch (e) { return null; }
  const m = /product_install_full_path:\s*"([^"]+)"/.exec(txt);
  if (!m) return null;
  // o GDZ faz: ($m.Groups[1].Value -replace '/', '\')
  return m[1].replace(/\//g, '\\');
}
ex.riotInstallPath = riotInstallPath;

// Mesma ideia do laço `foreach ($g in @($games))` do GDZ, restrito às entradas
// com `riot`: resolve a pasta, junta com o glob do `exe` e marca `installed`
// só se o exe existir de fato (o GDZ usa $exes.Count -gt 0).
ex.riotScan = async () => {
  const out = [];
  for (const g of RIOT_GAMES) {
    const dir = await riotInstallPath(g.riot);
    if (!dir) continue;
    const exeFull = path.join(dir, g.exe);
    let installed = false;
    try { installed = fs.statSync(exeFull).isFile(); } catch (e) { installed = false; }
    out.push({
      id: g.id, name: g.name, opt: g.opt, dir,
      exe: installed ? exeFull : '',
      proc: g.proc,
      store: 'riot',
      // a Riot não tem cache de shaders na Steam: o GDZ só mostra "Limpar cache"
      // em jogo com `cache: 'fivem'` ou `steam` definido.
      gpu: true, canClean: false,
      installed, bytes: 0,
    });
  }
  return out;
};

// ───────────────────── CAPA DE JOGO (GDZ) ─────────────────────
// Cópia fiel do GDZ (`steamCoverFile` + `gameCover`). A Steam guarda as capas
// em <SteamRoot>\appcache\librarycache\<appid>\ ; a ordem de preferência é
// exatamente a do GDZ, e o layout antigo (<appid>_<arquivo> solto na raiz)
// é o fallback quando a pasta do appid não abre.
const COVER_NAMES = [['library_600x900.jpg', 'poster'], ['library_capsule.jpg', 'poster'], ['header.jpg', 'wide'], ['library_header.jpg', 'wide']];
const _coverCache = new Map();

async function steamCoverFile(appid) {
  if (!steamRoot || !/^\d{1,10}$/.test(String(appid))) return null;
  const pasta = path.join(steamRoot, 'appcache', 'librarycache', String(appid));
  let idx = {};
  try {
    for (const e of await fs.promises.readdir(pasta, { withFileTypes: true })) {
      if (e.isFile()) {
        idx[e.name.toLowerCase()] = idx[e.name.toLowerCase()] || path.join(pasta, e.name);
      } else if (e.isDirectory()) {
        for (const f of await fs.promises.readdir(path.join(pasta, e.name)).catch(() => [])) {
          idx[f.toLowerCase()] = idx[f.toLowerCase()] || path.join(pasta, e.name, f);
        }
      }
    }
  } catch (e) {
    // layout antigo
    idx = {};
    for (const [nome] of COVER_NAMES) {
      const p = path.join(steamRoot, 'appcache', 'librarycache', appid + '_' + nome);
      if (fs.existsSync(p)) idx[nome] = p;
    }
  }
  for (const [nome, kind] of COVER_NAMES) {
    if (idx[nome]) return { file: idx[nome], kind };
  }
  return null;
}
ex.steamCoverFile = steamCoverFile;

// GDZ `gameCover`:
//  1. capa da Steam (steamCoverFile) → nativeImage → resize 420 se maior → JPEG 82 base64
//  2. senão o ícone do exe (app.getFileIcon size:'large') → toDataURL
//  3. senão null (e NÃO cacheia a falha)
// O GDZ recebe (game, GAME_SCAN) porque o ícone vem do 1º exe achado no scan.
// Aqui o exe já vem dentro do próprio objeto do jogo (`g.exe`), então a
// assinatura é (g). Mantenho o 2º parâmetro opcional para ficar idêntico ao GDZ.
async function gameCover(g, scan) {
  if (!g || !g.id) return null;
  if (_coverCache.has(g.id)) return _coverCache.get(g.id);
  let capa = null;
  try {
    // appid Steam: no GDZ é `game.steam` (array). O nosso jogo já traz appid/steamId.
    const appids = (g.steam && g.steam.length ? g.steam : [g.appid || g.steamId]).filter(Boolean);
    for (const appid of appids) {
      const achado = await steamCoverFile(appid);
      if (!achado) continue;
      // nativeImage/app só existem dentro do Electron; em Node puro cai no catch
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(achado.file);
      if (img.isEmpty()) continue;
      const final = img.getSize().width > 420 ? img.resize({ width: 420, quality: 'good' }) : img;
      capa = { src: 'data:image/jpeg;base64,' + final.toJPEG(82).toString('base64'), kind: achado.kind };
      break;
    }
    const exeIcone = !capa && ((scan && scan[g.id] && scan[g.id].exes && scan[g.id].exes[0]) || g.exe);
    if (exeIcone) {
      const { app } = require('electron');
      const icone = await app.getFileIcon(exeIcone, { size: 'large' });
      if (icone && !icone.isEmpty()) capa = { src: icone.toDataURL(), kind: 'icon' };
    }
  } catch (e) {}
  if (capa) _coverCache.set(g.id, capa);
  return capa;
}
ex.gameCover = gameCover;

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
  // Riot (Valorant, League of Legends) — via product_settings.yaml, como no GDZ.
  // Só entra o que o Riot Client registrou E cujo exe existe no disco (installed).
  try {
    for (const g of await ex.riotScan()) {
      if (!g.installed) continue;
      if (games.some((x) => x.id === g.id)) continue;
      games.push(g);
    }
  } catch (e) {}
  await Promise.all(games.map(async (g) => {
    if (!g.dir || !fs.existsSync(g.dir)) return;
    try {
      const r = await dirSizes([g.dir], 0, 4000);
      g.bytes = r.bytes;
    } catch (e) {}
  }));
  for (const g of games) { g.installed = true; g.running = !!g.running; g.sizeLabel = fmtBytes(g.bytes); }
  // Capa de jogo: o painel lê `info.cover` ({src, kind}). Feita depois da lista,
  // em paralelo, para não segurar o retorno do scan.
  try {
    await Promise.all(games.map(async (g) => {
      try { g.cover = await ex.gameCover(g); } catch (e) { g.cover = null; }
    }));
  } catch (e) {}
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
  const running = [];
  try {
    const r = await core.ps(`$n = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique); Write-Output (Json $n)`);
    let names = [];
    try { const j = JSON.parse(r.out); names = Array.isArray(j) ? j : [j]; } catch (e) {}
    const set = new Set(names.map((n) => String(n).toLowerCase()));
    for (const g of gamesCache || []) {
      // a Riot roda vezes com nome de processo diferente do exe (ex.: "League of Legends");
      // o GDZ casa pela lista `proc` do jogo, então uso o mesmo critério.
      const procs = [g.proc].flat().filter(Boolean).map((n) => String(n).toLowerCase());
      const base = g.exe ? path.basename(g.exe, path.extname(g.exe)).toLowerCase() : '';
      g.running = (!!base && set.has(base)) || procs.some((n) => set.has(n))
        || (g.store === 'fivem' && set.has('fivem'));
      if (g.running) running.push(g.id);
    }
  } catch (e) {}
  // o painel lê `r.running` como LISTA DE IDs (dashboard.html); `games` continua
  // indo junto porque o setAutoUI usa a lista para o nome do jogo.
  return { scanning: false, games: gamesCache, running };
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
    // Igual ao cleanScript do GDZ (cache === 'fivem'): apaga o CONTEÚDO de cache,
    // server-cache e server-cache-priv, mas PRESERVA ...\data\cache\game (os dados
    // do GTA). Antes apagávamos a pasta `cache` inteira e levávamos o game junto.
    const keep = path.join(base, 'cache', 'game');
    for (const sub of ['cache', 'server-cache', 'server-cache-priv']) {
      const dir = path.join(base, sub);
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (p === keep) continue;
        try { fs.rmSync(p, { recursive: true, force: true }); } catch (err) {}
      }
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

// ────────────────────────────── FIVEM (GTA RP) ──────────────────────────────
// Copiado do GDZ (gdz-SEM-MANGLE.js): arquivo, presets, chaves, leitura/escrita e
// a trava de jogo aberto. O FiveM (CitizenFX) guarda os gráficos do GTA V em
// %APPDATA%\CitizenFX\gta5_settings.xml — NÃO num settings.xml dentro da pasta
// do FiveM (a versão anterior varria %LOCALAPPDATA%\FiveM e achava outro arquivo,
// então o ajuste não tinha efeito nenhum).
const FIVEM_XML = [
  path.join(process.env.APPDATA || '', 'CitizenFX', 'gta5_settings.xml'),
  path.join(process.env.LOCALAPPDATA || '', 'CitizenFX', 'gta5_settings.xml'),
];
const FIVEM_BACKUP = () => path.join(APP_DATA(), 'fivem-gta5_settings.original.xml');
// Frame Scaling na ordem da tela: Nativo, 83%, 75%, 67%, 50%.
const FIVEM_SCALING = [0, 4, 3, 2, 1];
// fps = 18 campos, balanced = 16 (sem HdStreamingInFlight e sem TXAA_Enabled).
const FIVEM_PRESETS = {
  fps: {
    MSAA: 0,
    MSAAFragments: 0,
    MSAAQuality: 0,
    ReflectionMSAA: 0,
    GrassQuality: 0,
    ShadowQuality: 1,
    Shadow_SoftShadows: 1,
    ReflectionQuality: 0,
    PostFX: 0,
    SSAO: 0,
    Tessellation: 0,
    MaxLodScale: '0.000000',
    Shadow_LongShadows: 'false',
    UltraShadows_Enabled: 'false',
    HdStreamingInFlight: 'false',
    DoF: 'false',
    MotionBlurStrength: '0.000000',
    TXAA_Enabled: 'false',
  },
  balanced: {
    MSAA: 0,
    MSAAFragments: 0,
    MSAAQuality: 0,
    ReflectionMSAA: 0,
    GrassQuality: 1,
    ShadowQuality: 2,
    Shadow_SoftShadows: 2,
    ReflectionQuality: 1,
    PostFX: 2,
    SSAO: 1,
    Tessellation: 1,
    MaxLodScale: '0.000000',
    Shadow_LongShadows: 'false',
    UltraShadows_Enabled: 'false',
    DoF: 'false',
    MotionBlurStrength: '0.000000',
  },
};
// As 16 chaves que a tela lê (ScreenWidth/ScreenHeight/FXAA_Enabled/LodScale não são escritas).
const FIVEM_KEYS = ['SamplingMode', 'MSAA', 'ReflectionMSAA', 'GrassQuality', 'ShadowQuality', 'Shadow_SoftShadows', 'ReflectionQuality', 'PostFX', 'SSAO', 'Tessellation', 'MaxLodScale', 'LodScale', 'Windowed', 'ScreenWidth', 'ScreenHeight', 'FXAA_Enabled'];

// o 1º dos dois candidatos que existir
function fivemXml() {
  return FIVEM_XML.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

// mesmo regex do GDZ: lê `<tag ... value="x">`
// (nome com prefixo fivemXml*: o bloco do Lossless já tem um xmlGet/xmlSet de
//  outra sintaxe, `<tag>valor</tag>` — nomes iguais se sobrescreviam)
function fivemXmlGet(xml, tag) {
  const m = new RegExp('<' + tag + '\\s+value="([^"]*)"').exec(xml);
  return m ? m[1] : null;
}
// troca o valor da tag; se a tag não existir, devolve o xml intacto (o GDZ nunca cria tag).
function fivemXmlSet(xml, tag, val) {
  const re = new RegExp('(<' + tag + '\\s+value=")[^"]*(")');
  return re.test(xml) ? xml.replace(re, '$1' + val + '$2') : xml;
}

// o preset aplicado fica salvo para a tela marcar a opção certa ao reabrir
const FIVEM_SETTINGS = () => readJson('fivem-settings.json', {});
function fivemSaveSettings(v) { writeJson('fivem-settings.json', v || {}); }

// Igual ao fivemRunning do GDZ: usa a lista de processos do `tasklist`, casa
// "fivem.exe" ou a família "FiveM_<build>_GTAProcess.exe" (o build muda a cada
// atualização: b2372, b3095...). Com o jogo aberto, ele regrava o arquivo ao fechar.
function fivemRunning() {
  return new Promise((resolve) => {
    try {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 8388608 }, (err, stdout) => {
        if (err) return resolve(false);
        const nomes = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = /^"([^"]+)"/.exec(line);
          if (m) nomes.push(m[1].toLowerCase());
        }
        resolve(nomes.some((n) => n === 'fivem.exe' || /^fivem_.*gtaprocess\.exe$/.test(n)));
      });
    } catch (e) { resolve(false); }
  });
}

// Verifica se algum dos processos está aberto (por nome, sem o .exe).
// (O FiveM usa o `fivemRunning` acima; esta continua servindo o resto do arquivo.)
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
  let caps = null;
  try { caps = await core.getCaps(); } catch (e) { caps = null; }
  const file = fivemXml();
  const installed = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'FiveM', 'FiveM.exe'));
  const out = {
    success: true,
    installed,
    file: !!file,
    backup: fs.existsSync(FIVEM_BACKUP()),
    running: await fivemRunning(),
    gpu: caps ? (caps.nvidia ? 'nvidia' : caps.amdGpu ? 'amd' : (caps.gpus || []).some((g) => g.vendor === 'intel' && !g.integrated) ? 'intel' : 'other') : 'other',
    gpuName: caps ? (((caps.gpus || []).find((g) => !g.integrated) || (caps.gpus || [])[0] || {}).name || '') : '',
    values: {},
    preset: FIVEM_SETTINGS().fivemPreset || null,
  };
  if (file) {
    let xml = '';
    try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { xml = ''; }
    // as 16 chaves saem sempre (com null quando a tag não está no arquivo), igual ao GDZ:
    // a tela lê `values.Windowed` direto e `null` é o que significa "não tem"
    for (const k of FIVEM_KEYS) out.values[k] = fivemXmlGet(xml, k);
  }
  // `file` na tela é o CAMINHO do arquivo (o src/gtarp.js usa `d.file` para exibir);
  // `hasFile` é o booleano do GDZ.
  out.hasFile = out.file;
  out.file = file;
  // índice do Frame Scaling para a tela marcar o botão certo
  const si = FIVEM_SCALING.indexOf(Number(out.values.SamplingMode));
  out.scaleIndex = si >= 0 ? si : 0;
  return out;
};

// Trava de ação do FiveM: no GDZ os dois handlers de escrita estão dentro de
// withActionLock. Aqui não existe um withActionLock no projeto, então esta
// fila resolve o mesmo problema (duas escritas no mesmo XML ao mesmo tempo).
let fivemFila = Promise.resolve();
function fivemLock(fn) {
  const r = fivemFila.then(fn, fn);
  fivemFila = r.then(() => {}, () => {});
  return r;
}

ex.fivemGfxApply = ({ preset, scaling, borderless } = {}) => fivemLock(async () => {
  const file = fivemXml();
  if (!file) return { success: false, error: 'Não achamos as configurações do FiveM. Abra o FiveM uma vez e feche.' };
  if (await fivemRunning()) return { success: false, error: 'Feche o FiveM antes: ele regrava as configurações quando fecha.' };
  if (preset !== undefined && preset !== null && !FIVEM_PRESETS[preset]) return { success: false, error: 'Pedido inválido.' };
  if (scaling !== undefined && (!Number.isInteger(scaling) || scaling < 0 || scaling >= FIVEM_SCALING.length)) return { success: false, error: 'Pedido inválido.' };
  try {
    let xml = fs.readFileSync(file, 'utf8');
    // backup só na 1ª vez: é o original de antes de o VL mexer
    if (!fs.existsSync(FIVEM_BACKUP())) fs.writeFileSync(FIVEM_BACKUP(), xml, 'utf8');
    if (preset) {
      for (const [k, v] of Object.entries(FIVEM_PRESETS[preset])) xml = fivemXmlSet(xml, k, v);
      fivemSaveSettings({ ...FIVEM_SETTINGS(), fivemPreset: preset });
    }
    if (scaling !== undefined) xml = fivemXmlSet(xml, 'SamplingMode', FIVEM_SCALING[scaling]);
    if (typeof borderless === 'boolean') xml = fivemXmlSet(xml, 'Windowed', borderless ? 2 : 0);
    // escrita atômica: grava no .tmp e renomeia sobre o original
    const tmp = file + '.vl-tmp';
    fs.writeFileSync(tmp, xml, 'utf8');
    fs.renameSync(tmp, file);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Não foi possível gravar: ' + e.message };
  }
});

ex.fivemGfxRestore = () => fivemLock(async () => {
  // se o XML já não existe, restaura no 1º candidato (igual ao GDZ)
  const file = fivemXml() || FIVEM_XML[0];
  if (!fs.existsSync(FIVEM_BACKUP())) return { success: false, error: 'Não há backup: as configurações nunca foram alteradas pelo VL.' };
  if (await fivemRunning()) return { success: false, error: 'Feche o FiveM antes de restaurar.' };
  try {
    fs.copyFileSync(FIVEM_BACKUP(), file);
    fs.rmSync(FIVEM_BACKUP(), { force: true });
    const s = FIVEM_SETTINGS();
    delete s.fivemPreset;
    fivemSaveSettings(s);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Não foi possível restaurar: ' + e.message };
  }
});

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

// ─────────────────── PAINEL AO VIVO (pcLive do GDZ) ───────────────────
//
// Fonte: GDZ Optimizer, pcLiveSpawn / pcLiveStart / pcLiveStop
// (C:\VLTemp\deob\gdz-SEM-MANGLE.js, linhas 6542–6765).
//
// Como o GDZ faz o painel de GPU/CPU ao vivo, em três partes:
//
//   1. pcLiveSpawn — sobe DOIS processos de longa duração, uma vez só:
//      (a) nvidia-smi em streaming (-lms 2000) com 9 colunas por GPU, quando o
//          nvidia-smi existe. Enquanto ele responde, a GPU vem daqui;
//      (b) um PowerShell em laço infinito (o template PCLIVE_PS) que a cada
//          1500 ms emite uma linha `GDZPI:{json}` com a frequência e o % de
//          performance de cada núcleo, a temperatura térmica e a temperatura
//          de cada disco (de 5 em 5 ciclos).
//      O PowerShell só coleta GPU pelos contadores do Windows (eng/vram)
//      quando NÃO há nvidia-smi — daí a variável GDZ_NEED_GPU.
//
//   2. pcLiveStart — um setInterval de 1000 ms que calcula o uso da CPU por
//      delta de os.cpus() (por núcleo e total), ressuscita o processo que
//      morreu (no máximo 1 vez a cada 30 s) e se encerra sozinho depois de
//      PCLIVE_IDLE_MS (8000 ms) sem ninguém pedir leitura.
//
//   3. pcLiveStop — mata os dois processos, limpa o intervalo e zera o estado.
//
// Por que NÃO é "chamar o PowerShell a cada 2 s", que é o que este arquivo
// fazia antes em pcinfoLive: um powershell.exe custa ~300–600 ms de partida e
// 5+ CIM por chamada. Medido na bancada (C:\VLTemp\j3-teste-painel.js): o laço
// entrega a leitura em 1600 ms de intervalo sem relançar nada. Como o painel
// consulta a cada 2 s, o processo antigo subia e morria o tempo todo.
//
// O que muda do GDZ para cá (tudo registrado no relatório j3-painel-FEITO.md):
//   - as marcas GDZPI:/GDZ_NEED_GPU/GDZ_PARENT viraram VLLIVE:/VL_NEED_GPU/
//     VL_PARENT, para os dois apps conviverem no mesmo PC;
//   - o GDZ não tem arquivo .ps1, tem o script num template literal. Aqui ele é
//     o painel-live.ps1 (o mesmo padrão do snapshot.ps1: arquivo separado, sem
//     cifrão brigando com o JS, validável pelo parser do PowerShell);
//   - no GDZ a linha era um spawn com -EncodedCommand; aqui é -File, porque o
//     script está em disco e o buffer de stdout fica o mesmo dos outros.
const PCLIVE_IDLE_MS = 8000;   // igual ao GDZ: sem leitura por 8 s, para tudo
const PCLIVE_RESPAWN_MS = 30000; // igual ao GDZ: ressuscita no máximo 1x/30 s
const ARQUIVO_PAINEL = path.join(__dirname, 'painel-live.ps1');

// Os mesmos dois caminhos do GDZ (NVIDIA_SMI_PATHS).
const NVIDIA_SMI_PATHS = [
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
];
function nvidiaSmiExe() {
  return NVIDIA_SMI_PATHS.find((p) => fs.existsSync(p)) || null;
}

// O estado, igual ao objeto `pcLive` do GDZ.
const pcLive = {
  timer: null,
  ps: null,
  smi: null,
  wantSmi: false,
  lastUse: 0,
  lastCpu: null,
  respawnAt: 0,
  cores: [],
  cpu: null,
  perf: null,
  temp: null,
  nv: [],
  wingpu: [],
  disks: {},
};

// Leitor de linhas em streaming — o mesmo lineReader do GDZ (t2-motor.md): acumula
// o buffer, quebra em \r?\n e guarda a sobra (linha incompleta) para o próximo pedaço.
// Não entrega a sobra final, igual ao GDZ (o diagnóstico disso está no relatório).
function leitorDeLinhas(proc, cb) {
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += String(d).replace(/^\uFEFF/, '');
    const linhas = buf.split(/\r?\n/);
    buf = linhas.pop();
    for (const l of linhas) cb(l);
  });
}

// As 9 colunas pedidas ao nvidia-smi e o teto de sanidade de cada uma (o mesmo
// par índice/teto do GDZ): o que vem fora da faixa vira null, e não 0.
const NV_COLS = [
  ['name', 0, -1], ['usage', 1, 100], ['temp', 2, 130], ['memUsed', 3, 1000000],
  ['memTotal', 4, 1000000], ['power', 5, 2000], ['fan', 6, 100],
  ['clock', 7, 100000], ['memClock', 8, 100000],
];

// ── pcLiveSpawn: sobe nvidia-smi e o Laço PowerShell (uma vez cada) ──
function pcLiveSpawn() {
  const smiExe = nvidiaSmiExe();
  pcLive.wantSmi = !!smiExe;

  // (a) nvidia-smi em streaming, a cada 2000 ms.
  if (smiExe && !pcLive.smi) {
    let p;
    try {
      p = spawn(smiExe, ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed,clocks.gr,clocks.mem', '--format=csv,noheader,nounits', '-lms', '2000'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { p = null; }
    if (p) {
      let acumulado = [];
      let agendado = null;
      leitorDeLinhas(p, (linha) => {
        const c = linha.split(',').map((x) => x.trim());
        if (c.length < 9) return;
        const num = (i, teto) => {
          const v = parseFloat(c[i]);
          return Number.isFinite(v) && v >= 0 && v <= teto ? v : null;
        };
        const g = {};
        for (const [campo, i, teto] of NV_COLS) g[campo] = i === 0 ? c[0] : num(i, teto);
        acumulado.push(g);
        // O GDZ guarda as leituras 150 ms depois da última linha (para juntar as
        // várias GPUs numa só leitura) e zera o acumulador.
        clearTimeout(agendado);
        agendado = setTimeout(() => { pcLive.nv = acumulado; acumulado = []; }, 150);
        if (agendado.unref) agendado.unref();
      });
      p.on('error', () => {});
      p.on('exit', () => {
        if (pcLive.smi === p) { pcLive.smi = null; pcLive.nv = []; }
      });
      pcLive.smi = p;
    }
  }

  // (b) o laço PowerShell do painel-live.ps1.
  if (!pcLive.ps) {
    if (!fs.existsSync(ARQUIVO_PAINEL)) return;
    let p;
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ARQUIVO_PAINEL], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: Object.assign({}, process.env, {
          // Sem nvidia-smi, a GPU tem de sair dos contadores do Windows.
          VL_NEED_GPU: smiExe ? '0' : '1',
          // O laço checa este PID a cada volta e morre sozinho se o app fechou.
          VL_PARENT: String(process.pid),
        }),
      });
    } catch (e) { p = null; }
    if (!p) return;

    // "a=1=b" | {a:1,b:2} -> [[a,1],[b,2]] — o `pares` do GDZ.
    const pares = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).split('='));

    leitorDeLinhas(p, (linha) => {
      if (!linha.startsWith('VLLIVE:')) return;
      let j;
      try { j = JSON.parse(linha.slice(7)); } catch (e) { return; }

      // Frequência efetiva por núcleo: ProcessorFrequency × PercentProcessorPerformance / 100,
      // sem a instância _Total, ordenada por (grupo, núcleo). É o `perf` do GDZ.
      const perf = pares(j.perf)
        .filter((a) => !/_Total/.test(a[0]) && +a[1] > 0 && +a[2] > 0)
        .map((a) => ({ k: a[0].split(',').map(Number), mhz: Math.round(+a[2] * +a[1] / 100) }))
        .sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1])
        .map((x) => x.mhz);
      pcLive.perf = perf.length ? perf : null;

      // Temperatura das zonas térmicas: HighPrecisionTemperature em décimos de
      // Kelvin -> °C. O GDZ só aceita entre 30 °C e 115 °C (fora disso é lixo do
      // driver) e deixa null quando o contador não existe no PC.
      const t = j.tz == null ? NaN : Number(j.tz) / 10 - 273.15;
      pcLive.temp = t > 30 && t < 115 ? Math.round(t) : null;

      // GPU pelos contadores do Windows (só quando não há nvidia-smi).
      if (j.eng || j.vram) {
        // O nome da instância traz o LUID em hex; o vram vem com o MESMO LUID.
        // É por ele que se junta uso e memória do mesmo adaptador.
        const luidDe = (nome) => {
          const m = /luid_0x([0-9A-F]+)_0x([0-9A-F]+)/i.exec(nome);
          return m ? String(BigInt('0x' + m[1] + m[2].padStart(8, '0'))) : null;
        };
        const porLuid = new Map();
        const pega = (luid) => {
          if (!porLuid.has(luid)) porLuid.set(luid, { luid, usage: 0, memUsed: 0 });
          return porLuid.get(luid);
        };
        for (const [nome, v] of pares(j.vram)) {
          const luid = luidDe(nome);
          if (luid) pega(luid).memUsed = Math.round((+v || 0) / 1048576);
        }
        for (const [nome, v] of pares(j.eng)) {
          const luid = luidDe(nome);
          if (luid) pega(luid).usage += +v || 0;
        }
        pcLive.wingpu = [...porLuid.values()].map((x) => Object.assign({}, x, { usage: Math.min(100, Math.round(x.usage)) }));
      }

      // Temperatura dos discos: só as plausíveis (0 < t < 120).
      if (j.disks) {
        pcLive.disks = Object.fromEntries(pares(j.disks).filter((a) => +a[1] > 0 && +a[1] < 120).map((a) => [a[0], +a[1]]));
      }
    });
    p.on('error', () => {});
    p.on('exit', () => {
      if (pcLive.ps === p) { pcLive.ps = null; pcLive.perf = null; pcLive.wingpu = []; }
    });
    pcLive.ps = p;
  }
}

// ── pcLiveStart: o intervalo de 1000 ms ──
function pcLiveStart() {
  if (pcLive.timer) return;
  pcLive.lastCpu = (os.cpus() || []).map((c) => c.times);
  pcLive.timer = setInterval(() => {
    // Ninguém pediu leitura há PCLIVE_IDLE_MS: para tudo (o GDZ faz igual, e é o
    // que impede o laço do PowerShell de comer CPU com a tela fechada).
    if (Date.now() - pcLive.lastUse > PCLIVE_IDLE_MS) { pcLiveStop(); return; }

    // Processo morto? Ressuscita, no máximo 1 vez a cada 30 s.
    if ((!pcLive.ps || (pcLive.wantSmi && !pcLive.smi)) && Date.now() >= pcLive.respawnAt) {
      pcLive.respawnAt = Date.now() + PCLIVE_RESPAWN_MS;
      pcLiveSpawn();
    }

    // CPU: delta de os.cpus() entre esta leitura e a anterior, por núcleo e total.
    const agora = (os.cpus() || []).map((c) => c.times);
    const antes = pcLive.lastCpu || [];
    const deltas = agora.map((a, i) => {
      const b = antes[i] || a;
      return [(a.user + a.nice + a.sys + a.idle + a.irq) - (b.user + b.nice + b.sys + b.idle + b.irq), a.idle - b.idle];
    });
    const total = deltas.reduce((s, d) => s + d[0], 0);
    const idle = deltas.reduce((s, d) => s + d[1], 0);
    // Amostra curta demais (o PC acabou de acordar) não é número: descarta.
    if (total < agora.length * 400) return;
    pcLive.cores = deltas.map(([t, i]) => (t > 0 ? Math.max(0, Math.min(100, Math.round((1 - i / t) * 100))) : 0));
    pcLive.cpu = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
    pcLive.lastCpu = agora;
  }, 1000);
  // O intervalo não segura o processo do app vivo (igual ao watchdog do FPS).
  if (pcLive.timer.unref) pcLive.timer.unref();
}

// ── pcLiveStop: mata os dois processos e zera o estado ──
function pcLiveStop() {
  clearInterval(pcLive.timer);
  pcLive.timer = null;
  for (const k of ['smi', 'ps']) {
    const p = pcLive[k];
    pcLive[k] = null;
    if (p) { try { p.kill(); } catch (e) {} }
  }
  Object.assign(pcLive, {
    cores: [], cpu: null, perf: null, temp: null, nv: [], wingpu: [], disks: {}, respawnAt: 0,
  });
}

// O `pcinfo-live` do GDZ (ipcMain.handle): responde o que o painel desenha e,
// de quebra, é o "pedido de leitura" que liga/mantém o coletor ligado.
ex.pcinfoLive = async () => {
  pcLive.lastUse = Date.now();
  pcLiveStart();

  // Nome dos adaptadores (vindo da ficha) para dar nome à GPU dos contadores
  // do Windows, que só traz o LUID.
  const nomes = new Map(((pcinfoCache.data && pcinfoCache.data.info && pcinfoCache.data.info.adapters) || []).map((a) => [a.luid, a.name]));

  const perf = pcLive.perf;
  return {
    success: true,
    cpu: {
      usage: pcLive.cpu,
      cores: pcLive.cores,
      mhz: perf ? Math.round(perf.reduce((s, x) => s + x, 0) / perf.length) : null,
      coreMhz: perf || [],
      temp: pcLive.temp,
    },
    ram: {
      used: os.totalmem() - os.freemem(),
      total: os.totalmem(),
    },
    // Com nvidia-smi, a GPU vem dele (tem memUsed/memTotal/power/fan/clocks).
    // Sem, vem dos contadores do Windows — só uso e memória, e é só o que existe.
    gpus: pcLive.nv.length
      ? pcLive.nv
      : pcLive.wingpu.filter((g) => nomes.has(g.luid)).map((g) => ({ name: nomes.get(g.luid), usage: g.usage, memUsed: g.memUsed })),
    disks: pcLive.disks,
  };
};

// Para o coletor quando o app fecha — no GDZ é `app.on("will-quit", pcLiveStop)`.
// O main.js chama esta função; se ele não chamar, o laço ainda morre sozinho
// porque checa VL_PARENT a cada ciclo.
ex.pcLiveStop = () => pcLiveStop();
ex.pcLiveAtivo = () => ({ timer: !!pcLive.timer, ps: !!pcLive.ps, smi: !!pcLive.smi, nv: pcLive.nv.length });
// O arquivo do template, para o build/teste conferirem que ele foi junto.
ex.PAINEL_PS = ARQUIVO_PAINEL;

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
// O caminho do PresentMon é resolvido mais abaixo (troca app.asar por app.asar.unpacked).
const fps = {
  proc: null, targetPid: null, targetName: '', frames: [], low: [], fps: 0, ft: 0, low1: 0,
  overlay: readJson('fps-overlay.json', { on: false, pos: 0, show: { frametime: true, low1: true, name: true } }),
  base: null, sessions: readJson('fps-sessions.json', { a: null, b: null }),
  recording: null, hotkey: 'Ctrl+Alt+B',
};

// ── Constantes do medidor, iguais às do GDZ (t4-medicao.md) ──
const FPS_SESSION = 'LOPT_TARGET';   // nome da sessão ETW
const FPS_IDLE_MS = 15000;           // sem ninguém pedir medição por 15 s -> para
const FPS_WINDOW_MS = 10000;         // cada processo guarda os últimos 10 s de quadros
const FPS_REC_SECS = [15, 30, 60];
// Processos que nunca são "o jogo": a própria área de trabalho, navegadores e as
// sobreposições dos outros programas também apresentam quadros e roubariam o alvo.
const FPS_IGNORE = new Set(['dwm.exe', 'explorer.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe',
  'opera.exe', 'brave.exe', 'discord.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'code.exe',
  'electron.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
  'textinputhost.exe', 'applicationframehost.exe', 'nvidia overlay.exe', 'radeonsoftware.exe',
  'gamebar.exe', 'obs64.exe', 'presentmon.exe']);
// Carimbo da última vez que a tela, o overlay ou a base pediram uma medição. É o que o
// vigia usa para não deixar o PresentMon coletando com o app parado.
fps.lastUse = 0;

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
  // slice(0, qtd): o PIOR quadro entra na média. O GDZ começava em 1 e jogava fora
  // exatamente o pior de todos — é o defeito que o t4-medicao.md registra em fpsStats
  // (Math.max(1, …) e depois slice(1, …)). Com n<100 sobrava média ZERO, o 1% low
  // virava Infinity e ia NaN para a tela. Aqui é slice(0, …).
  const media = piores.slice(0, qtd).reduce((s, x) => s + x, 0) / qtd;
  return media > 0 ? Math.round((1000 / media) * 10) / 10 : 0;
}

// Estatísticas de uma lista de frametimes em ms, com as contas e as casas decimais do
// fpsStats do GDZ (t4-medicao.md), que é o que a tela daquele app mostra:
//   fps       = round( (n * 1000 / soma) * 10 ) / 10
//   frametime = round( soma / n * 100 ) / 100
//   low1      = round( 1000 / médiaDos1%PioresMs * 10 ) / 10
//   low01     = round( 1000 / médiaDos0,1%PioresMs * 10 ) / 10
function fpsStats(lista) {
  const arr = (Array.isArray(lista) ? lista : []).filter((x) => x > 0 && isFinite(x));
  if (!arr.length) return null;
  const soma = arr.reduce((s, x) => s + x, 0);
  if (!(soma > 0)) return null;
  return {
    fps: Math.round(arr.length * 1000 / soma * 10) / 10,
    low1: lowFromFrametimes(arr, 0.01),
    low01: lowFromFrametimes(arr, 0.001),
    frametime: Math.round(soma / arr.length * 100) / 100,
    frames: arr.length,
    // A soma dos frametimes é a duração real da amostra (é assim que o GDZ calcula
    // os "segundos" da gravação em vez de usar a duração pedida).
    secs: Math.round(soma / 1000),
  };
}

// ── PresentMon ────────────────────────────────────────────────────────────────
// O binário mora em bin/ e é desempacotado fora do asar (electron-builder.json:
// "asarUnpack": ["bin/**"]). Dentro do app instalado, __dirname aponta para app.asar,
// um caminho que NÃO existe no disco — spawn nele daria ENOENT e o medidor nunca subiria
// na versão empacotada. O GDZ faz exatamente essa troca (getBinPath do gdz-SEM-MANGLE.js).
const PM = (() => {
  try { if (require('electron').app.isPackaged) return path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'bin', 'PresentMon.exe'); } catch (e) {}
  return path.join(__dirname, 'bin', 'PresentMon.exe');
})();

// Cada processo medido tem o seu registro no Map, igual ao fps.procs do GDZ:
// pid -> { name, frames: [[quando, ms]], last, flip }
//   flip = o jogo está em "Independent Flip"/"Hardware Composed" (tela cheia sem
//          composição do Windows). É o critério de desempate do alvo no GDZ.
const fpsProcs = new Map();
// Gravação em andamento (slot a/b), igual ao fps.rec do GDZ.
fps.rec = null;
fps.pmError = null;
fps.denied = false;
fps.cols = null;
fps.buf = '';

// Uma linha do CSV do PresentMon. A PRIMEIRA linha vira o mapa de colunas
// (nome -> índice); nada de índice fixo. Depois, só as colunas que o GDZ usa:
// Application, ProcessID, MsBetweenPresents e PresentMode.
function fpsHandleLine(linha) {
  const cols = String(linha).split(',');
  if (!fps.cols) {
    fps.cols = Object.fromEntries(cols.map((c, i) => [c.trim(), i]));
    return;
  }
  const c = fps.cols;
  const nome = (cols[c.Application] || '').trim();
  const pid = Number(cols[c.ProcessID]);
  const ms = Number(cols[c.MsBetweenPresents]);
  // janela ABERTA 0 < ms < 1000: quadro de mais de 1 s é propaganda/overlay/erro, não jogo
  if (!nome || !pid || !(ms > 0) || !(ms < 1000)) return;
  const baixo = nome.toLowerCase();
  if (FPS_IGNORE.has(baixo) || baixo === String(path.basename(process.execPath)).toLowerCase()) return;
  if (pid === process.pid) return;

  const agora = Date.now();
  let rec = fpsProcs.get(pid);
  if (!rec) { rec = { name: nome, frames: [] }; fpsProcs.set(pid, rec); }
  rec.last = agora;
  rec.flip = /Independent Flip|Hardware Composed/i.test(cols[c.PresentMode] || '');
  rec.frames.push([agora, ms]);
  // janela deslizante de 10 s
  const limite = agora - FPS_WINDOW_MS;
  let corte = 0;
  while (corte < rec.frames.length && rec.frames[corte][0] < limite) corte++;
  if (corte) rec.frames.splice(0, corte);

  // gravação em curso: guarda o ms cru, o mesmo que o GDZ faz em fpsHandleLine
  if (fps.rec && fps.rec.pid === pid && agora <= fps.rec.until) fps.rec.frames.push(ms);
}

// Tira do Map quem parou de apresentar quadros há mais de 3 s.
function fpsPrune() {
  const limite = Date.now() - 3000;
  for (const [pid, rec] of fpsProcs) if (rec.last < limite) fpsProcs.delete(pid);
}

// Para a sessão. Duas garantias, como no GDZ: kill() no processo e o próprio
// PresentMon com --terminate_existing_session (timeout 5 s), senão a sessão ETW fica
// aberta e a próxima subida falha com "error code 1450" (ERROR_NO_SYSTEM_RESOURCES).
function stopPM() {
  const p = fps.proc;
  fps.proc = null;
  fps.starting = null;
  fpsProcs.clear();
  fps.cols = null;
  fps.buf = '';
  fps.frames = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;
  if (p) { try { p.kill(); } catch (e) {} }
  try { execFile(PM, ['--terminate_existing_session', '--session_name', FPS_SESSION], { windowsHide: true, timeout: 5000 }, () => {}); } catch (e) {}
}

// Sobe o PresentMon em fluxo contínuo, com os argumentos do GDZ (t4-medicao.md):
//   --output_stdout --no_console_stats --stop_existing_session --session_name <sessão>
//   --no_track_input --no_track_gpu --exclude dwm.exe
// Sem --process_id e sem --terminate_on_proc_exit: mede TODOS os processos e o alvo é
// escolhido na leitura (fpsAlvo). Se o jogo trocar de processo (salva e recarrega), a
// medição continua em vez de parar.
function startPM() {
  fps.lastUse = Date.now();
  if (fps.proc) return Promise.resolve(true);
  if (fps.starting) return fps.starting;
  if (!fs.existsSync(PM)) {
    fps.pmError = 'PresentMon não encontrado na pasta do app.';
    return Promise.resolve(false);
  }
  fps.starting = new Promise((resolve) => {
    let erroStderr = '';
    try {
      const p = spawn(PM, ['--output_stdout', '--no_console_stats', '--stop_existing_session', '--session_name', FPS_SESSION, '--no_track_input', '--no_track_gpu', '--exclude', 'dwm.exe'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      fps.proc = p;
      fps.buf = '';
      fps.cols = null;
      fps.pmError = null;
      fps.denied = false;
      p.stdout.on('data', (d) => {
        // remove BOM e quebra por linha guardando a linha parcial no buffer
        fps.buf += String(d).replace(/^\uFEFF/, '');
        const linhas = fps.buf.split(/\r?\n/);
        fps.buf = linhas.pop();
        for (const l of linhas) if (l) fpsHandleLine(l);
      });
      p.stderr.on('data', (d) => {
        const t = String(d);
        erroStderr += t;
        if (/access denied|elevated privilege|administrador|administrative/i.test(t)) fps.denied = true;
        const m = /error:\s*([^\r\n]+)/i.exec(t);
        if (m) fps.pmError = m[1].trim();
      });
      p.on('error', (e) => { fps.pmError = e && e.message ? e.message : String(e); });
      p.on('exit', (codigo) => {
        if (fps.proc === p) {
          fps.proc = null;
          fps.cols = null;
          fps.buf = '';
          if (codigo && !fps.pmError) {
            fps.pmError = /access|privilege|administrador|administrative/i.test(erroStderr)
              ? 'Precisa rodar o VL Optimizer como administrador.'
              : 'O medidor parou (código ' + codigo + ').';
            if (/access|privilege|administrador|administrative/i.test(erroStderr)) fps.denied = true;
          }
        }
      });
    } catch (e) {
      fps.proc = null;
      fps.pmError = e && e.message ? e.message : String(e);
    }
    // 400 ms para o PresentMon abrir a sessão: resolve true se ele ainda está de pé
    setTimeout(() => { fps.starting = null; resolve(!!fps.proc); }, 400);
  });
  return fps.starting;
}

// Vigia: a cada 5 s, se o PresentMon está de pé e ninguém pediu medição por 15 s
// (overlay desligado, sem gravação, tela fechada), para a sessão. É o setInterval do
// GDZ (FPS_IDLE_MS = 15000 ms, conferido a cada 5000 ms), com a diferença de que aqui o
// overlay LIGADO conta como uso: no GDZ a condição é "!fps.overlay", porque lá o overlay
// é o único motivo de ele estar de pé; aqui a tela do medidor também usa a sessão.
let pmWatchdog = null;
function pmWatchdogStart() {
  if (pmWatchdog) return;
  pmWatchdog = setInterval(() => {
    try {
      if (fps.proc && !fps.rec && !(fps.overlay && fps.overlay.on) && Date.now() - fps.lastUse > FPS_IDLE_MS) stopPM();
    } catch (e) {}
  }, 5000);
  if (pmWatchdog.unref) pmWatchdog.unref();
}

// Alvo da medição, com a prioridade do fpsTarget do GDZ:
//   pinned (escolhido na tela e ainda vivo) > conhecido × 1.000.000 + flip × 100.000 + nº de quadros
function fpsAlvo() {
  fpsPrune();
  if (fps.targetPid && fpsProcs.has(fps.targetPid)) return fps.targetPid;
  const conhecidos = listCap.conhecidos || [];
  let melhor = null, nota = -1;
  for (const [pid, rec] of fpsProcs) {
    const nome = String(rec.name || '').toLowerCase();
    const n = (conhecidos.some((r) => r.test(nome)) ? 1000000 : 0) + (rec.flip ? 100000 : 0) + rec.frames.length;
    if (n > nota) { melhor = pid; nota = n; }
  }
  return melhor;
}

// Números de um PID para a tela e para o overlay, com as janelas do fpsLive do GDZ:
//   fps e frametime = últimos 1000 ms (se houver 2 quadros ou mais; senão os 10 s)
//   low1            = os 10 s inteiros
// Sem quadro novo há mais de 3 s o PID não é "ao vivo" e devolve null (é a poda de 3 s).
// A base compara com os últimos 3000 ms.
function fpsLive(pid) {
  const rec = pid && fpsProcs.get(pid);
  const agora = Date.now();
  // dados velhos não são "ao vivo": sem quadro novo há mais de 3 s, o processo não aparece.
  if (!rec || !rec.frames.length || agora - rec.frames[rec.frames.length - 1][0] > 3000) return null;
  const recentes = rec.frames.filter((f) => f[0] >= agora - 1000).map((f) => f[1]);
  const todos = rec.frames.map((f) => f[1]);
  const stTodos = fpsStats(todos);
  const stLive = fpsStats(recentes.length >= 2 ? recentes : todos);
  if (!stTodos) return null;
  const out = {
    pid,
    name: rec.name,
    fps: stLive ? Math.round(stLive.fps) : 0,
    frametime: stLive ? stLive.frametime : 0,
    low1: Math.round(stTodos.low1),
    raw: stTodos,   // sem arredondar, para a base e o overlay desenharem como antes
    base: null,
  };
  const b = fps.base;
  if (b && b.name && String(b.name).toLowerCase() === String(rec.name).toLowerCase()) {
    const st = fpsStats(rec.frames.filter((f) => f[0] >= agora - 3000).map((f) => f[1]));
    out.base = {
      fps: b.fps,
      low1: b.low1,
      label: b.label || 'Base',
      fresh: !!b.at && agora - b.at < 2500,
      now: st ? Math.round(st.fps) : 0,
      gain: st && b.fps ? Math.round((st.fps - b.fps) / b.fps * 1000) / 10 : null,
    };
  }
  return out;
}

// Ganho ao vivo contra a base, para o overlay: a mesma conta que o fpsLive do GDZ faz
// para a base (agora = média dos últimos 3000 ms do mesmo jogo, ganho em %).
function baseLive() {
  if (!fps.base) return null;
  const pid = fpsAlvo();
  const rec = pid && fpsProcs.get(pid);
  if (!rec) return null;
  if (fps.base.name && String(fps.base.name).toLowerCase() !== String(rec.name).toLowerCase()) return null;
  const agora = Date.now();
  const st = fpsStats(rec.frames.filter((f) => f[0] >= agora - 3000).map((f) => f[1]));
  const now = st ? Math.round(st.fps) : 0;
  return {
    fps: fps.base.fps,
    low1: fps.base.low1,
    label: fps.base.label || 'Base',
    fresh: !!fps.base.at && agora - fps.base.at < 2500,
    now,
    gain: st && fps.base.fps ? Math.round((st.fps - fps.base.fps) / fps.base.fps * 1000) / 10 : null,
  };
}

// Quadro "ao vivo" para o overlay: o alvo automático, com a mesma janela de antes
// (10 s do processo, que é o FPS_WINDOW_MS do GDZ) e a comparação com a base.
function liveAtual() {
  const pid = fpsAlvo();
  const rec = pid && fpsProcs.get(pid);
  if (!rec) return null;
  const st = fpsStats(rec.frames.map((f) => f[1]));
  if (!st) return null;
  return {
    fps: st.fps,
    frametime: st.frametime,
    low1: st.low1,
    name: rec.name,
    base: baseLive(),
  };
}

function overlayPayload() {
  const ov = fps.overlay || {};
  return {
    live: liveAtual(),
    show: ov.show || {}, right: ov.pos === 1 || ov.pos === 3, bottom: ov.pos === 2 || ov.pos === 3,
    sys: lastSys,
  };
}

let lastSys = { cpu: null, cpuTemp: null, gpu: null, gpuTemp: null, ramUsed: null, ramTotal: null, gpuAt: 0 };
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
  // O intervalo do overlay é 500 ms (o overlayTimer do GDZ), mas o sensor dele roda a
  // 1 s (startNvidiaSmi usa -lms 1000). Sem esta trava, o nvidia-smi seria chamado 2x
  // por segundo: são ~2 processos por segundo só para desenhar um número. Aqui ele é
  // chamado no máximo 1x/s e o valor é reaproveitado no tick seguinte.
  try {
    if (Date.now() - (lastSys.gpuAt || 0) >= 1000) {
      const g = await nvQuery();
      lastSys.gpuAt = Date.now();
      if (g && g.length) {
        lastSys.gpu = Math.round(g[0].usage || 0);
        if (g[0].temp != null) lastSys.gpuTemp = g[0].temp;
      }
    }
  } catch (e) { }

  return lastSys;
}
// FPS por aplicativo, para a lista do medidor mostrar o número ao lado de cada jogo.
//
// Aqui existia uma "captura por nome" (listCap.apps) que copiava os quadros do alvo para um
// mapa por nome — sempre com um único destino e sempre o mesmo número. O GDZ guarda quadros
// por PID (fps.procs, aqui fpsProcs) e monta a lista a partir dele; é o que fpsStatus() faz
// agora. listCap sobrou só com as marcas que o resto do arquivo usa.
const listCap = {
  denied: false,
  lastPoll: 0,
  // Regex dos processos de jogo conhecido (o `proc` do GDZ). Ver carregarConhecidos().
  conhecidos: [],
  // De onde veio a lista: 'catálogo do jogo' ou 'lista de processos do app'.
  origem: '',
};

let sysAmostra = null;

// Os processos de um jogo, no formato `proc` do GDZ, e o procMatchers dele (linha 2696):
//
//   const procMatchers = (jogo) => jogo.proc.map((p) =>
//     new RegExp('^' + p.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
//
// O GDZ guarda no catálogo os .exe de cada jogo (`proc: ["cs2.exe"]`,
// `proc: ["Minecraft.Windows.exe","javaw.exe"]`). O NOSSO catálogo (gamesScan) não tem
// esse campo: ele descobre UM `exe` por instalação varrendo a pasta do jogo. Por isso a
// lista sai de duas fontes, nesta ordem:
//
//   1. o `proc` do catálogo, se um dia ele existir (fica igual ao GDZ);
//   2. a tabela de processos do features.js — o mesmo `proc` do GDZ já portado para cá
//      pelo modo automático (nomes exatos de processo por jogo, com "*" -> ".*").
//      É dela que sai a lista hoje. Ela NÃO é exportada: o features.js expõe
//      runningProcs() + runningGameIds(), que é o `runningGame` do GDZ — então pergunto
//      pelos games que estão rodando AGORA e tiro os padrões de lá;
//   3. por último, o `exe` que o gamesScan achou de cada jogo instalado.
//
// Reaproveitar o features.js evita ter uma SEGUNDA lista de jogos que envelhece separada.
function regexDeProc(pat) {
  return new RegExp('^' + String(pat).toLowerCase().replace(/[.+${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

async function carregarConhecidos() {
  if (listCap.conhecidos.length) return;
  // 1) o `proc` do catálogo do app, no formato do GDZ
  try {
    const games = (await ex.gamesStatus()).games || [];
    for (const g of games) {
      for (const p of (Array.isArray(g.proc) ? g.proc : [])) {
        if (p) listCap.conhecidos.push(regexDeProc(p));
      }
    }
  } catch (e) {}
  if (listCap.conhecidos.length) { listCap.origem = 'catálogo do jogo (campo proc)'; return; }

  // 2) a tabela de processos do features.js — o mesmo `proc` do GDZ já portado para cá
  //    pelo modo automático (nomes exatos de processo por jogo, com "*" -> ".*").
  //    É dela que sai a lista hoje. Tem de ser a tabela ESTÁTICA: runningGameIds() só
  //    devolve o que está rodando AGORA, e aí o peso de "jogo conhecido" ligaria e
  //    desligaria conforme o usuário abre e fecha programas.
  try {
    const feat = require('./features');
    const lista = feat.AUTO_GAME_PROCS;
    if (Array.isArray(lista)) {
      for (const item of lista) {
        const p = Array.isArray(item) ? item[0] : item;
        if (p) listCap.conhecidos.push(regexDeProc(p));
      }
    }
  } catch (e) {}
  if (listCap.conhecidos.length) { listCap.origem = 'AUTO_GAME_PROCS (features.js)'; return; }

  // 3) o exe que o gamesScan achou de cada jogo instalado
  try {
    const games = (await ex.gamesStatus()).games || [];
    for (const g of games) {
      const n = g.exe ? path.basename(g.exe) : '';
      if (n) listCap.conhecidos.push(regexDeProc(n));
    }
    if (listCap.conhecidos.length) listCap.origem = 'exe do gamesScan';
  } catch (e) {}
}

ex.fpsStatus = async () => {
  // Toda consulta da tela conta como "alguém está usando o medidor": é o fps.lastUse do GDZ.
  fps.lastUse = Date.now();
  pmWatchdogStart();
  await startPM();
  await carregarConhecidos();
  fpsPrune();
  const alvo = fpsAlvo();
  const live = fpsLive(alvo);
  // Na lista entram os processos que apresentaram quadros nos últimos 3 s, do maior
  // FPS para o menor, no máximo 8 — igual ao fps-status do GDZ.
  const processos = [];
  for (const pid of fpsProcs.keys()) {
    const l = fpsLive(pid);
    if (l) processos.push(l);
  }
  processos.sort((a, b) => b.fps - a.fps);
  if (fps.recording) fps.recording.left = Math.max(0, Math.ceil((fps.recording.until - Date.now()) / 1000));
  return {
    success: !!fps.proc,
    error: fps.proc ? null : (fps.pmError || null),
    live: live ? {
      pid: live.pid, name: live.name, fps: live.fps, frametime: live.frametime, low1: live.low1,
      base: live.base ? { fps: live.base.fps, now: live.base.now, gain: live.base.gain, fresh: live.base.fresh } : null,
    } : null,
    // nome usado pelo vigia de alvo automático do GDZ (pinned de fato é o fps.targetPid)
    processes: processos.slice(0, 8).map((l) => ({ pid: l.pid, name: l.name, fps: l.fps })),
    pinned: fps.targetPid && fpsProcs.has(fps.targetPid) ? fps.targetPid : null,
    overlay: fps.overlay,
    recording: fps.recording ? { slot: fps.recording.slot, name: fps.recording.name, left: fps.recording.left, secs: fps.recording.secs } : null,
    sessions: { a: fps.sessions.a, b: fps.sessions.b },
    base: fps.base ? { fps: fps.base.fps, low1: fps.base.low1, name: fps.base.name, pid: fps.base.pid } : null,
    hotkey: fps.hotkey,
    needsAdmin: !!(fps.denied || listCap.denied) && !(fps.proc && live),
  };
};

// Escolher o processo na tela. O GDZ só aceita o PID que tem quadro medido (pinned) e
// não reinicia o medidor: como ele mede TODOS os processos de uma vez, trocar o alvo é só
// trocar quem aparece. Aqui é igual; pid vazio/zera volta para o automático.
ex.fpsSetTarget = async (pid) => {
  const n = parseInt(pid, 10) || 0;
  fps.lastUse = Date.now();
  if (!n) { fps.targetPid = null; fps.targetName = ''; return { success: true, pinned: null }; }
  fps.targetPid = fpsProcs.has(n) ? n : null;
  if (fps.targetPid) fps.targetName = String(fpsProcs.get(n).name || '');
  else {
    const r = await core.ps(`$p = Get-Process -Id ${n} -ErrorAction SilentlyContinue; if ($p) { Write-Output ($p.ProcessName + '.exe') }`);
    fps.targetName = String(r.out || '').split(/\r?\n/)[0].trim();
  }
  return { success: true, pinned: fps.targetPid };
};

// Gravação do "antes/depois", com o caminho do GDZ (fps-record):
//   o alvo precisa existir, os quadros brutos são empilhados enquanto a janela está
//   aberta, e no fim fpsStats() sobre o que juntou.
ex.fpsRecord = async ({ slot, secs, label } = {}) => {
  fps.lastUse = Date.now();
  await startPM();
  if (!FPS_REC_SECS.includes(secs)) secs = 30;
  if (fps.rec) return { success: false, error: 'Já existe uma gravação em andamento.' };
  if (!fps.proc) return { success: false, error: fps.pmError || 'Não foi possível iniciar o medidor.' };
  const alvo = fpsAlvo();
  const rec0 = alvo && fpsProcs.get(alvo);
  if (!rec0) return { success: false, error: 'Nenhum jogo rodando. Abra o jogo e tente de novo.' };
  const nome = rec0.name;
  const r = { slot, pid: alvo, name: nome, secs, until: Date.now() + secs * 1000, frames: [] };
  fps.rec = r;
  fps.recording = { slot, secs, left: secs, name: nome, until: r.until };
  // espera a janela fechar (o mesmo laço de 250 ms do GDZ), mantendo lastUse vivo
  await new Promise((pronto) => {
    const t = setInterval(() => {
      fps.lastUse = Date.now();
      fps.recording.left = Math.max(0, Math.ceil((r.until - Date.now()) / 1000));
      if (Date.now() >= r.until || !fps.proc || !fpsProcs.has(alvo)) { clearInterval(t); pronto(); }
    }, 250);
    if (t.unref) t.unref();
  });
  fps.rec = null;
  fps.recording = null;
  const st = fpsStats(r.frames);
  if (!st || r.frames.length < 30) return { success: false, error: 'Poucos frames gravados. Deixe o jogo aberto e em primeiro plano durante a gravação.' };
  // Só remove CHARACTERES de controle e < >; aspas/asteriscos ficam como o usuário digitou.
  const rotulo = typeof label === 'string' ? label.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 40) : '';
  const ses = {
    fps: st.fps, low1: st.low1, low01: st.low01, frametime: st.frametime, frames: st.frames,
    name: nome,
    label: rotulo || (slot === 'a' ? 'Antes' : 'Depois'),
    secs: st.secs,
    at: Date.now(),
  };
  fps.sessions[slot] = ses;
  writeJson('fps-sessions.json', fps.sessions);
  return { success: true, session: ses };
};

ex.fpsClear = (slot) => {
  fps.sessions[slot] = null;
  writeJson('fps-sessions.json', fps.sessions);
  return { success: true };
};
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
// Marcar a base = o ponto de comparação "sem DLSS". O GDZ (fpsMarkBase) usa os quadros
// dos últimos 5000 ms do jogo alvo e exige pelo menos 30 quadros; aqui é igual.
ex.fpsBaseMark = async () => {
  fps.lastUse = Date.now();
  await startPM();
  const alvo = fpsAlvo();
  const rec = alvo && fpsProcs.get(alvo);
  if (!rec) return { success: false, error: 'Nenhum jogo aberto para medir.' };
  const desde = Date.now() - 5000;
  const st = fpsStats(rec.frames.filter((f) => f[0] >= desde).map((f) => f[1]));
  if (!st || st.frames < 30) return { success: false, error: 'Poucos frames ainda. Jogue alguns segundos e marque de novo.' };
  fps.base = { pid: alvo, name: rec.name, fps: Math.round(st.fps * 10) / 10, low1: Math.round(st.low1), label: 'Base', at: Date.now() };
  writeJson('fps-base.json', fps.base);
  return { success: true, base: fps.base };
};
ex.fpsBaseClear = () => { fps.base = null; writeJson('fps-base.json', null); return { success: true }; };
ex.fpsRestore = () => {
  fps.base = readJson('fps-base.json', null);
  fps.overlay = readJson('fps-overlay.json', fps.overlay);
  fps.sessions = readJson('fps-sessions.json', { a: null, b: null });
};
// Primeira carga do arquivo (o mesmo que o fpsRestore faz, chamado no carregamento).
try { ex.fpsRestore(); } catch (e) {}

// Tick do overlay (a cada ~1,5 s pelo main.js). Conta como uso — é o overlayTimer do GDZ,
// que também chama o start do medidor a cada volta — e devolve os números na hora.
ex.fpsTick = async () => {
  fps.lastUse = Date.now();
  pmWatchdogStart();
  try { await startPM(); } catch (e) {}
  await sysSample();
  return overlayPayload();
};
ex.fpsOverlayPayload = overlayPayload;
// Fecha o PresentMon quando o app vai fechar (o "app.on will-quit" do GDZ chama fpsStop).
ex.fpsStop = () => { try { stopPM(); } catch (e) {} return { success: true }; };

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
  // Faixa e pausa iguais ao programa de referência:
  //   - 10 a 120 s (padrão 30)
  //   - se a janela do jogo perde o foco (alt-tab), a amostra NÃO conta
  //   - teto de tempo = seconds * 4 (o GDZ usa o mesmo)
  // Antes a medição rodava por tempo fixo e anotava valores de quando o jogo estava
  // minimizado — o que "puxa" a média para baixo e faz o veredito errar.
  const secs = Math.max(10, Math.min(120, seconds || 30));
  const temPid = !!(pid && Number(pid) > 4);
  const r = await core.ps(`
    $want = ${secs}
    $gamePid = ${temPid ? parseInt(pid, 10) : 0}
    $end = (Get-Date).AddSeconds($want * 4)
    $away = 0; $inGame = 0.0
    if ($gamePid) {
      try {
        Add-Type -Namespace VL -Name Fg -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);' -ErrorAction SilentlyContinue
      } catch { }
    }
    $null = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor
    $samples = @()
    $last = Get-Date
    for ($i = 0; $i -lt 500; $i++) {
      if ((Get-Date) -ge $end -or $inGame -ge $want) { break }
      Start-Sleep -Milliseconds 1000
      $now = Get-Date; $dt = ($now - $last).TotalSeconds; $last = $now
      if ($gamePid) {
        if (-not (Get-Process -Id $gamePid -ErrorAction SilentlyContinue)) { break }
        $fgPid = [uint32]0
        try { $h = [VL.Fg]::GetForegroundWindow(); [void][VL.Fg]::GetWindowThreadProcessId($h, [ref]$fgPid) } catch { }
        if ($fgPid -ne [uint32]$gamePid) { $away += $dt; continue }
      }
      $inGame += $dt
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
    }
    Write-Output (Json $samples)`, (secs * 4 + 60) * 1000);
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
// Valores reais do enum do Lossless (Main_SyncMode_* em LosslessScaling.dll):
// Default, Off, Vsync1, Vsync2, Vsync3. Não existe VSYNC4, GSYNC nem ADAPTIVE.
const LS_SYNC = { standard: 'Default', vsync: 'Vsync1', gsync: 'Vsync2', adaptive: 'Vsync3' };
const LS_MODE = { auto: 'Auto', custom: 'Custom' };

function xmlGet(xml, name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i').exec(xml);
  return m ? m[1].trim() : null;
}
// grava SÓ o literal exato (sem inferir maiúsculas): os enums são case-sensitive.
function xmlSet(xml, name, value) {
  const re = new RegExp('(<' + name + '>)([^<]*)(</' + name + '>)');
  if (re.test(xml)) return xml.replace(re, '$1' + String(value) + '$3');
  // ANTES: criava a tag no fim do bloco. O programa de referência nunca cria tag —
  // devolve o XML intacto. Tag inventada no Settings.xml só serve para o Lossless
  // achar o arquivo inválido.
  return xml;
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
// Consentimento de telemetria.
//
// Antes era uma constante que devolvia { consented: true }: a tela nunca perguntava
// nada e o cliente não tinha como recusar. O renderer (src/plano.js) espera o campo
// `consent` com três estados: true (aceitou), false (recusou) e null (ainda não
// perguntamos — é o que faz o modal aparecer).
//
// Fica em telemetry-consent.json na pasta de dados. O padrão é null: perguntar uma
// vez, nunca assumir aceito.
const TEL_CONSENT_FILE = 'telemetry-consent.json';
let telConsentCache = undefined;
function lerConsentTelemetria() {
  if (telConsentCache !== undefined) return telConsentCache;
  try {
    const j = readJson(TEL_CONSENT_FILE, { consent: null });
    const v = j && typeof j === 'object' ? j.consent : null;
    telConsentCache = (v === true || v === false) ? v : null;
  } catch (e) { telConsentCache = null; }
  return telConsentCache;
}
ex.telemetryConsent = () => ({ consent: lerConsentTelemetria() });
ex.telemetryConsentSet = (arg) => {
  const on = !!(arg && arg.on === true);
  telConsentCache = on;
  writeJson(TEL_CONSENT_FILE, { consent: on });
  return { success: true, consent: on };
};
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
    const r = await core.ps('$p = @(Get-Process -Name "' + MARCA.nome + '" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); Write-Output (Json $p)', 15000);
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
// Liga ou desliga um app da inicialização — o que o botão da aba Inicialização chama.
//
// ESTA FUNÇÃO NÃO EXISTIA. O main.js registrava o canal 'startup-set' apontando para
// ex.startupSet (linha 639) e a tela invocava o canal (dashboard.html, linha 3486), mas
// nada era implementado: o clique caía no catch, a tela mostrava "não foi possível
// alterar" e o app NUNCA mudava de estado.
//
// O mecanismo é o do GDZ (startup-set, gdz-SEM-MANGLE.js linha 4636) e o do próprio
// Gerenciador de Tarefas do Windows: o ligado/desligado MORA em
// Explorer\StartupApproved, NÃO no Run.
//
// Regra do GDZ, ponto por ponto:
//   - desativar grava o valor de 12 bytes [3,0,0,0,0,0,0,0,0,0,0,0]
//   - ativar    grava o valor de 12 bytes [2,0,0,0,0,0,0,0,0,0,0,0]
//   - cria a chave StartupApproved se ela não existir (New-Item -Force)
//   - o valor do Run NUNCA é apagado nem alterado — é o próprio app que decide se
//     executa, lendo o StartupApproved. Apagar o Run tirava a linha da lista de vez e
//     não tinha desfazer.
//   - recusa quando o nome não está mais no Run (o app foi desinstalado entre a
//     listagem e o clique)
//
// Os bytes vão como [byte[]] de verdade. Montar a string "2,0,0,..." e deixar o
// Set-ItemProperty converter grava os CARACTERES como bytes (33 no lugar de 12) — é
// exatamente o defeito que o comentário do Set-Val em engine.js descreve: todos os
// programas de boot passam a parecer alterados e o cliente perde a inicialização.
ex.startupSet = async ({ name, scope, enabled } = {}) => {
  const k = RUN_KEYS.find((x) => x.scope === scope);
  if (!k) return { success: false, error: 'Pedido inválido.' };
  if (typeof name !== 'string' || !name || name.length > 260 || /[\x00-\x1f]/.test(name)) {
    return { success: false, error: 'Pedido inválido.' };
  }
  if (typeof enabled !== 'boolean') return { success: false, error: 'Pedido inválido.' };
  const aprovado = STORE_BY_SCOPE[k.scope];
  if (!aprovado) return { success: false, error: 'Pedido inválido.' };

  // Nome e caminhos por parâmetro (-Name), nunca interpolados no corpo do script.
  const qq1 = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const script = [
    '$n = ' + qq1(name),
    '$k = Get-Item -LiteralPath ' + qq1(k.root) + ' -ErrorAction SilentlyContinue',
    "if (-not $k -or -not (@($k.GetValueNames()) -contains $n)) { Write-Output 'VL_ERRO: este app não está mais na inicialização.'; return }",
    'if (-not (Test-Path -LiteralPath ' + qq1(aprovado) + ')) { New-Item -Path ' + qq1(aprovado) + ' -Force | Out-Null }',
    'Set-ItemProperty -LiteralPath ' + qq1(aprovado) + ' -Name $n -Value ([byte[]](' + (enabled ? 2 : 3) + ',0,0,0,0,0,0,0,0,0,0,0)) -Type Binary -Force -ErrorAction Stop',
    // Confere o que ficou gravado: o GDZ não confere, mas sem conferir o app pode
    // devolver "ok" com o valor antigo no lugar (ex.: negativa de acesso do HKLM).
    'try { $b = (Get-ItemProperty -LiteralPath ' + qq1(aprovado) + ' -Name $n -ErrorAction Stop).$n } catch { $b = $null }',
    "if (-not ($b -is [byte[]]) -or $b.Length -lt 1) { Write-Output 'VL_ERRO: Falha ao gravar no registro.'; return }",
    "if (($b[0] % 2) -ne " + (enabled ? 0 : 1) + ") { Write-Output 'VL_ERRO: Falha ao gravar no registro.'; return }",
    "Write-Output 'OK'",
  ].join(String.fromCharCode(10));

  const r = await core.ps(script, 30000);
  // O `return` de dentro do script é transformado em exceção pelo trap do engine.js: o
  // texto chega no campo `err` SEM o prefixo 'VL_ERRO:' e com o acento estragado pelo
  // console OEM (vem "n�o est..." no lugar de "não est..."). Por isso a mensagem que a
  // tela mostra é escrita aqui, com acento certo, e não copiada da saída.
  const temErro = /VL_ERRO:/.test(String(r.out || '')) || (!r.ok && !/\bOK\b/.test(String(r.out || '')));
  if (temErro) {
    const bruto = String(r.out || '') + '\n' + String(r.err || '');
    const msg = 'este app não está mais na inicialização';
    // O console estraga o acento; procura pelo começo sem acento mesmo.
    if (/mais na inicializa/i.test(bruto)) return { success: false, error: msg + '.' };
    return { success: false, error: k.scope === 'user-run' ? 'Falha ao gravar no registro.' : 'Precisa rodar como administrador.' };
  }
  if (!/\bOK\b/.test(String(r.out || ''))) {
    // Mensagens do GDZ para a falha genérica: HKCU escrita pelo usuário; HKLM exige
    // administrador. Texto fixo, sem acento, porque o console OEM estraga a saída.
    return { success: false, error: k.scope === 'user-run' ? 'Falha ao gravar no registro.' : 'Precisa rodar como administrador.' };
  }
  return { success: true, enabled };
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
