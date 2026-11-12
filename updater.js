// updater.js â€” atualizaÃ§Ã£o automÃ¡tica pelo GitHub Releases.
//
// O app consulta o release mais recente de alex256061-cpu/VL-Optimizer-Oficial e, quando hÃ¡ versÃ£o
// nova, baixa em segundo plano. O usuÃ¡rio escolhe quando instalar: nada reinicia sozinho no meio de
// uma otimizaÃ§Ã£o ou de uma mediÃ§Ã£o de FPS.
//
// Tudo aqui Ã© tolerante a falha. Sem internet, sem release, ou com o updater indisponÃ­vel, o app
// abre normalmente e a tela mostra "sem atualizaÃ§Ã£o" em vez de erro.
'use strict';

const { app, shell } = require('electron');

const REPO = 'alex256061-cpu/VL-Optimizer-Oficial';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 horas

let autoUpdater = null;
let state = {
  checked: false,
  available: false,
  version: null,
  currentVersion: null,
  downloading: false,
  percent: 0,
  downloaded: false,
  error: null,
};
let timer = null;
let listeners = [];   // funÃ§Ãµes avisadas quando o estado muda

function emit() {
  for (const fn of listeners) {
    try { fn({ ...state }); } catch (e) { /* ouvinte quebrado nÃ£o derruba o app */ }
  }
}

function onChange(fn) {
  if (typeof fn === 'function') listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

function currentVersion() {
  // `app` sÃ³ existe dentro do Electron; fora dele (teste em Node puro) cai no package.json.
  try { if (app && typeof app.getVersion === 'function') return app.getVersion(); }
  catch (e) { /* nÃ£o Ã© Electron */ }
  try { return require('./package.json').version; }
  catch (e) { return '0.0.0'; }
}

function status() {
  return { ...state, currentVersion: currentVersion(), repo: REPO };
}

// Abre a pÃ¡gina do release no navegador. Serve de saÃ­da quando o download automÃ¡tico falha â€” o
// usuÃ¡rio ainda consegue baixar Ã  mÃ£o.
function openReleasePage() {
  try { shell.openExternal('https://github.com/' + REPO + '/releases/latest'); }
  catch (e) { /* sem navegador: nada a fazer */ }
}

function isPackaged() {
  try { return !!(app && app.isPackaged); }
  catch (e) { return false; }
}

function init() {
  state.currentVersion = currentVersion();
  // Em desenvolvimento nÃ£o hÃ¡ app-update.yml e o updater lanÃ§a. SÃ³ ativa no app empacotado.
  if (!isPackaged()) {
    state.error = null;
    state.checked = true;
    return false;
  }
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    state.checked = true;
    state.error = 'AtualizaÃ§Ã£o automÃ¡tica indisponÃ­vel: ' + e.message;
    return false;
  }

  autoUpdater.autoDownload = true;          // baixa sozinho, mas nÃ£o instala sozinho
  autoUpdater.autoInstallOnAppQuit = false; // instalar Ã© escolha do usuÃ¡rio
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => { emit(); });
  autoUpdater.on('update-available', (info) => {
    state.available = true;
    state.version = info && info.version ? info.version : null;
    state.error = null;
    emit();
  });
  autoUpdater.on('update-not-available', () => {
    state.available = false;
    state.checked = true;
    state.error = null;
    emit();
  });
  autoUpdater.on('download-progress', (p) => {
    state.downloading = true;
    state.percent = p && typeof p.percent === 'number' ? Math.round(p.percent) : 0;
    emit();
  });
  autoUpdater.on('update-downloaded', (info) => {
    state.downloading = false;
    state.downloaded = true;
    state.available = true;
    state.version = info && info.version ? info.version : state.version;
    emit();
  });
  autoUpdater.on('error', (e) => {
    state.downloading = false;
    state.error = e && e.message ? e.message : String(e);
    emit();
  });

  return true;
}

async function check() {
  if (!autoUpdater) { emit(); return status(); }
  try {
    state.checked = true;
    await autoUpdater.checkForUpdates();
  } catch (e) {
    state.error = e && e.message ? e.message : String(e);
  }
  emit();
  return status();
}

// Instala a versÃ£o baixada e reinicia. SÃ³ Ã© chamado por aÃ§Ã£o explÃ­cita do usuÃ¡rio.
function install() {
  if (!autoUpdater || !state.downloaded) return { ok: false, error: 'Nenhuma atualizaÃ§Ã£o baixada.' };
  try {
    setImmediate(() => { try { autoUpdater.quitAndInstall(false, true); } catch (e) { } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function start() {
  if (!init()) return;
  // Primeira consulta some segundos depois de abrir: nÃ£o atrasa a janela.
  setTimeout(() => { check().catch(() => { }); }, 8000);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { check().catch(() => { }); }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, check, install, status, onChange, openReleasePage, REPO };
