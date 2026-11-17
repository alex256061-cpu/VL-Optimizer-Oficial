// escrever-settings.js — grava a configuracao editando o Settings.xml que o Lossless ja criou,
// em vez de reescrever o arquivo do zero.
//
// Por que isso importa: o Lossless valida os campos ao ler. Um valor fora do enum que ele conhece
// (por exemplo 'OFF' em vez de 'Off') faz ele descartar o arquivo inteiro e voltar para os valores
// que estao na memoria dele. Foi o que acontecia: a tela mandava LS1/2x/LSFG3 e o Lossless abria
// com Off/1.5/165.
//
// Os enums abaixo foram copiados do codigo do GDZ Optimizer, que funciona:
//   LS_FG      = { lsfg31:'LSFG3', lsfg23:'LSFG2', lsfg11:'LSFG1', off:'Off' }
//   LS_SCALING = { off:'Off', ls1:'LS1', fsr:'FSR', nis:'NIS', integer:'Integer',
//                  nearest:'Nearest', xbr:'XBR', anime4k:'Anime4K' }
//   LS_FSR     = { fsr1:'ORIGINAL', fsr2:'ORIGINAL', fsr3:'ORIGINAL', optimized:'OPTIMIZED' }
//   LS_FIT     = { fullscreen:'Fullscreen', stretch:'AspectRatio', fit:'AspectRatio' }
//   LS_SYNC    = { standard:'Default', vsync:'Vsync1', gsync:'Vsync2', adaptive:'Vsync3' }
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lossless Scaling');
const SETTINGS = path.join(SETTINGS_DIR, 'Settings.xml');

// Enums exatos do Lossless (copiados do GDZ).
const LS_FG = { lsfg31: 'LSFG3', lsfg23: 'LSFG2', lsfg11: 'LSFG1', off: 'Off' };
const LS_SCALING = {
  off: 'Off', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'Integer',
  nearest: 'Nearest', xbr: 'XBR', anime4k: 'Anime4K',
};
const LS_FSR = { fsr1: 'ORIGINAL', fsr2: 'ORIGINAL', fsr3: 'ORIGINAL', original: 'ORIGINAL', optimized: 'OPTIMIZED' };
const LS_FIT = { fullscreen: 'Fullscreen', stretch: 'AspectRatio', fit: 'AspectRatio' };
// Só DEFAULT existe no Lossless (ver a nota em lossless-official.js).
// Valores reais do enum do Lossless (Main_SyncMode_* em LosslessScaling.dll):
// Default, Off, Vsync1, Vsync2, Vsync3. Não existe VSYNC4, GSYNC nem ADAPTIVE.
// ── Validação de valores: listas do GDZ ────────────────────────────────────
// O GDZ recusa valor de ENUM que não está na lista, corta valor numérico no
// intervalo de SCALING_RANGE, aceita ScaleFactor com 2 casas e os demais
// inteiros, e devolve a lista do que não foi escrito (`skipped`). Sem isso o
// app gravava qualquer número que a tela mandasse (Sharpness 40 em vez de 10,
// ScaleFactor 9 em vez de 4) e o Lossless recebia configuração inválida.
const SCALING_ENUM = {
  FrameGeneration: ['Off', 'LSFG2', 'LSFG3'],
  LSFG3Mode1: ['FIXED', 'ADAPTIVE'],
  LSFG2Mode: ['X2'],
  CaptureApi: ['DXGI', 'WGC'],
  ScalingType: ['Off', 'LS1', 'FSR'],
  FSRType: ['ORIGINAL'],
  ScalingMode: ['Auto', 'Custom'],
  ScalingFitMode: ['AspectRatio'],
  SyncMode: ['OFF', 'DEFAULT'],
};

