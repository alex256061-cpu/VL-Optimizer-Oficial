// features.js — elevação, modo automático dos jogos, limpeza de RAM real
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const core = require('./engine');

const DATA = () => process.env.LOPT_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'VLOptimizer', 'data');
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
const auto = { on: false, active: false, prevPlan: null, timer: null, game: null, lastAt: 0 };
const AUTO_FILE = 'auto-mode.json';

F.autoState = () => ({ on: auto.on, active: auto.active, game: auto.game, lastAt: auto.lastAt });

F.autoSet = (arg) => {
  const on = typeof arg === 'object' ? !!arg.on : !!arg;
  auto.on = on;
  writeJson(AUTO_FILE, { on });
  if (on) F.autoStart(); else F.autoStop();
  return { success: true, autoMode: auto.on, state: F.autoState() };
};

F.autoStart = () => {
  auto.on = readJson(AUTO_FILE, { on: false }).on;
  if (!auto.on || auto.timer) return;
  auto.timer = setInterval(F.autoTick, 5000);
  F.autoTick();
};
F.autoStop = () => { if (auto.timer) clearInterval(auto.timer); auto.timer = null; if (auto.active) F.autoRestore(); };

const GAME_RE = /fivem|gta5|gta5_enhanced|cs2|valorant|fortnite|warzone|modernwarfare|apex|rust|pubg|league|rocketleague|overwatch|minecraft|bf6|battlefield|thefinals|dota2|destiny2|deadbydaylight|tarkov/i;

F.runningGame = async () => {
  const r = await core.ps(`
    $o = @()
    foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
      if ($p.Id -eq ${process.pid}) { continue }
      if ($p.ProcessName -match 'fivem|gta5|cs2|valorant|fortnite|warzone|modernwarfare|apex|rust|pubg|league|rocketleague|overwatch|minecraft|bf6|battlefield|thefinals|dota2|destiny2|deadbydaylight|tarkov') { $o += @{ id=$p.Id; name=$p.ProcessName } }
    }
    Write-Output (Json $o)`, 20000);
  try { const a = JSON.parse(r.out); const list = Array.isArray(a) ? a : (a ? [a] : []); return list[0] || null; } catch (e) { return null; }
};

F.autoApply = async (game) => {
  const caps = await core.getCaps();
  const skipPlan = !!caps.laptop || !!caps.x3dDual; // notebook e X3D dual-CCD ficam de fora do plano
  if (!skipPlan) {
    const g = await core.ps(`$g = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value; Write-Output $g`);
    const prev = g.out.split('\n')[0].trim();
    if (prev) writeJson('auto-prev-plan.json', { plan: prev, at: Date.now() });
    await core.ps(`powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; Write-Output 'ok'`);
  }
  await core.ps(`
    foreach ($n in @('chrome','discord')) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { try { $_.PriorityClass = 'BelowNormal' } catch {} } }
    foreach ($n in @('OneDrive','Dropbox','GoogleDriveFS')) { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
    Write-Output 'ok'`, 30000);
  auto.active = true;
  auto.game = game ? game.name : null;
};

F.autoRestore = async () => {
  const saved = readJson('auto-prev-plan.json', null);
  if (saved && saved.plan) await core.ps(`powercfg /setactive '${String(saved.plan).replace(/'/g, "''")}'; Write-Output 'ok'`);
  auto.active = false;
  auto.game = null;
};

let ticking = false;
F.autoTick = async () => {
  if (ticking || !auto.on) return;
  ticking = true;
  try {
    const game = await F.runningGame();
    if (game && !auto.active) { await F.autoApply(game); auto.lastAt = Date.now(); }
    else if (!game && auto.active) { await F.autoRestore(); auto.lastAt = Date.now(); }
  } catch (e) {}
  ticking = false;
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
  const r = await core.ps(`
    $os = Get-CimInstance Win32_OperatingSystem
    $before = [double]$os.FreePhysicalMemory
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MemTrim { [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h); }'
    $n = 0
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
      try {
        if ($p.Id -eq $PID) { continue }
        if ($p.ProcessName -match '^(System|Idle|Registry|Memory Compression|csrss|wininit|services|lsass|smss|svchost|explorer|dwm|audiodg|fontdrvhost)$') { continue }
        if ($p.WorkingSet64 -lt 80MB) { continue }
        if ([MemTrim]::EmptyWorkingSet($p.Handle)) { $n++ }
      } catch {}
    }
    Start-Sleep -Milliseconds 350
    $after = [double](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    $mb = [math]::Round(($after - $before) / 1024, 0)
    Write-Output (Json @{ freed = $mb; processes = $n })`, 180000);
  let freed = 0, procs = 0;
  try { const j = JSON.parse(r.out); freed = Math.max(0, j.freed || 0); procs = j.processes || 0; } catch (e) {}
  ram.lastAt = Date.now();
  ram.lastAuto = isAuto;
  ram.lastFreedMB = freed;
  return {
    success: r.ok,
    freed,
    processes: procs,
    message: freed > 0 ? `${freed} MB liberados no cache da RAM.` : 'Cache da RAM já estava limpo.',
    error: r.ok ? undefined : (r.err || 'falha ao limpar'),
  };
};

module.exports = F;
