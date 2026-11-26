// seguranca-navegacao.js — proteções de navegação e permissões do Electron.
//
// O app carrega só arquivos LOCAIS (src/*.html). Sem estas travas, um link/renderer
// podia navegar a janela do app para um site externo (phishing com cara de VL) ou abrir
// janelas novas com conteúdo de fora. Aqui:
//   - navegação só é permitida para arquivos dentro da pasta do app;
//   - link http(s)/mailto abre no navegador do Windows (shell.openExternal);
//   - janela nova (window.open/target=_blank) é sempre negada;
//   - permissões de mídia/localização/notificação são negadas (o app não usa isso).
//
// As funções puras (podeNavegar/urlExternaSegura) são testáveis fora do Electron.
'use strict';

const path = require('path');

// Permissões que o app realmente pode precisar. Clipboard é usado em duas telas
// (copiar diagnóstico/chave). O resto é negado.
const PERMISSOES_PERMITIDAS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
]);

function urlExternaSegura(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch (e) {
    return false;
  }
}

// Um arquivo local só pode ser carregado se estiver DENTRO da pasta do app.
// Evita file:///C:/Windows/... ou file:///C:/outra-pasta/...
function podeNavegar(url, raiz) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol === 'about:') return u.pathname === 'blank';
    if (u.protocol !== 'file:') return false;
    let caminho = decodeURIComponent(u.pathname || '');
    // Windows: /C:/pasta/arquivo.html -> C:/pasta/arquivo.html
    if (/^\/[A-Za-z]:[\\/]/.test(caminho)) caminho = caminho.slice(1);
    const base = path.resolve(String(raiz || ''));
    const alvo = path.resolve(caminho);
    if (process.platform === 'win32') {
      const b = base.toLowerCase();
      const a = alvo.toLowerCase();
      return a === b || a.startsWith(b + path.sep.toLowerCase()) || a.startsWith(b + '/');
    }
    return alvo === base || alvo.startsWith(base + path.sep);
  } catch (e) {
    return false;
  }
}

// Aplica as travas em um webContents. `shell` é injetado para o teste poder simular.
function aplicar(contents, opcoes) {
  const opt = opcoes || {};
  const shell = opt.shell || require('electron').shell;
  const raiz = opt.raiz || path.join(__dirname);
  if (!contents || typeof contents.setWindowOpenHandler !== 'function') return false;

  contents.setWindowOpenHandler(({ url }) => {
    try {
      if (urlExternaSegura(url)) shell.openExternal(url);
    } catch (e) { }
    return { action: 'deny' };
  });

  const bloquear = (evento, url) => {
    try {
      if (!podeNavegar(url, raiz)) {
        evento.preventDefault();
        if (urlExternaSegura(url)) {
          try { shell.openExternal(url); } catch (e) { }
        }
      }
    } catch (e) { }
  };

  contents.on('will-navigate', (evento, url) => bloquear(evento, url));
  contents.on('will-redirect', (evento, url) => bloquear(evento, url));
  // O app não usa <webview>; qualquer tentativa é recusada.
  contents.on('will-attach-webview', (evento) => { try { evento.preventDefault(); } catch (e) { } });
  return true;
}

// Handler de permissões (câmera, micro, localização, notificação etc.).
function aplicarPermissoes(sessao, permitidas) {
  const ok = permitidas || PERMISSOES_PERMITIDAS;
  if (!sessao || typeof sessao.setPermissionRequestHandler !== 'function') return false;
  sessao.setPermissionRequestHandler((wc, permissao, callback) => {
    try { callback(ok.has(permissao)); } catch (e) { try { callback(false); } catch (e2) { } }
  });
  if (typeof sessao.setPermissionCheckHandler === 'function') {
    sessao.setPermissionCheckHandler((wc, permissao) => ok.has(permissao));
  }
  return true;
}

module.exports = { urlExternaSegura, podeNavegar, aplicar, aplicarPermissoes, PERMISSOES_PERMITIDAS };