const SCALING_RANGE = {
  LSFG3Multiplier: [2, 4],
  LSFG3Target: [30, 480],
  LSFGFlowScale: [25, 100],
  QueueTarget: [0, 3],
  Sharpness: [0, 10],
  LS1Sharpness: [0, 10],
  MaxFrameLatency: [1, 10],
  ScaleFactor: [1, 4],
};

const SCALING_BOOL = ['ClipCursor', 'ScaleCursor', 'HideCursor', 'AdjustCursorSpeed', 'GsyncSupport', 'HdrSupport', 'DrawFps', 'VRS', 'WindowedMode', 'ResizeBeforeScaling', 'AutoScale', 'MultiDisplayMode'];
const SCALING_GLOBAL = ['StartAsAdmin', 'StartAtWindowsStartup', 'MinimizeToTray', 'CloseToTray'];

const LS_SYNC = { standard: 'Default', vsync: 'Vsync1', gsync: 'Vsync2', adaptive: 'Vsync3' };
const LS_CAPTURE = { dxgi: 'DXGI', wgc: 'WGC' };
const LS_SIZE = { performance: 'PERFORMANCE', balanced: 'BALANCED', quality: 'QUALITY' };
const LS_FG_MODE = { adaptive: 'ADAPTIVE', fixed: 'FIXED' };

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/// Troca o valor de um campo dentro de um bloco XML.
///
/// ANTES: quando o campo não existia no bloco, ele era CRIADO no fim. O programa de
/// referência nunca faz isso — ele devolve o bloco intacto. Criar tag que o Lossless
/// não conhece só serve para poluir o arquivo, e é um dos motivos de ele achar o XML
/// inválido e jogar uma cópia em CorruptedSettingsBackup.xml.
///
/// AGORA: se o campo não existe, nada é escrito. Quem precisar escrever uma tag nova
/// tem de atualizar o modelo com o Lossless aberto, não deixar o app inventar.
function setInBlock(block, name, value) {
  const re = new RegExp('<' + name + '>[^<]*</' + name + '>');
  if (!re.test(block)) return block;
  return block.replace(re, '<' + name + '>' + esc(value) + '</' + name + '>');
}

/// Pega o bloco <Profile> do arquivo. Retorna { xml, block } ou null.
function profileParts(xml) {
  const gp = /<GameProfiles>([\s\S]*?)<\/GameProfiles>/.exec(xml);
  if (!gp) return null;
  const blocks = [...gp[1].matchAll(/<Profile>([\s\S]*?)<\/Profile>/g)];
  if (!blocks.length) return null;
  // prefere o perfil sem <Path> (o perfil global "Padrao")
  for (const m of blocks) {
    const p = /<Path>([^<]*)<\/Path>/.exec(m[1]);
    if (!p || !p[1]) return { xml, block: m[1], full: m[0] };
  }
  return { xml, block: blocks[0][1], full: blocks[0][0] };
}

function lerArquivo() {
  try { return fs.readFileSync(SETTINGS, 'utf8'); } catch (e) { return null; }
}

