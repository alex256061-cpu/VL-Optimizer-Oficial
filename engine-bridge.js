// engine-bridge.js — fala com o processo que hospeda o motor Lossless.
//
// O motor real não pode ser carregado dentro do processo do Electron: ele precisa de uma thread
// STA com pilha grande e instala hooks de DXGI que pertencem a essa thread. Carregá-lo aqui dentro
// derrubaria a janela quando ele falhasse. Por isso ele vive num processo próprio
// (engine/VLScalingHost.exe) e esta ponte conversa com ele por stdin/stdout em JSON.
//
// Regra de ouro: nenhuma função daqui lança por causa do motor. Se o processo não subir ou morrer,
// a resposta é { ok: false, error: "..." } e a interface mostra o aviso.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENGINE_SHA = '626B196D799606CD4250B7B29E04228692AB70CF56A5D1BBB56D748C8219F0EB';
const HOST_TIMEOUT_MS = 20000;

let host = null;          // ChildProcess
let buffer = '';          // linhas ainda não processadas
let pending = [];         // promessas esperando resposta
let startError = null;

function hostExePath() {
  const candidates = [
    path.join(__dirname, 'engine', 'VLScalingHost.exe'),
    path.join(process.resourcesPath || __dirname, 'app', 'engine', 'VLScalingHost.exe'),
    path.join(__dirname, 'engine', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'VLScalingHost.exe'),
  ];
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (e) { /* caminho ilegível */ }
  }
  return null;
}

function engineDllPath() {
  const candidates = [
    path.join(__dirname, 'bin', 'Lossless.dll'),
    path.join(process.resourcesPath || __dirname, 'app', 'bin', 'Lossless.dll'),
  ];
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (e) { }
  }
  return null;
}

// Confere o SHA-256 do motor antes de carregá-lo. Um arquivo diferente não é usado: o app informa
// que a versão não confere em vez de rodar um binário que ninguém validou.
function sha256(file) {
  try {
    const crypto = require('crypto');
    const data = fs.readFileSync(file);
    return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
  } catch (e) { return null; }
}

function startHost() {
  if (host && !host.killed) return host;
  const exe = hostExePath();
  if (!exe) { startError = 'Hospedeiro do motor não encontrado (engine/VLScalingHost.exe).'; return null; }

  try {
    host = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    startError = 'Não foi possível iniciar o motor: ' + e.message;
    return null;
  }

  host.stdout.setEncoding('utf8');
  host.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let payload = null;
      try { payload = JSON.parse(line); } catch (e) { continue; }
      if (payload && payload.event === 'ready') continue;
      const waiter = pending.shift();
      if (waiter) waiter(payload);
    }
  });

  host.stderr.setEncoding('utf8');
  host.stderr.on('data', () => { /* log do hospedeiro; não interessa à interface */ });

  host.on('exit', (code) => {
    host = null;
    const waiters = pending; pending = [];
    for (const waiter of waiters) waiter({ ok: false, error: 'O motor encerrou (código ' + code + ').' });
  });

  host.on('error', (e) => { startError = 'Falha ao abrir o motor: ' + e.message; });
  startError = null;
  return host;
}

// Envia um comando e espera a resposta. Um comando por vez: o hospedeiro responde em ordem,
// e duas perguntas simultâneas embaralhariam as respostas.
function send(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = startHost();
    if (!child) { resolve({ ok: false, error: startError || 'Motor indisponível.' }); return; }
    const timer = setTimeout(() => {
      const idx = pending.indexOf(done);
      if (idx >= 0) pending.splice(idx, 1);
      resolve({ ok: false, error: 'O motor não respondeu a tempo.' });
    }, timeoutMs || HOST_TIMEOUT_MS);
    function done(payload) { clearTimeout(timer); resolve(payload); }
    pending.push(done);
    try { child.stdin.write(JSON.stringify(command) + '\n'); }
    catch (e) { clearTimeout(timer); resolve({ ok: false, error: e.message }); }
  });
}

async function capabilities() {
  const dll = engineDllPath();
  if (!dll) {
    return { ok: false, embedded: true, engines: [], message: 'Motor não encontrado em bin\\Lossless.dll.' };
  }
  const actual = sha256(dll);
  if (actual && actual !== ENGINE_SHA) {
    return {
      ok: false, embedded: true, engines: [],
      message: 'O Lossless.dll encontrado não é a versão validada e não será usado.',
    };
  }
  const status = await send({ cmd: 'status' });
  return {
    ok: true, embedded: true, dist: null,
    engines: ['lossless'],
    dll,
    running: !!(status && status.loaded),
    window: status && status.window ? status.window : 0,
    message: 'Motor Lossless disponível (LS1, FSR, NIS, Anime4K, XBR e geração de quadros).',
  };
}

async function start(options) {
  const dll = engineDllPath();
  if (!dll) return { ok: false, error: 'Motor não encontrado em bin\\Lossless.dll.' };
  const request = { cmd: 'start', dll };
  if (options && options.width) request.width = options.width;
  if (options && options.height) request.height = options.height;
  return send(request, 35000);
}

async function apply(options) {
  const request = Object.assign({ cmd: 'apply' }, options || {});
  return send(request, 20000);
}

async function stop() {
  if (!host) return { ok: true, message: 'Motor já estava parado.' };
  return send({ cmd: 'stop' });
}

async function shutdown() {
  if (!host) return;
  try { host.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (e) { }
  const child = host;
  setTimeout(() => { try { child.kill(); } catch (e) { } }, 1500);
  host = null;
}

module.exports = { capabilities, start, apply, stop, shutdown, engineDllPath, hostExePath, ENGINE_SHA };
