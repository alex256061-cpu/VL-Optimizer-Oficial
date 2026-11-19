// updater.js — atualização automática pelo GitHub Releases.
//
// O app consulta o release mais recente de alex256061-cpu/VL-Optimizer-Oficial e, quando há versão
// nova, baixa em segundo plano. O usuário escolhe quando instalar: nada reinicia sozinho no meio de
// uma otimização ou de uma medição de FPS.
//
// Tudo aqui é tolerante a falha. Sem internet, sem release, ou com o updater indisponível, o app
// abre normalmente e a tela mostra "sem atualização" em vez de erro.
'use strict';

const fs = require('fs');
const { app, shell, net } = require('electron');
const MARCA = require('./marca');
const assinatura = require('./assinatura-update');

// De onde vem a atualização.
//
// Antes o app batia no GitHub (provider "github") e o botão "Ver no site" abria a página
// de releases. O usuário via o GitHub, não o produto. O GDZ não faz isso: ele usa
//   provider: generic
//   url: https://api.gdzfps.com/api/v1/updates
// ou seja, o servidor dele entrega o arquivo. Aqui é igual — o site publica os arquivos
// de atualização em /atualizacoes/ e o app busca lá.
//
// Os arquivos publicados nessa pasta são os que o electron-builder gera para o provider
// generic: latest.yml e o instalador (.exe).
const SITE = MARCA.site;
const UPDATE_URL = MARCA.urlAtualizacoes;
const DOWNLOAD_PAGE = MARCA.urlDownload;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 horas

// ── Assinatura da atualização ────────────────────────────────────────────────
//
// O electron-updater já confere o SHA-512 do .exe baixado contra o latest.yml. Isso
// pega download corrompido, mas NÃO pega quem troca o .exe E o latest.yml juntos —
// o sha512 do yml passa a descrever o arquivo malicioso e bate.
//
// A proteção extra é a mesma do GDZ: uma assinatura Ed25519 separada, feita com uma
// chave que NÃO está no servidor de arquivos e cuja pública está embutida aqui.
// A conferência em si mora em assinatura-update.js (testável fora do Electron).
//
// De onde vem a assinatura: GET <site>/atualizacoes/assinatura/<versão> -> { signature }
// (no GDZ é GET {API_URL}/updates/signature/<versão>, sem autenticação — aqui igual).
const ASSINATURA_URL = UPDATE_URL + '/assinatura/';

// PAR DO DEPLOY (assinatura-update.js / ferramentas/chave-atualizacao.js):
//   sem chave   -> verificação DESLIGADA (estado `assinatura: 'sem-chave'`)
//   com chave   -> tudo que for instalado precisa da assinatura dela
// A chave é da marca: cada revendedor assina a própria build com a própria chave.
const CHAVE_RELEASE = String(MARCA.chaveReleasePublica || '').trim();
const ASSINATURA_MODO = MARCA.assinaturaModo === 'opcional' ? 'opcional' : 'obrigatorio';


let autoUpdater = null;
let state = {
  checked: false,
  available: false,
  version: null,
  currentVersion: null,
  downloading: false,
  percent: 0,
  downloaded: false,
  conferindo: false,
  assinatura: null, // null | 'conferida' | 'sem-chave' | 'nao-conferida' | 'reprovada'
  error: null,
  notes: null,      // texto do release (o que mudou)
};
let timer = null;
let listeners = [];   // funções avisadas quando o estado muda

function emit() {
  for (const fn of listeners) {
    try { fn({ ...state }); } catch (e) { /* ouvinte quebrado não derruba o app */ }
  }
}

function onChange(fn) {
  if (typeof fn === 'function') listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

// Busca a assinatura do instalador no site. Sem autenticação, como no GDZ.
//
// Devolve a string base64 da assinatura, ou null quando o site não a tem / está fora.
// Nunca lança: quem chama trata "sem assinatura" conforme o modo.
async function buscarAssinatura(versao) {
  if (!versao) return null;
  const url = ASSINATURA_URL + encodeURIComponent(versao);
  try {
    const r = await net.fetch(url, {
      method: 'GET',
      headers: { 'content-type': 'application/json', 'user-agent': MARCA.nome + '/' + currentVersion() },
      signal: AbortSignal.timeout(12000),   // mesmo API_TIMEOUT_MS do GDZ
    });
    if (!r || r.status !== 200) return null;
    const dados = await r.json().catch(() => null);
    const sig = dados && dados.signature;
    return typeof sig === 'string' && sig.trim() ? sig.trim() : null;
  } catch (e) {
    return null;
  }
}

// Confere o instalador baixado ANTES de liberar a instalação.
//
// Este é o ponto do GDZ (`verifyInstaller` + o tratamento dentro de `update-downloaded`):
// se a conferência falhar, o instalador é APAGADO e a atualização não fica "pronta".
// O sha512 do electron-updater continua valendo — isto é uma camada a mais, não troca.
//
// Devolve null quando pode instalar, ou a MENSAGEM de erro quando não pode.
async function verificarInstalador(arquivo, versao) {
  if (!arquivo) return assinatura.MSG_SEM_ASSINATURA;

  const sig = await buscarAssinatura(versao);
  const r = await assinatura.conferirArquivo({
    arquivo,
    versao,
    assinaturaB64: sig,
    publicaB64: CHAVE_RELEASE,
    modo: ASSINATURA_MODO,
  });

  if (r.ok) {
    state.assinatura = r.pulado ? (r.motivo === 'sem-chave' ? 'sem-chave' : 'nao-conferida') : 'conferida';
    return null;
  }

  state.assinatura = 'reprovada';
  state.assinaturaDetalhe = r.motivo;
  try { fs.unlinkSync(arquivo); }        // lixo perigoso não fica no disco
  catch (e) { /* já não existia: nada a fazer */ }
  return r.mensagem || assinatura.MSG_NAO_CONFERE;
}

// O electron-updater entrega releaseNotes como string ou como lista de {version, note}.
// Aqui tudo vira uma string só, que é o que a tela mostra.
function extrairNotas(info) {
  try {
    const n = info && info.releaseNotes;
    if (!n) return null;
    if (typeof n === 'string') return n;
    if (Array.isArray(n)) {
      return n.map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object') {
          const t = String(x.version || '').trim();
          const corpo = String(x.note || '').trim();
          return (t ? '## ' + t + '\n' : '') + corpo;
        }
        return '';
      }).filter(Boolean).join('\n\n');
    }
    if (typeof n === 'object') return String(n.note || '');
  } catch (e) { }
  return null;
}

