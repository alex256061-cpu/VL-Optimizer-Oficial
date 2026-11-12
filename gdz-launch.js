// gdz-launch.js — replica o canal ls-launch do GDZ Optimizer.
//
// O codigo foi lido do gdz-scaling.html dele (nao ofuscado):
//
//   async function doLaunch() {
//     const r = await ipcRenderer.invoke('ls-launch', getConfig());
//     if (r && r.success) setStatus(true, 'Active');
//     else setStatus(false, r?.error ? r.error.split('\n')[0] : 'Error');
//   }
//
// E o getConfig() da tela manda exatamente estes campos:
//   fgType, lsfg3Mode, lsfg3Target, lsfg3Multiplier(2), lsfg2Mode, flowScale, perfMode,
//   captureApi, queueTarget, scaleType, fsrType, sharpness, scaleMode, scaleFactor,
//   fitMode('fullscreen'), syncMode, optimized, windowedMode(false), hdrCompat, resizeBefore,
//   scaleCursor, vrs, autoScale, autoDelay(0), startMinimized, startAsAdmin
//
// O que o GDZ faz depois de receber isso (documentado no ESTADO.md do l-optimizer):
//   1. grava as opcoes no Settings.xml
//   2. FECHA a instancia antiga do Lossless
//   3. abre LosslessScaling.exe -StartMinimized
//   4. confere 8 s depois se o engine aceitou o arquivo (flag settingsRejected)
'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, 'native', 'lossless');
const EXE = path.join(APP_DIR, 'LosslessScaling.exe');
const SETTINGS_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lossless Scaling');
const SETTINGS = path.join(SETTINGS_DIR, 'Settings.xml');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Valores do Settings.xml. As chaves sao as do enum do binario (3.2.x), case-sensitive.
const ENUM = {
  scalingType: { off: 'Off', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'Integer', nearest: 'Nearest', xbr: 'XBR', anime4k: 'ANIME4K', bicubic: 'BicubicCAS', sgsr: 'SGSR', sharpbilinear: 'SharpBilinear' },
  fsrType: { fsr1: 'ORIGINAL', fsr2: 'FSR2', fsr3: 'FSR3' },
  fgType: { off: 'Off', lsfg11: 'LSFG1', lsfg23: 'LSFG2', lsfg31: 'LSFG3', lsfi: 'LSFI', lsfi1: 'LSFI1' },
  fgMode: { adaptive: 'ADAPTIVE', fixed: 'FIXED' },
  fg2Mode: { fusao: 'FUSION', normal: 'NORMAL' },
  sync: { standard: 'DEFAULT', vsync: 'VSYNC2', gsync: 'GSYNC', adaptive: 'ADAPTIVE' },
  capture: { dxgi: 'DXGI', wgc: 'WGC' },
  size: { performance: 'PERFORMANCE', quality: 'QUALITY' },
};

function pick(tabela, valor, padrao) {
  if (valor == null) return padrao;
  return tabela[String(valor).toLowerCase()] || padrao;
}

// O slider do GDZ vai de 30 a 300 no HTML, mas o JS clampa entre 30 e 480 antes de gravar.
function clampAlvo(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.min(300, Math.max(30, Math.round(n)));
}

