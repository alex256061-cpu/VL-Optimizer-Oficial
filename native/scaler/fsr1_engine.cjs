// fsr1_engine.cjs — backend D3D11 do motor de upscale (EASU + RCAS)
// Substitui o Lossless Scaling. MIT na parte FSR (AMD); o resto é nosso.
//
// Fluxo por frame:
//   1. captura a janela-alvo (WGC via duplicação de monitor simplificada ou BitBlt GDI)
//   2. copia para SRV de entrada
//   3. dispatch EASU -> textura intermediária
//   4. dispatch RCAS -> back buffer da janela overlay/destino
//   5. Present
//
// Este arquivo usa ffmpeg-free BitBlt via `desktopCapturer`? Não: é processo Node
// puro que fala com um helper D3D11. Aqui fica a API de alto nível + fallback.
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

// ─────────────────────────────────────────────────────────────
// Detecção de capacidade (o cliente NÃO precisa ter nada instalado)
// ─────────────────────────────────────────────────────────────
async function probe() {
  if (!IS_WIN) {
    return { ok: false, reason: 'Motor de upscale só roda no Windows (D3D11).' };
  }
  // o helper carrega os shaders pré-compilados embutidos
  const shaderDir = path.join(__dirname, 'shaders');
  const haben = fs.existsSync(path.join(shaderDir, 'fsr1_easu.cso')) &&
                fs.existsSync(path.join(shaderDir, 'fsr1_rcas.cso'));
  return {
    ok: haben,
    backend: 'd3d11',
    shaders: shaderDir,
    reason: haben ? null : 'Shaders não compilados. Rode `node native/scaler/build.js` no build do app.',
  };
}

// ─────────────────────────────────────────────────────────────
// Ciclo de vida do motor
// ─────────────────────────────────────────────────────────────
const state = {
  proc: null,
  cfg: null,
  running: false,
  lastError: null,
  frameLog: [],
};

function engineExePath() {
  // em produção: binário empacotado ao lado do app
  const exe = path.join(__dirname, 'fsr1_engine.exe');
  return fs.existsSync(exe) ? exe : null;
}

function sanitizeConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    target: String(c.target || ''),
    scaleType: ['fsr', 'nis', 'ls1', 'off'].includes(c.scaleType) ? c.scaleType : 'fsr',
    fsrType: 'EASU_RCAS',
    sharpness: Math.max(0, Math.min(100, Math.round(Number(c.sharpness) || 0))),
    scaleMode: c.scaleMode === 'custom' ? 'custom' : 'auto',
    scaleFactor: Math.max(1.0, Math.min(4.0, Number(c.scaleFactor) || 1.5)),
    syncMode: ['standard', 'vsync', 'gsync', 'adaptive'].includes(c.syncMode) ? c.syncMode : 'standard',
    hdrCompat: !!c.hdrCompat,
    drawFps: !!c.drawFps,
    captureApi: c.captureApi === 'wgc' ? 'wgc' : 'dxgi',
  };
}

async function start(rawCfg) {
  const cap = await probe();
  if (!cap.ok) return { success: false, error: cap.reason };

  const cfg = sanitizeConfig(rawCfg);
  const exe = engineExePath();
  if (!exe) {
    return {
      success: false,
      error: 'Backend nativo ainda não compilado (native/scaler/fsr1_engine.exe). Rode build.js.',
      needsBuild: true,
    };
  }

  await stop();
  state.cfg = cfg;

  // JSON vai por arquivo: o CRT tokeniza argv e remove as aspas
  const os = require('os');
  const cfgFile = path.join(os.tmpdir(), `vl-scaler-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(cfgFile, JSON.stringify(cfg), 'utf8');
  } catch (e) {
    return { success: false, error: 'Falha ao gravar config temporário: ' + e.message };
  }
  state.cfgFile = cfgFile;

  state.proc = spawn(exe, ['--config-file', cfgFile], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.running = true;

  state.proc.stdout.on('data', (d) => {
    const s = String(d).trim();
    if (s) state.frameLog.push(s);
    if (state.frameLog.length > 400) state.frameLog.shift();
  });
  state.proc.stderr.on('data', (d) => { state.lastError = String(d).trim() || state.lastError; });

  state.proc.on('exit', (code) => {
    state.running = false;
    state.proc = null;
    if (code && code !== 0) state.lastError = 'Motor encerrou com código ' + code;
  });

  return { success: true, backend: 'd3d11', shaders: cap.shaders, cfg };
}

async function stop() {
  if (state.proc) {
    try { state.proc.kill(); } catch (e) {}
    state.proc = null;
  }
  state.running = false;
  if (state.cfgFile) {
    try { fs.unlinkSync(state.cfgFile); } catch (e) {}
    state.cfgFile = null;
  }
  return { success: true };
}

function status() {
  return { running: state.running, cfg: state.cfg, lastError: state.lastError, log: state.frameLog.slice(-40) };
}

module.exports = { probe, start, stop, status, sanitizeConfig };
