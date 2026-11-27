// game-boost.js — Game Boost por jogo, versão segura.
//
// Escopo desta versão (P0):
//   - prioridade do processo do jogo (AboveNormal/High), com preparação e
//     checkpoint ANTES de mutar;
//   - timer de alta resolução por sessão, num helper PowerShell que recebe o
//     script por STDIN (nunca por arquivo em pasta gravável), fica vivo enquanto
//     o jogo existir e se encerra sozinho quando o jogo fecha.
//
// Fora de escopo de propósito:
//   - suspensão de apps (precisa de watchdog independente; não publicar sem isso);
//   - afinidade de núcleos, serviços, QoS, refresh rate, vibrance, BCD/HPET.
//
// Toda ação tem rollback. O state do boost é sanitizado e não contém caminho
// executável; o app nunca dá Start-Process em dados do estado.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./engine');
const MARCA = require('./marca');

const DATA = () => process.env.LOPT_DATA_DIR || path.join(MARCA.dirDados, 'data');
const profileFile = () => path.join(DATA(), 'game-profiles.json');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const PRIORITIES = ['keep', 'above', 'high'];
const PRIORITY_CLASS = { above: 'AboveNormal', high: 'High' };
const PREVIOUS_ALLOWED = new Set(['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High']);
const GAME_ID_RE = /^[A-Za-z0-9_.* -]{1,80}$/;

const liveTimers = new Map(); // token -> { child, pid }

function sanitizeGameId(raw) {
  const id = String(raw == null ? '' : raw).trim().toLowerCase();
  return GAME_ID_RE.test(id) && id.endsWith('.exe') ? id : null;
}

function sanitizeProfile(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    priority: PRIORITIES.includes(r.priority) ? r.priority : 'keep',
    timer: r.timer === true,
  };
}

function sanitizeBoostState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { profileId: sanitizeGameId(raw.profileId) || '', timer: null, priority: [] };
  if (raw.timer && typeof raw.timer === 'object') {
    const token = String(raw.timer.token || '');
    if (/^[a-f0-9]{16,64}$/i.test(token)) {
      out.timer = { token: token.toLowerCase() };
      if (raw.timer.startedAt != null && /^\d{1,20}$/.test(String(raw.timer.startedAt))) out.timer.startedAt = String(raw.timer.startedAt);
    }
  }
  for (const it of (Array.isArray(raw.priority) ? raw.priority : []).slice(0, 8)) {
    if (!it || typeof it !== 'object') continue;
    const pid = Number(it.pid);
    const start = /^\d{1,20}$/.test(String(it.start)) ? String(it.start) : null;
    const previous = typeof it.previous === 'string' && PREVIOUS_ALLOWED.has(it.previous) ? it.previous : null;
    if (!Number.isInteger(pid) || pid <= 0 || !start || !previous) continue;
    out.priority.push({ pid, start, previous });
  }
  if (!out.profileId && !out.timer && !out.priority.length) return null;
  return out;
}

function readProfiles() {
  try {
    const j = JSON.parse(fs.readFileSync(profileFile(), 'utf8'));
    const games = j && typeof j === 'object' && j.games && typeof j.games === 'object' ? j.games : {};
    const out = {};
    for (const [id, p] of Object.entries(games)) {
      const gid = sanitizeGameId(id);
      if (gid) out[gid] = sanitizeProfile(p);
    }
    return out;
  } catch (e) {
    return {};
  }
}

function writeProfiles(games) {
  try {
    fs.mkdirSync(DATA(), { recursive: true });
    const file = profileFile();
    const tmp = file + '.tmp';
    const text = JSON.stringify({ version: 1, games }, null, 1);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (e) { }
    try { fs.renameSync(tmp, file); }
    catch (e) { try { fs.rmSync(file, { force: true }); } catch (e2) { } fs.renameSync(tmp, file); }
    return true;
  } catch (e) {
    return false;
  }
}