/// Aceita os dois nomes que circulam no projeto: os do GDZ (fgType, lsfg3Target) e os do
/// engine-scaler (frameGeneration, targetFps, multiplier). Sem isso o valor chega com um nome e
/// o gravador procura outro, o campo não é escrito, e o Lossless mantém o que tinha.
function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const num = (v) => (v == null || v === '' ? undefined : Number(v));
  return {
    fgType: c.fgType ?? c.frameGeneration,
    lsfg3Mode: c.lsfg3Mode ?? c.fgMode,
    lsfg3Multiplier: num(c.lsfg3Multiplier ?? c.multiplier ?? c.frameMultiplier),
    lsfg3Target: num(c.lsfg3Target ?? c.targetFps ?? c.targetFps),
    flowScale: num(c.flowScale),
    perfMode: c.perfMode,
    scaleType: c.scaleType,
    fsrType: c.fsrType,
    scaleFactor: num(c.scaleFactor),
    sharpness: num(c.sharpness),
    fitMode: c.fitMode,
    scaleMode: c.scaleMode,
    resizeBefore: c.resizeBefore ?? c.resizeBeforeScaling,
    syncMode: c.syncMode,
    captureApi: c.captureApi,
    queueTarget: num(c.queueTarget),
    maxFrameLatency: num(c.maxFrameLatency),
    hdrCompat: c.hdrCompat,
    scaleCursor: c.scaleCursor,
    vrs: c.vrs,
    windowedMode: c.windowedMode,
    autoScale: c.autoScale,
    autoDelay: num(c.autoDelay),
    // ── as 12 tags que faltavam (todas do GDZ) ──
    lsfg2Mode: c.lsfg2Mode,
    ls1Sharpness: num(c.ls1Sharpness),
    clipCursor: c.clipCursor,
    hideCursor: c.hideCursor,
    adjustCursorSpeed: c.adjustCursorSpeed,
    gsyncSupport: c.gsyncSupport,
    drawFps: c.drawFps,
    multiDisplayMode: c.multiDisplayMode,
    startAsAdmin: c.startAsAdmin,
    startAtWindowsStartup: c.startAtWindowsStartup,
    minimizeToTray: c.minimizeToTray,
    closeToTray: c.closeToTray,
  };
}

