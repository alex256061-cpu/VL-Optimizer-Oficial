// features.js — elevação, modo automático dos jogos, limpeza de RAM real
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const core = require('./engine');
const MARCA = require('./marca');

// Pasta de dados DESTA marca. Antes era 'VL Optimizer' fixo, e o build de um
// revendedor gravava backup/DNS/limpeza na pasta do VL.
const DATA = () => process.env.LOPT_DATA_DIR || path.join(MARCA.dirDados, 'data');
const file = (n) => path.join(DATA(), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return d; } };
const writeJson = (n, v) => { try { fs.mkdirSync(DATA(), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(v, null, 1)); } catch (e) {} };

const F = {};

// ────────────────────────────── ADMINISTRADOR ──────────────────────────────
F.isAdmin = async () => {
  const r = await core.ps(`Write-Output ([bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)))`);
  return /true/i.test(r.out);
};

F.elevate = (appPath) => new Promise((resolve) => {
  const exe = process.execPath;
  const arg = appPath ? `-ArgumentList '${String(appPath).replace(/'/g, "''")}','--elevated'` : `-ArgumentList '--elevated'`;
  const cmd = `try { Start-Process -FilePath '${String(exe).replace(/'/g, "''")}' ${arg} -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 3 }`;
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true, timeout: 180000 }, (err) => resolve(!err));
});

// ────────────────────────────── MODO AUTOMÁTICO ──────────────────────────────
//
// Igual ao GDZ (ver C:\VLTemp\TIME\t9-auto.md e gdz-SEM-MANGLE.js linhas 2746-2824):
// um laço a cada 5 s olha se um jogo do catálogo está rodando. Se está e o estado
// está VAZIO, aplica; se o estado está PREENCHIDO e o jogo fechou (ou o usuário
// desligou o modo), desfaz. O estado guarda o que era preciso para voltar atrás:
// o plano de energia anterior e a lista de .exe que foram fechados.
//
// O que mudou em relação à nossa versão antiga, comparado ao GDZ:
//   - o estado agora é UM objeto { game, scheme, killed } passado por cleanAutoState,
//     e não um blob solto em auto-prev-plan.json;
//   - o plano salvo agora é o que o script DEVOLVEU (só quando a troca deu certo),
//     não o que o Node achou que leu antes de trocar;
//   - os caminhos dos apps fechados são guardados e os apps são REABERTOS ao desfazer
//     (antes fechávamos o OneDrive e ele nunca voltava);
//   - a lista de apps com prioridade baixa é a do GDZ (5 apps, não 2);
//   - todos os apps limitados a BelowNormal voltam a Normal ao desfazer;
//   - o laço roda mesmo com o modo desligado se ainda houver estado para desfazer.
const AUTO_FILE = 'auto-mode.json';
const AUTO_STATE_FILE = 'auto-state.json';
const AUTO_MS = 5000;

