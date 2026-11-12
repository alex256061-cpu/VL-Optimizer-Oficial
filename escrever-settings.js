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
//   LS_SYNC    = { standard:'DEFAULT', vsync:'VSYNC1', gsync:'VSYNC2', adaptive:'VSYNC4' }
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
const LS_SYNC = { standard: 'DEFAULT', vsync: 'VSYNC1', gsync: 'VSYNC2', adaptive: 'VSYNC4' };
const LS_CAPTURE = { dxgi: 'DXGI', wgc: 'WGC' };
const LS_SIZE = { performance: 'PERFORMANCE', balanced: 'BALANCED', quality: 'QUALITY' };
const LS_FG_MODE = { adaptive: 'ADAPTIVE', fixed: 'FIXED' };

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/// Troca o valor de um campo dentro de um bloco XML. Se o campo nao existe, insere antes do fim.
function setInBlock(block, name, value) {
  const re = new RegExp('<' + name + '>[^<]*</' + name + '>');
  const novo = '<' + name + '>' + esc(value) + '</' + name + '>';
  if (re.test(block)) return block.replace(re, novo);
  return block + '\n      ' + novo;
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

  // Backup do arquivo antes de mexer.
  try {
    const bak = path.join(SETTINGS_DIR, 'Settings.xml.vl-backup');
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
  } catch (e) { }

  let block = parts.block;
  const aplicados = [];

  const put = (nome, valor) => {
    if (valor === undefined || valor === null || valor === '') return;
    block = setInBlock(block, nome, valor);
    aplicados.push(nome);
  };

  // Geracao de quadros
  if (c.fgType != null) put('FrameGeneration', LS_FG[String(c.fgType).toLowerCase()]);
  if (c.lsfg3Mode != null) put('LSFG3Mode1', LS_FG_MODE[String(c.lsfg3Mode).toLowerCase()]);
  if (c.lsfg3Multiplier != null) put('LSFG3Multiplier', Math.round(Number(c.lsfg3Multiplier)));
  if (c.lsfg3Target != null) put('LSFG3Target', Math.round(Number(c.lsfg3Target)));
  if (c.flowScale != null) put('LSFGFlowScale', Math.round(Number(c.flowScale) * 100));
  if (c.perfMode != null) put('LSFGSize', c.perfMode ? 'PERFORMANCE' : 'BALANCED');

  // Escala
  if (c.scaleType != null) put('ScalingType', LS_SCALING[String(c.scaleType).toLowerCase()]);
  if (c.fsrType != null) put('FSRType', LS_FSR[String(c.fsrType).toLowerCase()]);
  if (c.scaleFactor != null) put('ScaleFactor', Number(c.scaleFactor));
  if (c.sharpness != null) put('Sharpness', Number(c.sharpness) / 10);
  if (c.fitMode != null) put('ScalingFitMode', LS_FIT[String(c.fitMode).toLowerCase()]);
  if (c.scaleMode != null) put('ScalingMode', String(c.scaleMode).toLowerCase() === 'custom' ? 'Custom' : 'Auto');
  if (c.resizeBefore != null) put('ResizeBeforeScaling', c.resizeBefore ? 'true' : 'false');

  // Apresentacao
  if (c.syncMode != null) put('SyncMode', LS_SYNC[String(c.syncMode).toLowerCase()]);
  if (c.captureApi != null) put('CaptureApi', LS_CAPTURE[String(c.captureApi).toLowerCase()]);
  if (c.queueTarget != null) put('QueueTarget', Math.round(Number(c.queueTarget)));
  if (c.maxFrameLatency != null) put('MaxFrameLatency', Math.round(Number(c.maxFrameLatency)));
  if (c.hdrCompat != null) put('HdrSupport', c.hdrCompat ? 'true' : 'false');
  if (c.scaleCursor != null) put('ScaleCursor', c.scaleCursor ? 'true' : 'false');
  if (c.vrs != null) put('VRS', c.vrs ? 'true' : 'false');
  if (c.windowedMode != null) put('WindowedMode', c.windowedMode ? 'true' : 'false');
  if (c.autoScale != null) put('AutoScale', c.autoScale ? 'true' : 'false');
  if (c.autoDelay != null) put('AutoScaleDelay', Math.round(Number(c.autoDelay)));

  const novoXml = xml.replace(parts.full, '<Profile>' + block + '</Profile>');
  try {
    fs.writeFileSync(SETTINGS, novoXml, 'utf8');
  } catch (e) {
    return { ok: false, error: 'Não foi possível gravar o Settings.xml: ' + e.message };
  }

  return { ok: true, aplicados, xml: novoXml };
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

module.exports = { gravar, ler, setInBlock, profileParts, SETTINGS, SETTINGS_DIR };