/// Grava a configuracao no Settings.xml EDITANDO o arquivo existente.
/// Se o arquivo nao existir, retorna erro: o Lossless precisa ter rodado ao menos uma vez para
/// criar a estrutura que ele reconhece.
function gravar(cfgBruto) {
  const c = normalize(cfgBruto);

  let xml = lerArquivo();
  if (!xml) {
    return { ok: false, error: 'O Lossless ainda não criou o Settings.xml. Abra o Lossless uma vez e tente de novo.' };
  }

  const parts = profileParts(xml);
  if (!parts) {
    return { ok: false, error: 'O Settings.xml está sem o bloco de perfil. Abra o Lossless uma vez para recriar.' };
  }

  // Backup do arquivo antes de mexer. Nome igual ao do GDZ (Settings.xml.gdz-original)
  // porque scalingRecoverIfCorrupted procura exatamente esse. Antes era
  // `.vl-backup`: o nome era diferente e a recuperação não achava o arquivo.
  try {
    const bak = path.join(SETTINGS_DIR, 'Settings.xml.gdz-original');
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
  } catch (e) { }

  // Se o Lossless deixou um CorruptedSettingsBackup.xml, significa que ele leu o
  // Settings.xml anterior como inválido e guardou uma cópia. Restaurar o nosso
  // original antes de gravar evita piorar a situação.
  try { scalingRecoverIfCorrupted(); } catch (e) { }

  let block = parts.block;
  const aplicados = [];

  // As 4 preferências do programa inteiro ficam no topo do Settings.xml, fora
  // do <Profile>. O put() escreve dentro do bloco do perfil, onde o Lossless
  // não lê essas tags. putGlobal usa o mesmo arquivo, mas no nível de cima.
  // As 4 preferências globais ficam no topo do arquivo, fora do <Profile>.
  // Guardadas aqui e aplicadas DEPOIS do replace do bloco — se fossem aplicadas
  // agora, o replaceFinal que reescreve <GameProfiles> não as alcançaria de
  // qualquer forma, mas pior: qualquer xml.replace(parts.full, ...) posterior
  // partiria de um xml onde a tag global já foi trocada... e o teste mostrou que
  // a troca simplesmente não colava. Por isso aplico no fim, sobre o xml final.
  const globais = [];
  const putGlobal = (nome, valor) => {
    if (valor === undefined || valor === null || valor === '') return;
    globais.push([nome, String(valor)]);
  };

  const put = (nome, valor) => {
    if (valor === undefined || valor === null || valor === '') return;
    block = setInBlock(block, nome, valor);
    aplicados.push(nome);
  };

  // Geracao de quadros
  if (c.fgType != null) put('FrameGeneration', LS_FG[String(c.fgType).toLowerCase()]);
  if (c.lsfg3Mode != null) put('LSFG3Mode1', LS_FG_MODE[String(c.lsfg3Mode).toLowerCase()]);
  if (c.lsfg3Multiplier != null) put('LSFG3Multiplier', clampTag('LSFG3Multiplier', c.lsfg3Multiplier));
  if (c.lsfg3Target != null) put('LSFG3Target', clampTag('LSFG3Target', c.lsfg3Target));
  if (c.flowScale != null) put('LSFGFlowScale', clampTag('LSFGFlowScale', Number(c.flowScale) * 100));
  if (c.perfMode != null) put('LSFGSize', c.perfMode ? 'PERFORMANCE' : 'BALANCED');

  // Escala
  if (c.scaleType != null) put('ScalingType', LS_SCALING[String(c.scaleType).toLowerCase()]);
  if (c.fsrType != null) put('FSRType', LS_FSR[String(c.fsrType).toLowerCase()]);
  if (c.scaleFactor != null) put('ScaleFactor', clampTag('ScaleFactor', c.scaleFactor));
  if (c.sharpness != null) put('Sharpness', clampTag('Sharpness', Number(c.sharpness) / 10));
  if (c.fitMode != null) put('ScalingFitMode', LS_FIT[String(c.fitMode).toLowerCase()]);
  if (c.scaleMode != null) put('ScalingMode', String(c.scaleMode).toLowerCase() === 'custom' ? 'Custom' : 'Auto');
  if (c.resizeBefore != null) put('ResizeBeforeScaling', c.resizeBefore ? 'true' : 'false');

  // Apresentacao
  if (c.syncMode != null) put('SyncMode', LS_SYNC[String(c.syncMode).toLowerCase()]);
  if (c.captureApi != null) put('CaptureApi', LS_CAPTURE[String(c.captureApi).toLowerCase()]);
  if (c.queueTarget != null) put('QueueTarget', clampTag('QueueTarget', c.queueTarget));
  if (c.maxFrameLatency != null) put('MaxFrameLatency', clampTag('MaxFrameLatency', c.maxFrameLatency));
  if (c.hdrCompat != null) put('HdrSupport', c.hdrCompat ? 'true' : 'false');
  if (c.scaleCursor != null) put('ScaleCursor', c.scaleCursor ? 'true' : 'false');
  if (c.vrs != null) put('VRS', c.vrs ? 'true' : 'false');
  if (c.windowedMode != null) put('WindowedMode', c.windowedMode ? 'true' : 'false');
  if (c.autoScale != null) put('AutoScale', c.autoScale ? 'true' : 'false');
  if (c.autoDelay != null) put('AutoScaleDelay', Math.round(Number(c.autoDelay)));


  // ── as 12 tags que faltavam (todas do GDZ) ──
  // Movimento do mouse e modo de exibição
  if (c.lsfg2Mode != null) put('LSFG2Mode', SCALING_ENUM.LSFG2Mode.includes(String(c.lsfg2Mode)) ? String(c.lsfg2Mode) : 'X2');
  if (c.ls1Sharpness != null) put('LS1Sharpness', clampTag('LS1Sharpness', c.ls1Sharpness));
  if (c.clipCursor != null) put('ClipCursor', c.clipCursor ? 'true' : 'false');
  if (c.hideCursor != null) put('HideCursor', c.hideCursor ? 'true' : 'false');
  if (c.adjustCursorSpeed != null) put('AdjustCursorSpeed', c.adjustCursorSpeed ? 'true' : 'false');
  if (c.gsyncSupport != null) put('GsyncSupport', c.gsyncSupport ? 'true' : 'false');
  if (c.drawFps != null) put('DrawFps', c.drawFps ? 'true' : 'false');
  if (c.multiDisplayMode != null) put('MultiDisplayMode', c.multiDisplayMode ? 'true' : 'false');
  if (c.startAsAdmin != null) putGlobal('StartAsAdmin', c.startAsAdmin ? 'true' : 'false');
  if (c.startAtWindowsStartup != null) putGlobal('StartAtWindowsStartup', c.startAtWindowsStartup ? 'true' : 'false');
  if (c.minimizeToTray != null) putGlobal('MinimizeToTray', c.minimizeToTray ? 'true' : 'false');
  if (c.closeToTray != null) putGlobal('CloseToTray', c.closeToTray ? 'true' : 'false');
  let novoXml = xml.replace(parts.full, '<Profile>' + block + '</Profile>');

  // As 4 globais (StartAsAdmin, StartAtWindowsStartup, MinimizeToTray, CloseToTray)
  // ficam no topo do arquivo. Troca só se a tag já existir — nunca cria.
  for (const [nome, valor] of globais) {
    const re = new RegExp('(<' + nome + '>)([^<]*)(</' + nome + '>)');
    if (re.test(novoXml)) {
      novoXml = novoXml.replace(re, '$1' + valor + '$3');
      aplicados.push(nome);
    }
  }
  try {
    fs.writeFileSync(SETTINGS, novoXml, 'utf8');
  } catch (e) {
    return { ok: false, error: 'Não foi possível gravar o Settings.xml: ' + e.message };
  }

  return { ok: true, aplicados, xml: novoXml };
}