function currentVersion() {
  // `app` só existe dentro do Electron; fora dele (teste em Node puro) cai no package.json.
  try { if (app && typeof app.getVersion === 'function') return app.getVersion(); }
  catch (e) { /* não é Electron */ }
  try { return require('./package.json').version; }
  catch (e) { return '0.0.0'; }
}

function status() {
  return {
    ...state,
    currentVersion: currentVersion(),
    repo: UPDATE_URL,
    site: SITE,
    // Transparência: a tela (e o suporte) consegue dizer se a assinatura está ativa.
    assinaturaAtiva: assinatura.temChave(CHAVE_RELEASE),
    assinaturaModo: ASSINATURA_MODO,
  };
}

// Abre a página de download DO SITE. Serve de saída quando a atualização automática
// falha — o usuário baixa à mão, sem sair do produto.
function openReleasePage() {
  try { shell.openExternal(DOWNLOAD_PAGE); }
  catch (e) { /* sem navegador: nada a fazer */ }
}

function isPackaged() {
  try { return !!(app && app.isPackaged); }
  catch (e) { return false; }
}

function init() {
  state.currentVersion = currentVersion();
  // Em desenvolvimento não há app-update.yml e o updater lança. Só ativa no app empacotado.
  if (!isPackaged()) {
    state.error = null;
    state.checked = true;
    return false;
  }
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    state.checked = true;
    state.error = 'Atualização automática indisponível: ' + e.message;
    return false;
  }

  autoUpdater.autoDownload = true;          // baixa sozinho, mas não instala sozinho
  autoUpdater.autoInstallOnAppQuit = false; // instalar é escolha do usuário
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => { emit(); });
  autoUpdater.on('update-available', (info) => {
    state.available = true;
    state.version = info && info.version ? info.version : null;
    // releaseNotes vem do release do GitHub; pode ser string ou array de {version, note}
    state.notes = extrairNotas(info);
    state.error = null;
    state.downloaded = false;
    state.conferindo = false;
    state.assinatura = null;
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
  autoUpdater.on('update-downloaded', async (info) => {
    // Igual ao GDZ: o download NÃO é a última palavra. Antes de marcar "baixado" (e
    // portanto antes de liberar o botão Instalar), a assinatura é conferida.
    // O evento é async de propósito: a conferência lê ~140 MB. A tela mostra
    // "conferindo" nesse meio tempo (state.conferindo).
    const versao = info && info.version ? info.version : state.version;
    const arquivo = info && info.downloadedFile ? info.downloadedFile : null;

    state.downloading = false;
    state.downloaded = false;
    state.conferindo = true;
    state.version = versao || state.version;
    if (!state.notes) state.notes = extrairNotas(info);
    emit();

    let erro = null;
    try {
      erro = await verificarInstalador(arquivo, versao);
    } catch (e) {
      // Erro inesperado na conferência conta como reprovação: não instala no escuro.
      state.assinatura = 'reprovada';
      erro = assinatura.MSG_SEM_ASSINATURA;
      try { if (arquivo) fs.unlinkSync(arquivo); } catch (e2) { }
    }

    state.conferindo = false;
    if (erro) {
      // Instalador descartado: a tela volta a "sem atualização pronta" com o motivo.
      state.available = false;
      state.downloaded = false;
      state.version = null;
      state.percent = 0;
      state.error = erro;
      emit();
      return;
    }

    state.downloaded = true;
    state.available = true;
    state.version = versao || state.version;
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

// Instala a versão baixada e reinicia. Só é chamado por ação explícita do usuário.
function install() {
  // A tela checa r.success/r.error (main.js repassa o retorno direto).
  // Antes devolvia { ok } e, quando a atualização dava certo, a tela mostrava
  // "Não foi possível atualizar agora." — o inverso do que aconteceu.
  if (!autoUpdater || !state.downloaded) {
    return { success: false, ok: false, error: 'Nenhuma atualização baixada.' };
  }
  // Segunda fechadura: `downloaded` só fica true depois da assinatura conferida, mas
  // se algo reprovou no caminho, o botão não instala de jeito nenhum.
  if (state.assinatura === 'reprovada') {
    return { success: false, ok: false, error: assinatura.MSG_NAO_CONFERE };
  }
  try {
    setImmediate(() => { try { autoUpdater.quitAndInstall(false, true); } catch (e) { } });
    return { success: true, ok: true };
  } catch (e) {
    return { success: false, ok: false, error: e.message };
  }
}

function start() {
  if (!init()) return;
  // Primeira consulta some segundos depois de abrir: não atrasa a janela.
  setTimeout(() => { check().catch(() => { }); }, 8000);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { check().catch(() => { }); }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  start, stop, check, install, status, onChange, openReleasePage, UPDATE_URL, SITE,
  // Exposto para teste e para o relatório de suporte poder conferir sem instalar.
  verificarInstalador,
  ASSINATURA_URL,
};