function clamp(v, min, max, padrao) {
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Monta o Settings.xml a partir do mesmo objeto que o getConfig() do GDZ produz.
function buildSettings(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};

  const scaleType = pick(ENUM.scalingType, c.scaleType, 'Off');
  const fgType = pick(ENUM.fgType, c.fgType, 'Off');
  const fsrType = pick(ENUM.fsrType, c.fsrType, 'ORIGINAL');
  const fgMode = pick(ENUM.fgMode, c.lsfg3Mode, 'ADAPTIVE');
  const fg2Mode = pick(ENUM.fg2Mode, c.lsfg2Mode, 'NORMAL');
  const sync = pick(ENUM.sync, c.syncMode, 'DEFAULT');
  const capture = pick(ENUM.capture, c.captureApi, 'DXGI');

  const factor = Number.isFinite(Number(c.scaleFactor)) ? Math.min(3.0, Math.max(1.0, Number(c.scaleFactor))) : 1.5;
  const sharp = clamp(c.sharpness, 0, 100, 0);
  // flowScale vai de 0.5 a 2.0 na tela; o Settings.xml guarda 50..200
  const flow = Number.isFinite(Number(c.flowScale)) ? Math.min(2.0, Math.max(0.5, Number(c.flowScale))) : 1.0;
  const target = clampAlvo(c.lsfg3Target);
  const queue = clamp(c.queueTarget, 1, 4, 1);

  return `<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <WindowMaximized>false</WindowMaximized>
  <WindowHeight>650</WindowHeight>
  <WindowWidth>1150</WindowWidth>
  <ProfileListWidth>250</ProfileListWidth>
  <Hotkey>S</Hotkey>
  <HotkeyModifierKeys>Alt Control</HotkeyModifierKeys>
  <GpuPreference>0</GpuPreference>
  <GpuPreferenceChangeCount>0</GpuPreferenceCount>
  <SetupPhase>0</SetupPhase>
  <StartAsAdmin>${c.startAsAdmin ? 'true' : 'false'}</StartAsAdmin>
  <StartAtWindowsStartup>false</StartAtWindowsStartup>
  <MinimizeToTray>false</MinimizeToTray>
  <CloseToTray>false</CloseToTray>
  <Language>System</Language>
  <Theme>System</Theme>
  <FrameGenerationCollapsed>false</FrameGenerationCollapsed>
  <CursorOptionsCollapsed>false</CursorOptionsCollapsed>
  <RenderingOptionsCollapsed>false</RenderingOptionsCollapsed>
  <CaptureOptionsCollapsed>false</CaptureOptionsCollapsed>
  <GpuDisplayOptionsCollapsed>false</GpuDisplayOptionsCollapsed>
  <CropInputOptionsCollapsed>false</CropInputOptionsCollapsed>
  <BehaviorCollapsed>false</BehaviorCollapsed>
  <LegacyOptionsCollapsed>false</LegacyOptionsCollapsed>
  <GameProfiles>
    <Profile>
      <Title>Padrão</Title>
      <AutoScale>${c.autoScale ? 'true' : 'false'}</AutoScale>
      <AutoScaleDelay>0</AutoScaleDelay>
      <ScalingMode>Auto</ScalingMode>
      <ScalingFitMode>Fullscreen</ScalingFitMode>
      <ScaleFactor>${factor}</ScaleFactor>
      <ResizeBeforeScaling>${c.resizeBefore ? 'true' : 'false'}</ResizeBeforeScaling>
      <WindowedMode>false</WindowedMode>
      <ScalingType>${scaleType}</ScalingType>
      <FSRType>${fsrType}</FSRType>
      <LS1Type>BALANCED</LS1Type>
      <LSFG2Mode>${fg2Mode === 'FUSION' ? 'X2' : 'NORMAL'}</LSFG2Mode>
      <LSFG3Mode1>${fgMode}</LSFG3Mode1>
      <LSFG3Multiplier>2</LSFG3Multiplier>
      <LSFG3Target>${target}</LSFG3Target>
      <LSFGFlowScale>${Math.round(flow * 100)}</LSFGFlowScale>
      <LSFGSize>${c.perfMode ? 'PERFORMANCE' : 'QUALITY'}</LSFGSize>
      <Anime4kType>S</Anime4kType>
      <Sharpness>${(sharp / 10).toFixed(2).replace(/\.?0+$/, '') || '0'}</Sharpness>
      <LS1Sharpness>1</LS1Sharpness>
      <VRS>${c.vrs ? 'true' : 'false'}</VRS>
      <FrameGeneration>${fgType}</FrameGeneration>
      <ClipCursor>true</ClipCursor>
      <AdjustCursorSpeed>false</AdjustCursorSpeed>
      <HideCursor>false</HideCursor>
      <ScaleCursor>${c.scaleCursor ? 'true' : 'false'}</ScaleCursor>
      <SyncMode>${sync}</SyncMode>
      <MaxFrameLatency>1</MaxFrameLatency>
      <GsyncSupport>true</GsyncSupport>
      <HdrSupport>${c.hdrCompat ? 'true' : 'false'}</HdrSupport>
      <DrawFps>true</DrawFps>
      <CaptureApi>${capture}</CaptureApi>
      <QueueTarget>${queue}</QueueTarget>
      <PreferredGpuId>0</PreferredGpuId>
      <OutputDisplayId>0</OutputDisplayId>
      <CropInput>false</CropInput>
      <CropInputLeft>0</CropInputLeft>
      <CropInputTop>0</CropInputTop>
      <CropInputRight>0</CropInputRight>
      <CropInputBottom>0</CropInputBottom>
      <MultiDisplayMode>false</MultiDisplayMode>
    </Profile>
  </GameProfiles>
</Settings>
`;
}