/// Traduz um valor da tela para o valor que o Settings.xml aceita, com as
/// mesmas regras do gravador do GDZ: ENUM confere a lista, RANGE corta no
/// intervalo e arredonda, BOOL/GLOBAL viram "true"/"false".
///
/// Devolve null quando o valor é inválido — quem chama deve ignorar nesse caso.
function clampTag(tag, valor) {
  if (Object.prototype.hasOwnProperty.call(SCALING_ENUM, tag)) {
    const s = String(valor);
    return SCALING_ENUM[tag].includes(s) ? s : null;
  }
  if (Object.prototype.hasOwnProperty.call(SCALING_RANGE, tag)) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return null;
    const [min, max] = SCALING_RANGE[tag];
    const arred = tag === 'ScaleFactor' ? Math.round(n * 100) / 100 : Math.round(n);
    return String(Math.min(max, Math.max(min, arred)));
  }
  if (SCALING_BOOL.includes(tag) || SCALING_GLOBAL.includes(tag)) {
    return (valor === true || valor === 'true') ? 'true' : 'false';
  }
  return null;
}

/// Se o Lossless marcou o Settings.xml como corrompido, devolve o nosso original.
///
/// Do GDZ, literal: quando existe CorruptedSettingsBackup.xml ao lado do
/// Settings.xml E existe o nosso .gdz-original, copia o original de volta por cima
/// e apaga a cópia corrompida. Devolve true quando restaurou.
///
/// Sem isso, um Settings.xml que o Lossless considerou inválido ficava valendo:
/// o app continuava gravando por cima de um arquivo que o programa já tinha
/// descartado.
function scalingRecoverIfCorrupted() {
  const corrupted = path.join(SETTINGS_DIR, 'CorruptedSettingsBackup.xml');
  const original = SETTINGS + '.gdz-original';
  if (!fs.existsSync(corrupted) || !fs.existsSync(original)) return false;
  try {
    fs.copyFileSync(original, SETTINGS);
    fs.rmSync(corrupted, { force: true });
    return true;
  } catch (e) {
    return false;
  }
}
/// Le os campos que interessam do arquivo atual.
function ler() {
  const xml = lerArquivo();
  if (!xml) return null;
  const campos = {};
  const re = /<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) campos[m[1]] = m[2];
  return campos;
}

module.exports = { gravar, ler, setInBlock, profileParts, SETTINGS, SETTINGS_DIR, scalingRecoverIfCorrupted, clampTag };