function profileFor(gameId) {
  const id = sanitizeGameId(gameId);
  if (!id) return sanitizeProfile(null);
  return readProfiles()[id] || sanitizeProfile(null);
}

// `knownIds` é obrigatório: a UI só pode gravar IDs que o detector conhece.
function setProfile(gameId, raw, knownIds) {
  const id = sanitizeGameId(gameId);
  if (!id) return { success: false, error: 'Jogo inválido.' };
  const allowed = knownIds instanceof Set ? knownIds : (Array.isArray(knownIds) ? new Set(knownIds) : null);
  if (allowed && !allowed.has(id)) return { success: false, error: 'Jogo desconhecido para o Game Boost.' };
  const p = sanitizeProfile(raw);
  const games = readProfiles();
  if (!p.enabled && p.priority === 'keep' && !p.timer) delete games[id];
  else games[id] = p;
  if (!writeProfiles(games)) return { success: false, error: 'Não foi possível salvar o perfil.' };
  return { success: true, profile: p };
}

function listInfo(knownGames) {
  const profiles = readProfiles();
  const list = Array.isArray(knownGames) ? knownGames : [];
  const seen = new Set();
  const games = [];
  for (const item of list) {
    const id = sanitizeGameId(item && item[0]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    games.push({ id, name: String((item && item[1]) || id).slice(0, 80), profile: profiles[id] || sanitizeProfile(null) });
  }
  return { success: true, games };
}

// ── prioridade em duas fases ────────────────────────────────────────────────

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function gameProcessPattern(gameId) { return String(gameId || '').replace(/\.exe$/i, ''); }
function parseMarked(text, marker) {
  const m = new RegExp('^' + marker + ':\\s*(.+)$', 'm').exec(String(text || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function asArray(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []); }

// Fase 1: só LÊ quem seria alterado. O resultado vai para o auto-state antes
// de qualquer mutação, então um crash aqui não deixa prioridade alterada.
async function preparePriority(gameId) {
  const name = psQuote(gameProcessPattern(gameId));
  const r = await core.ps(`
    $name = ${name}
    $out = @()
    foreach ($p in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
      try { $out += [ordered]@{ pid = $p.Id; start = [string]$p.StartTime.Ticks; previous = [string]$p.PriorityClass } } catch {}
    }
    Write-Output ('VL_BOOST_PREP: ' + (ConvertTo-Json -InputObject @($out) -Compress))
  `, 15000);
  if (!r.ok) return { list: [], warning: 'Não foi possível ler a prioridade do jogo.' };
  const rawList = asArray(parseMarked(r.out, 'VL_BOOST_PREP'));
  const list = rawList
    .map((it) => ({
      pid: Number(it && it.pid),
      start: /^\d{1,20}$/.test(String(it && it.start)) ? String(it.start) : null,
      previous: PREVIOUS_ALLOWED.has(String(it && it.previous)) ? String(it.previous) : null,
    }))
    .filter((it) => Number.isInteger(it.pid) && it.pid > 0 && it.start && it.previous)
    .slice(0, 8);
  return { list, warning: list.length ? '' : 'O processo do jogo não foi encontrado para mudar a prioridade.' };
}

// Fase 2: aplica usando só PID + StartTime já validados. Se algo falhar, a
// fase 1 já está persistida e o rollback devolve a classe anterior.
async function applyPriorityList(list, priority) {
  const cls = PRIORITY_CLASS[priority];
  if (!cls) return { warning: '' };
  const clean = (Array.isArray(list) ? list : []).filter((x) => x && Number.isInteger(Number(x.pid)) && /^\d{1,20}$/.test(String(x.start)));
  if (!clean.length) return { warning: '' };
  const b64 = Buffer.from(JSON.stringify(clean), 'utf8').toString('base64');
  const r = await core.ps(`
    $list = @(([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json))
    $ok = 0
    foreach ($it in $list) {
      try {
        $p = Get-Process -Id ([int]$it.pid) -ErrorAction Stop
        if ($p.StartTime.Ticks.ToString() -eq [string]$it.start) { $p.PriorityClass = '${cls}'; $ok++ }
      } catch {}
    }
    Write-Output ('VL_BOOST_APPLIED: ' + $ok)
  `, 15000);
  if (!r.ok) return { warning: 'Não foi possível aplicar a prioridade do jogo.' };
  const m = /VL_BOOST_APPLIED:\s*(\d+)/.exec(r.out || '');
  return { warning: !m ? 'A prioridade do jogo não foi confirmada.' : (Number(m[1]) > 0 ? '' : 'O processo do jogo já não estava aberto.') };
}

async function restorePriority(list, gameId) {
  const clean = (Array.isArray(list) ? list : []).filter((x) => x && Number.isInteger(Number(x.pid)) && /^\d{1,20}$/.test(String(x.start)) && PREVIOUS_ALLOWED.has(String(x.previous || '')));
  if (!clean.length) return { success: true };
  const expected = gameProcessPattern(gameId || '').toLowerCase();
  if (!expected) return { success: false };
  const b64 = Buffer.from(JSON.stringify(clean), 'utf8').toString('base64');
  const exp64 = Buffer.from(expected, 'utf8').toString('base64');
  const r = await core.ps(`
    $list = @(([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json))
    $expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${exp64}')).ToLower()
    foreach ($it in $list) {
      try {
        $p = Get-Process -Id ([int]$it.pid) -ErrorAction Stop
        if (([string]$p.ProcessName).ToLower() -notlike $expected) { continue }
        if ($p.StartTime.Ticks.ToString() -eq [string]$it.start -and [string]$p.PriorityClass -ne [string]$it.previous) {
          $p.PriorityClass = [string]$it.previous
        }
      } catch {}
    }
    Write-Output 'ok'
  `, 15000);
  return { success: !!r.ok };
}

// ── timer de alta resolução ─────────────────────────────────────────────────
// Script vai por STDIN; nada é gravado em pasta do usuário e nada é executado
// a partir de caminho no estado. O helper morre sozinho quando o jogo fecha.

function timerScript(gameId, token) {
  const game = psQuote(gameProcessPattern(gameId));
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class VLBoostTimer {
  [DllImport("ntdll.dll")] public static extern int NtQueryTimerResolution(out uint minimum, out uint maximum, out uint current);
  [DllImport("ntdll.dll")] public static extern int NtSetTimerResolution(uint desired, bool set, out uint actual);
}
"@
$min = 0; $max = 0; $cur = 0
[VLBoostTimer]::NtQueryTimerResolution([ref]$min, [ref]$max, [ref]$cur) | Out-Null
$requested = 5000
if ($max -gt 0 -and $max -lt $requested) { $requested = $max }
$actual = 0
$rc = [VLBoostTimer]::NtSetTimerResolution([uint32]$requested, $true, [ref]$actual)
$self = Get-Process -Id $PID -ErrorAction SilentlyContinue
Write-Output ('VL_BOOST_TIMER: ' + (ConvertTo-Json -InputObject ([ordered]@{ rc = [int]$rc; actual = [uint32]$actual; token = '${token}'; start = [string]$self.StartTime.Ticks }) -Compress))
$game = ${game}
while ($true) {
  Start-Sleep -Milliseconds 1000
  if (-not @(Get-Process -Name $game -ErrorAction SilentlyContinue).Count) { break }
}
exit 0`;
}

function startTimer(gameId) {
  return new Promise((resolve) => {
    const token = crypto.randomBytes(16).toString('hex');
    let child;
    try {
      // -EncodedCommand: script não passa por arquivo em pasta do usuário.
      const encoded = Buffer.from(timerScript(gameId, token), 'utf16le').toString('base64');
      child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({ timer: null, warning: 'Não foi possível iniciar o timer de alta resolução.' });
    }
    let done = false;
    let buf = '';
    const finish = (timer, warning) => {
      if (done) return;
      done = true;
      resolve({ timer, warning });
    };
    const timeout = setTimeout(() => {
      try { child.kill(); } catch (e) { }
      finish(null, 'O timer de alta resolução não confirmou em 6 s.');
    }, 6000);
    child.stdout.on('data', (d) => {
      buf += String(d);
      const m = /VL_BOOST_TIMER:\s*(\{[^\r\n]+\})/.exec(buf);
      if (!m) return;
      let data = null;
      try { data = JSON.parse(m[1]); } catch (e) { }
      if (!data || data.rc !== 0 || data.token !== token) return;
      clearTimeout(timeout);
      liveTimers.set(token, { child, pid: child.pid });
      child.once('exit', () => { liveTimers.delete(token); });
      try { child.stdout.removeAllListeners('data'); } catch (e) { }
      try { child.stderr.removeAllListeners('data'); } catch (e) { }
      try { child.unref(); } catch (e) { }
      finish({ token, startedAt: String(data.start || '') }, '');
    });
    child.once('error', () => { clearTimeout(timeout); finish(null, 'Não foi possível iniciar o timer de alta resolução.'); });
    child.once('exit', () => { clearTimeout(timeout); finish(null, 'O timer de alta resolução não ficou ativo.'); });
  });
}

function stopTimer(timer) {
  const token = String(timer && timer.token || '').toLowerCase();
  const live = liveTimers.get(token);
  // Estado vindo de outra execução não derruba PID nenhum: o helper já se
  // encerra sozinho quando o jogo fecha. Só mata o child desta execução.
  if (!live) return { success: true };
  try { live.child.kill(); } catch (e) { }
  liveTimers.delete(token);
  return { success: true };
}

async function apply(gameId, rawProfile, onState) {
  const id = sanitizeGameId(gameId);
  const p = sanitizeProfile(rawProfile);
  if (!id || !p.enabled) return { state: null, warnings: [] };
  if (p.priority === 'keep' && !p.timer) return { state: null, warnings: [] };
  const warnings = [];
  const state = { profileId: id, timer: null, priority: [] };
  const checkpoint = () => {
    if (typeof onState !== 'function') return;
    try { onState(sanitizeBoostState(state)); } catch (e) { }
  };

  if (p.priority !== 'keep') {
    const prep = await preparePriority(id);
    if (prep.warning) warnings.push(prep.warning);
    state.priority = prep.list;
    // Persiste a INTENÇÃO/PIDs antes de mutar: crash aqui não perde rollback.
    checkpoint();
    if (prep.list.length) {
      const applied = await applyPriorityList(prep.list, p.priority);
      if (applied.warning) warnings.push(applied.warning);
    }
  }

  if (p.timer) {
    const r = await startTimer(id);
    if (r.warning) warnings.push(r.warning);
    else state.timer = r.timer;
    checkpoint();
  }

  return { state: sanitizeBoostState(state), warnings };
}

async function restore(state) {
  const s = sanitizeBoostState(state);
  if (!s) return { success: true, warnings: [] };
  const warnings = [];
  try { stopTimer(s.timer); } catch (e) { warnings.push('Não foi possível encerrar o timer do Game Boost.'); }
  try {
    const r = await restorePriority(s.priority, s.profileId);
    if (!r.success) warnings.push('Não foi possível restaurar a prioridade do jogo.');
  } catch (e) { warnings.push('Não foi possível restaurar a prioridade do jogo.'); }
  return { success: warnings.length === 0, warnings };
}

module.exports = {
  PRIORITIES, sanitizeProfile, sanitizeBoostState, sanitizeGameId,
  readProfiles, writeProfiles, profileFor, setProfile, listInfo,
  apply, restore,
  __preparePriority: preparePriority, __applyPriorityList: applyPriorityList, __restorePriority: restorePriority,
  __startTimer: startTimer, __stopTimer: stopTimer,
};