function disponivel() {
  try { return fs.existsSync(EXE); } catch (e) { return false; }
}

function processoAtivo() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq LosslessScaling.exe'],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return /LosslessScaling\.exe/i.test(out);
  } catch (e) { return false; }
}

// O GDZ fecha a instancia antiga antes de abrir. Fazer igual evita que o Lossless ignore o novo
// Settings.xml (ele le o arquivo so na inicializacao).
function fecharInstancia() {
  if (!processoAtivo()) return;
  try {
    execFileSync('taskkill', ['/F', '/IM', 'LosslessScaling.exe'],
      { windowsHide: true, timeout: 15000, stdio: 'ignore' });
  } catch (e) { }
}

// Le o Settings.xml gravado e compara campos que importam, para detectar recusa do motor.
function lerGravado() {
  try {
    const xml = fs.readFileSync(SETTINGS, 'utf8');
    const campos = {};
    const re = /<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
    let m;
    while ((m = re.exec(xml)) !== null) campos[m[1]] = m[2];
    return campos;
  } catch (e) { return null; }
}

// Canal ls-launch. Recebe o MESMO objeto que o getConfig() do GDZ monta.
async function launch(cfg) {
  if (!disponivel()) {
    return { success: false, error: 'LosslessScaling.exe não encontrado em native\\lossless.' };
  }

  // 1. gravar
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    if (fs.existsSync(SETTINGS) && !fs.existsSync(SETTINGS + '.vl-backup')) {
      try { fs.copyFileSync(SETTINGS, SETTINGS + '.vl-backup'); } catch (e) { }
    }
    fs.writeFileSync(SETTINGS, buildSettings(cfg), 'utf8');
  } catch (e) {
    return { success: false, error: 'Não foi possível gravar a configuração: ' + e.message };
  }

  // 2. fechar a instancia antiga
  fecharInstancia();
  await sleep(2000);

  // 3. abrir minimizado
  try {
    const child = spawn(EXE, ['-StartMinimized'], {
      cwd: APP_DIR, detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
  } catch (e) {
    return { success: false, error: 'Não foi possível abrir o Lossless: ' + e.message };
  }

  // 4. conferir 8 s depois se o motor aceitou o arquivo
  await sleep(8000);
  const gravado = lerGravado();
  const esperado = buildSettings(cfg);
  const recusou = !gravado || !/LSFG3Mode1|ScalingType/.test(Object.keys(gravado).join(','));
  if (recusou) {
    return { success: false, error: 'O motor não aceitou a configuração gravada.' };
  }
  return { success: true, message: 'Lossless iniciado com a configuração aplicada.' };
}

function stop() {
  fecharInstancia();
  return { success: true };
}

function status() {
  return {
    available: disponivel(),
    running: processoAtivo(),
    exe: disponivel() ? EXE : null,
    settings: SETTINGS,
  };
}

module.exports = { launch, stop, status, disponivel, processoAtivo, buildSettings, EXE, SETTINGS };