// Mesmas listas do GDZ (linhas 2767-2768). AUTO_APPS_LOW serve para os dois
// lados: rebaixar no início e devolver a Normal no fim — é a mesma lista que o
// autoStopScript do GDZ usa para saber quem ele rebaixou.
const AUTO_APPS_LOW = ['chrome', 'msedge', 'firefox', 'opera', 'Discord'];
const AUTO_APPS_CLOSE = ['OneDrive', 'Dropbox', 'GoogleDriveFS'];
const PLAN_HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const GUID_RE = /^\{?[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\}?$/i;
const EXE_RE = /^[A-Za-z]:\\[^"<>|?*\r\n]+\.exe$/i;
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Nomes de processo por jogo, como o `proc` do GDZ. Cada entrada é o nome EXATO
// que o tasklist devolve — com o .exe, como nas entradas `proc: ["cs2.exe"]` do
// GDZ. A lista antiga (o GAME_RE de antes) era um regex solto: 'bf6' casava
// dentro de qualquer nome que tivesse "bf6", e 'league' fechava o LoL em qualquer
// janela. Aqui é nome exato, e o "*" vira `.*` (o mesmo do procMatchers do GDZ).
const AUTO_GAME_PROCS = [
  ['gta5.exe', 'GTA V'], ['gta5_enhanced.exe', 'GTA V Enhanced'],
  ['fivem.exe', 'FiveM (GTA RP)'], ['fivem_*gtaprocess.exe', 'FiveM (GTA RP)'],
  ['cs2.exe', 'Counter-Strike 2'],
  ['valorant-win64-shipping.exe', 'Valorant'],
  ['fortniteclient-win64-shipping.exe', 'Fortnite'],
  ['cod.exe', 'Call of Duty'], ['cod_modernwarfare.exe', 'Call of Duty'], ['modernwarfare.exe', 'Call of Duty'],
  ['warzone.exe', 'Warzone'],
  ['r5apex.exe', 'Apex Legends'], ['r5apex_dx12.exe', 'Apex Legends'],
  ['rustclient.exe', 'Rust'], ['pubg.exe', 'PUBG'],
  ['league of legends.exe', 'League of Legends'], ['leagueclient.exe', 'League of Legends'],
  ['rocketleague.exe', 'Rocket League'], ['overwatch.exe', 'Overwatch'],
  ['minecraft.windows.exe', 'Minecraft'], ['javaw.exe', 'Minecraft'],
  ['bf6.exe', 'Battlefield 6'], ['battlefield6.exe', 'Battlefield 6'], ['bf2042.exe', 'Battlefield 2042'],
  ['thefinals.exe', 'The Finals'], ['dota2.exe', 'Dota 2'], ['destiny2.exe', 'Destiny 2'],
  ['deadbydaylight-win64-shipping.exe', 'Dead by Daylight'],
  ['escapefromtarkov.exe', 'Escape from Tarkov'],
  ['rainbowsix.exe', 'Rainbow Six'], ['rainbowsix_vulkan.exe', 'Rainbow Six'],
  ['robloxplayerbeta.exe', 'Roblox'], ['hd-player.exe', 'BlueStacks'],
];

const procMatchers = (pat) => new RegExp('^' + pat.toLowerCase().replace(/[.+${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const auto = { on: false, state: null, timer: null, lastAt: 0 };
let autoBusy = false;

// Mesmo `cleanAutoState` do GDZ (linha 2771): só deixa passar o que dá para
// desfazer com segurança — um jogo conhecido, um GUID de plano válido e caminhos
// de .exe absolutos (no máximo 10, como no GDZ).
function cleanAutoState(s) {
  if (!s || typeof s !== 'object') return null;
  const game = typeof s.game === 'string' && s.game ? s.game : null;
  const scheme = typeof s.scheme === 'string' && GUID_RE.test(s.scheme) ? s.scheme : '';
  const killed = (Array.isArray(s.killed) ? s.killed : [])
    .filter((p) => typeof p === 'string' && EXE_RE.test(p))
    .slice(0, 10);
  return { game, scheme, killed };
}

F.autoState = () => ({
  on: auto.on,
  active: !!auto.state,
  game: auto.state ? auto.state.game : null,
  lastAt: auto.lastAt,
});

F.autoSet = (arg) => {
  const on = typeof arg === 'object' ? !!arg.on : !!arg;
  auto.on = on;
  writeJson(AUTO_FILE, { on });
  if (on) F.autoStart(); else F.autoStop();
  return { success: true, autoMode: auto.on, state: F.autoState() };
};

F.autoStart = () => {
  auto.on = readJson(AUTO_FILE, { on: false }).on === true;
  // O estado vem do disco: se o app morreu com o jogo aberto, o desfazer ainda
  // acontece na próxima vez que o laço rodar (mesmo com o modo desligado).
  auto.state = cleanAutoState(readJson(AUTO_STATE_FILE, null));
  if (auto.timer) return;
  auto.timer = setInterval(F.autoTick, AUTO_MS);
  if (auto.timer.unref) auto.timer.unref();
  F.autoTick();
};

F.autoStop = () => {
  if (auto.timer) clearInterval(auto.timer);
  auto.timer = null;
  // Desliga o modo, mas o desfazer NÃO é sincrônico aqui: o autoTick seguinte
  // vê `!auto.on` com estado preenchido e desfaz (igual ao ramo do GDZ).
  if (auto.state) F.autoTick();
};

const saveAutoState = (s) => writeJson(AUTO_STATE_FILE, s);

// `runningProcesses` do GDZ (tasklist), devolvendo Set de nomes em minúsculas.
F.runningProcs = () => new Promise((resolve) => {
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
    if (err) return resolve(new Set());
    const set = new Set();
    for (const line of String(stdout).split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line);
      if (m) set.add(m[1].toLowerCase());
    }
    resolve(set);
  });
});

// `runningGameIds` do GDZ: nomes de processo que casam com o `proc` do jogo.
F.runningGameIds = (procs) => {
  const list = procs instanceof Set ? [...procs] : (Array.isArray(procs) ? procs : []);
  const out = [];
  for (const [pat, name] of AUTO_GAME_PROCS) {
    const re = procMatchers(pat);
    if (list.some((p) => re.test(p)) && !out.some((g) => g.name === name)) out.push({ id: pat, name });
  }
  return out;
};

F.runningGame = async () => {
  const games = F.runningGameIds(await F.runningProcs());
  return games[0] || null;
};

// `autoStartScript` do GDZ (linha 2769), montado do mesmo jeito.
function autoStartScript(caps) {
  const skipPlan = !!(caps && (caps.x3dDual || caps.laptop));
  const planPart = skipPlan ? '' :
    "if ($scheme -and $scheme -ne '" + PLAN_HIGH + "') { powercfg /setactive " + PLAN_HIGH + " 2>$null; $plan = ($LASTEXITCODE -eq 0) }";
  return `
    $scheme = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value
    foreach ($n in @(${AUTO_APPS_LOW.map(psQuote).join(',')})) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { try { $_.PriorityClass = 'BelowNormal' } catch {} } }
    $killed = @()
    foreach ($n in @(${AUTO_APPS_CLOSE.map(psQuote).join(',')})) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $killed += $_.Path }; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } }
    $plan = $false
    ${planPart}
    Write-Output ('VL_AUTO: ' + (ConvertTo-Json -InputObject ([ordered]@{ scheme = $(if ($plan) { $scheme } else { '' }); killed = @($killed | Select-Object -Unique) }) -Compress))`;
}

// `autoStopScript` do GDZ (linha 2770), montado do mesmo jeito.
function autoStopScript(state) {
  const schemePart = state && state.scheme ? "powercfg /setactive '" + String(state.scheme).replace(/'/g, "''") + "' 2>$null" : '';
  const killedList = (state && Array.isArray(state.killed) ? state.killed : []).map(psQuote).join(',') || "''";
  return `
    foreach ($n in @(${AUTO_APPS_LOW.map(psQuote).join(',')})) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { try { if ($_.PriorityClass -eq 'BelowNormal') { $_.PriorityClass = 'Normal' } } catch {} } }
    ${schemePart}
    foreach ($p in @(${killedList})) {
      if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
      if ($p -match 'OneDrive\\.exe$') { Start-Process -FilePath $p -ArgumentList '/background' -ErrorAction SilentlyContinue } else { Start-Process -FilePath $p -ErrorAction SilentlyContinue }
    }
    Write-Output 'ok'`;
}

// `autoTick` do GDZ (linha 2782). O portão do GDZ é `!autoMode && !autoState`:
// o modo desligado não impede o desfazer, e o `_autoBusy` impede que dois ticks
// rodem ao mesmo tempo (o setInterval de 5 s não espera o anterior terminar).
F.autoTick = async () => {
  if (autoBusy) return;
  if (!auto.on && !auto.state) return;
  autoBusy = true;
  try {
    const games = F.runningGameIds(await F.runningProcs());
    const state = cleanAutoState(auto.state);
    if (auto.on && games.length && !state) {
      const caps = await core.getCaps();
      const r = await core.ps(autoStartScript(caps), 30000);
      const m = /^VL_AUTO:\s*(.+)$/m.exec(r.out || '');
      let parsed = {};
      if (m) { try { parsed = JSON.parse(m[1]); } catch (e) { parsed = {}; } }
      // O GDZ faz `cleanAutoState({...parsed, game}) || {game, scheme:'', killed:[]}`.
      // O `||` nunca dispara lá (cleanAutoState({}) devolve objeto, não null), então
      // o fallback é inalcançável — mantido só como rede de segurança.
      auto.state = cleanAutoState({ ...parsed, game: games[0].id }) ||
        { game: games[0].id, scheme: '', killed: [] };
      saveAutoState(auto.state);
      auto.lastAt = Date.now();
      F.autoNotify('Modo automático ativo para ' + games[0].name + '.');
    } else if (state && (!games.length || !auto.on)) {
      await core.ps(autoStopScript(state), 30000);
      auto.state = null;
      saveAutoState(null);
      auto.lastAt = Date.now();
    }
  } catch (e) {
  } finally {
    autoBusy = false;
  }
};

// A notificação é do Electron (main.js); aqui só existe o gancho, porque
// features.js também roda fora dele (nos testes). Mudar isto não pode quebrar o tick.
F.autoNotify = () => {};
F.setAutoNotifier = (fn) => { F.autoNotify = typeof fn === 'function' ? fn : () => {}; };

// A tabela de processos por jogo (o `proc` do GDZ), exposta para quem precisa da lista
// ESTÁTICA de jogos conhecidos — o medidor de FPS escolhe o alvo por ela. runningGameIds
// só devolve o que está aberto AGORA, o que não serve para pontuar o alvo.
F.AUTO_GAME_PROCS = AUTO_GAME_PROCS;
F.procMatchers = procMatchers;

// Ganchos para o teste conseguir exercitar as peças puras sem aplicar nada.
// Não é API pública — a tela e o main.js não usam nada daqui.
F.__autoStartScript = autoStartScript;
F.__autoStopScript = autoStopScript;
F.__cleanAutoState = cleanAutoState;
F.__autoTick = F.autoTick;
// O estado do modo é fechado no módulo; o teste precisa poder lê-lo e trocá-lo.
F.__auto = () => auto;
F.__setAutoState = (s) => { auto.state = cleanAutoState(s); };

// Chamado pelo "desfazer tudo" / saída do app: devolve o PC ao estado de antes
// sem depender do próximo tick.
F.autoRestore = async () => {
  const state = cleanAutoState(auto.state);
  if (!state) return { success: true };
  await core.ps(autoStopScript(state), 30000);
  auto.state = null;
  saveAutoState(null);
  return { success: true };
};

// ────────────────────────────── LIMPEZA DE RAM ──────────────────────────────
const ram = { on: false, minutes: 10, interval: null, nextAt: null, lastAt: null, lastAuto: false, lastFreedMB: null };
const RAM_FILE = 'ram-auto.json';

F.ramState = () => ({
  auto: ram.on,
  minutes: ram.minutes,
  intervals: [10, 20, 30, 60],
  nextAt: ram.nextAt,
  lastAt: ram.lastAt,
  lastAuto: ram.lastAuto,
  lastFreedMB: ram.lastFreedMB,
});

function scheduleRam() {
  if (ram.interval) clearInterval(ram.interval);
  ram.interval = null;
  ram.nextAt = null;
  if (!ram.on) return;
  const ms = ram.minutes * 60000;
  ram.nextAt = Date.now() + ms;
  ram.interval = setInterval(async () => {
    const r = await F.ramClean({ auto: true });
    if (r.success) ram.nextAt = Date.now() + ms;
  }, ms);
}

F.ramAutoSet = (arg) => {
  if (arg && typeof arg === 'object') {
    if (typeof arg.on === 'boolean') ram.on = arg.on;
    if (arg.minutes) ram.minutes = Math.max(5, Math.min(240, Number(arg.minutes) || ram.minutes));
  } else ram.on = !!arg;
  writeJson(RAM_FILE, { on: ram.on, minutes: ram.minutes });
  scheduleRam();
  return F.ramState();
};

F.ramStart = () => {
  const cfg = readJson(RAM_FILE, { on: false, minutes: 10 });
  ram.on = !!cfg.on;
  ram.minutes = cfg.minutes || 10;
  scheduleRam();
};

F.ramClean = async (opts) => {
  const isAuto = !!(opts && opts.auto);
  // Purga a STANDBY LIST, como o GDZ faz.
  //
  // A versão anterior usava EmptyWorkingSet em cada processo com mais de 80 MB.
  // Isso tira a memória de dentro dos programas em uso: eles têm de ler tudo do
  // disco de novo na próxima vez e o arquivo de paginação cresce. Com a paginação
  // quebrada (ver a correção do Pagefile), foi isso que fechou programas por falta
  // de memória.
  //
  // A standby list é o cache de arquivos em repouso — memória que não pertence a
  // nenhum programa e que o Windows reaproveita sem custo. Limpar ela devolve RAM
  // sem prejudicar ninguém.
  //
  // RtlAdjustPrivilege(13) liga SeProfileSingleProcess (obrigatório em processo
  // elevado); NtSetSystemInformation(80, 4, 4) = SystemMemoryListInformation com
  // MemoryPurgeStandbyList.
  const r = await core.ps(`
    $os = Get-CimInstance Win32_OperatingSystem
    $before = [double]$os.FreePhysicalMemory
    $stBefore = 0
    foreach ($n in @("StandbyCacheNormalPriorityBytes","StandbyCacheReserveBytes","StandbyCacheCoreBytes")) {
      $v = (Get-Counter ("\\Memory\\" + $n) -ErrorAction SilentlyContinue).CounterSamples
      if ($v) { $stBefore += [double]$v.CookedValue }
    }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MemPurge {
  [DllImport("ntdll.dll")] public static extern int RtlAdjustPrivilege(int p, bool enable, bool current, out bool was);
  [DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int cls, IntPtr info, int len);
  public static int Purge() {
    bool was;
    try { RtlAdjustPrivilege(13, true, false, out was); } catch {}
    IntPtr p = Marshal.AllocHGlobal(4);
    try {
      Marshal.WriteInt32(p, 4);
      return NtSetSystemInformation(80, p, 4);
    } finally { Marshal.FreeHGlobal(p); }
  }
}
"@
    $codigo = [MemPurge]::Purge()
    Start-Sleep -Milliseconds 400
    $after = [double](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    $stAfter = 0
    foreach ($n in @("StandbyCacheNormalPriorityBytes","StandbyCacheReserveBytes","StandbyCacheCoreBytes")) {
      $v = (Get-Counter ("\\Memory\\" + $n) -ErrorAction SilentlyContinue).CounterSamples
      if ($v) { $stAfter += [double]$v.CookedValue }
    }
    $mb = [math]::Round(($after - $before) / 1024, 0)
    $st = [math]::Round(($stBefore - $stAfter) / 1MB, 0)
    Write-Output (Json @{ freed = $mb; standby = $st; codigo = $codigo })`, 120000);
  let freed = 0, st = 0, codigo = 0;
  try { const j = JSON.parse(r.out); freed = Math.max(0, j.freed || 0); st = Math.max(0, j.standby || 0); codigo = j.codigo || 0; } catch (e) {}
  ram.lastAt = Date.now();
  ram.lastAuto = isAuto;
  ram.lastFreedMB = freed;
  // NtSetSystemInformation devolve 0 quando o purge é aceito. Diferente de 0 é
  // "não consegui" — normalmente por não estar elevado. Antes a mensagem dizia
  // "Cache já estava limpo" mesmo nesse caso.
  const ok = r.ok && codigo === 0;
  return {
    success: ok,
    freed,
    standby: st,
    message: ok
      ? (freed > 0 ? `${freed} MB liberados do cache da RAM.` : "Cache da RAM já estava limpo.")
      : "Não foi possível limpar a RAM. Abra o programa como administrador.",
    error: ok ? undefined : (r.err || "precisa de administrador"),
  };
};

module.exports = F;
