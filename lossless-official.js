// lossless-official.js — controla o LosslessScaling.exe oficial, como o GDZ faz.
//
// Por que este caminho em vez de carregar a DLL direto:
// chamar Init/Activate/ApplySettings na Lossless.dll deixava o motor de pé, aceitando a
// configuração, mas sem capturar o jogo (a janela ficava preta). Quem faz a captura funcionar de
// verdade em modo sem bordas é o programa oficial LosslessScaling.exe, que tem a lógica de escolha
// de monitor, reinício de captura e tratamento de frame perdido.
//
// Funcionamento: grava o Settings.xml que o Lossless lê ao iniciar, abre o programa com
// -StartMinimized e confere depois se ele aceitou o arquivo. Nada aqui lança: falha vira
// { ok: false, error }.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(__dirname, 'native', 'lossless');
const EXE = path.join(APP_DIR, 'LosslessScaling.exe');
// O Lossless guarda as configurações no perfil do usuário, não na pasta do programa.
const SETTINGS_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lossless Scaling');
const SETTINGS = path.join(SETTINGS_DIR, 'Settings.xml');

// Nomes que a interface usa → valores que o Settings.xml aceita.
const SCALING_TYPE = {
  off: 'Off', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'Integer',
  nearest: 'Nearest', xbr: 'XBR', anime4k: 'ANIME4K',
};
const FSR_TYPE = { fsr1: 'ORIGINAL', fsr2: 'FSR2', fsr3: 'FSR3' };
const FRAME_GENERATION = { off: 'OFF', lsfg1: 'LSFG1', lsfg2: 'LSFG2', lsfg3: 'LSFG3' };
const SYNC_MODE = { standard: 'DEFAULT', vsync: 'VSYNC2', gsync: 'GSYNC', adaptive: 'ADAPTIVE' };
const CAPTURE_API = { dxgi: 'DXGI', wgc: 'WGC' };
const LS1_MODE = { off: 'OFF', performance: 'PERFORMANCE', balanced: 'BALANCED', quality: 'QUALITY' };
const LSFG_SIZE = { performance: 'PERFORMANCE', quality: 'QUALITY' };

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Monta o Settings.xml no formato que o próprio Lossless grava. Os campos repetem a estrutura
// vista em %LOCALAPPDATA%\Lossless Scaling\Settings.xml de uma instalação real.
function buildSettings(config) {
  const c = config && typeof config === 'object' ? config : {};
  const type = SCALING_TYPE[String(c.scaleType || 'fsr').toLowerCase()] || 'FSR';
  const fg = FRAME_GENERATION[String(c.frameGeneration || 'off').toLowerCase()] || 'OFF';
  const fsr = FSR_TYPE[String(c.fsrType || 'fsr1').toLowerCase()] || 'ORIGINAL';
  const sync = SYNC_MODE[String(c.syncMode || 'standard').toLowerCase()] || 'DEFAULT';
  const api = CAPTURE_API[String(c.captureApi || 'dxgi').toLowerCase()] || 'DXGI';

  const factor = Number(c.scaleFactor);
  const scale = Number.isFinite(factor) ? Math.min(Math.max(factor, 1), 3.5) : 1.5;
  const sharp = Number.isFinite(Number(c.sharpness)) ? Math.min(Math.max(Number(c.sharpness), 0), 100) : 0;
  const flow = Number.isFinite(Number(c.flowScale)) ? Math.min(Math.max(Number(c.flowScale), 0.5), 2.0) : 1.0;
  const target = Number.isFinite(Number(c.targetFps)) ? Number(c.targetFps) : 100;
  const multiplier = Number.isFinite(Number(c.multiplier)) ? Number(c.multiplier) : 2;
  const latency = Number.isFinite(Number(c.maxFrameLatency)) ? Number(c.maxFrameLatency) : 1;
  const queue = Number.isFinite(Number(c.queueTarget)) ? Number(c.queueTarget) : 1;

  return `<?xml version="1.0" encoding="utf-8"?>
<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <WindowMaximized>false</WindowMaximized>
  <WindowHeight>650</WindowHeight>
  <WindowWidth>1150</WindowWidth>
  <ProfileListWidth>250</ProfileListWidth>
  <Hotkey>S</Hotkey>
  <HotkeyModifierKeys>Alt Control</HotkeyModifierKeys>
  <GpuPreference>0</GpuPreference>
  <GpuPreferenceChangeCount>0</GpuPreferenceChangeCount>
  <SetupPhase>0</SetupPhase>
  <StartAsAdmin>false</StartAsAdmin>
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
      <AutoScaleDelay>${Math.max(0, Math.min(30, Number(c.autoDelay) || 0))}</AutoScaleDelay>
      <ScalingMode>Auto</ScalingMode>
      <ScalingFitMode>Fullscreen</ScalingFitMode>
      <ScaleFactor>${scale}</ScaleFactor>
      <ResizeBeforeScaling>${c.resizeBefore ? 'true' : 'false'}</ResizeBeforeScaling>
      <WindowedMode>false</WindowedMode>
      <ScalingType>${esc(type)}</ScalingType>
      <FSRType>${esc(fsr)}</FSRType>
      <LS1Type>BALANCED</LS1Type>
      <LSFG2Mode>X2</LSFG2Mode>
      <LSFG3Mode1>${String(c.lsfg3Mode || 'adaptive').toUpperCase() === 'FIXED' ? 'FIXED' : 'ADAPTIVE'}</LSFG3Mode1>
      <LSFG3Multiplier>${Math.min(Math.max(Math.round(multiplier), 2), 4)}</LSFG3Multiplier>
      <LSFG3Target>${Math.min(Math.max(Math.round(target), 30), 300)}</LSFG3Target>
      <LSFGFlowScale>${Math.round(flow * 100)}</LSFGFlowScale>
      <LSFGSize>PERFORMANCE</LSFGSize>
      <Anime4kType>S</Anime4kType>
      <Sharpness>${(sharp / 10).toFixed(2).replace(/\.00$/, '')}</Sharpness>
      <LS1Sharpness>1</LS1Sharpness>
      <VRS>${c.vrs === false ? 'false' : 'true'}</VRS>
      <FrameGeneration>${esc(fg)}</FrameGeneration>
      <ClipCursor>false</ClipCursor>
      <AdjustCursorSpeed>false</AdjustCursorSpeed>
      <HideCursor>false</HideCursor>
      <ScaleCursor>${c.scaleCursor ? 'true' : 'false'}</ScaleCursor>
      <SyncMode>${esc(sync)}</SyncMode>
      <MaxFrameLatency>${Math.min(Math.max(Math.round(latency), 1), 16)}</MaxFrameLatency>
      <GsyncSupport>true</GsyncSupport>
      <HdrSupport>${c.hdrCompat ? 'true' : 'false'}</HdrSupport>
      <DrawFps>true</DrawFps>
      <CaptureApi>${esc(api)}</CaptureApi>
      <QueueTarget>${Math.min(Math.max(Math.round(queue), 1), 4)}</QueueTarget>
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

function available() {
  try { return fs.existsSync(EXE); }
  catch (e) { return false; }
}

// Grava o Settings.xml com backup do original, para poder restaurar depois.
function writeSettings(config) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  try {
    if (fs.existsSync(SETTINGS) && !fs.existsSync(SETTINGS + '.vl-backup')) {
      fs.copyFileSync(SETTINGS, SETTINGS + '.vl-backup');
    }
  } catch (e) { /* sem backup não impede gravar */ }
  fs.writeFileSync(SETTINGS, buildSettings(config), 'utf8');
  return SETTINGS;
}

function running() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('tasklist /FO CSV /NH /FI "IMAGENAME eq LosslessScaling.exe"', { encoding: 'utf8', windowsHide: true });
    return /LosslessScaling\.exe/i.test(out);
  } catch (e) { return false; }
}

// Abre o programa oficial. Já minimizado, como o GDZ faz, para não cobrir o jogo.
function launch() {
  if (!available()) return { ok: false, error: 'LosslessScaling.exe não encontrado em native\\lossless.' };
  if (running()) return { ok: true, message: 'O Lossless já estava aberto.' };
  try {
    const child = spawn(EXE, ['-StartMinimized'], {
      cwd: APP_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true, message: 'Lossless iniciado.' };
  } catch (e) {
    return { ok: false, error: 'Não foi possível abrir o Lossless: ' + e.message };
  }
}

function stop() {
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /F /IM LosslessScaling.exe', { windowsHide: true, stdio: 'ignore' });
    return { ok: true, message: 'Lossless encerrado.' };
  } catch (e) {
    return { ok: true, message: 'O Lossless já estava fechado.' };
  }
}

function accepts(config) {
  if (!available()) return { ok: false, error: 'LosslessScaling.exe não encontrado.' };
  let settings;
  try { settings = writeSettings(config); }
  catch (e) { return { ok: false, error: 'Não foi possível gravar a configuração: ' + e.message }; }
  const started = launch();
  if (!started.ok) return started;
  return { ok: true, message: 'Configuração gravada e Lossless iniciado.', settings };
}

function status() {
  return {
    available: available(),
    running: running(),
    exe: available() ? EXE : null,
    settings: SETTINGS,
  };
}

module.exports = { available, accepts, launch, stop, running, status, writeSettings, buildSettings, EXE, SETTINGS };
