// engine-scaler.js — ponte entre a tela do VL Scaling e o motor de escala.
//
// O motor é o LosslessScaling.exe oficial, que acompanha o pacote em native\lossless. Este é o
// mesmo caminho que o GDZ Optimizer usa, e é o único que apresenta o jogo corretamente em modo
// janela sem bordas: carregar só a Lossless.dll deixava a janela preta.
//
// Fluxo ao aplicar:
//   1. grava %LOCALAPPDATA%\Lossless Scaling\Settings.xml com a configuração escolhida na tela
//   2. abre o LosslessScaling.exe com -StartMinimized
//   3. dispara o atalho Ctrl+Alt+S, que faz o Lossless começar a escalar o jogo em primeiro plano
//
// A interface com o renderer continua a mesma de antes (scalingGetCapabilities, scalingApply,
// scalingRevert, scalingStatus, scalingArtifacts). Nada na tela precisa mudar.
'use strict';

const path = require('path');
const engine = require('./lossless-official');

// Nomes que a tela usa. O lossless-official traduz para os valores do Settings.xml.
function normalizeType(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (key === '' || key === 'none' || key === 'desligado') return 'off';
  for (const name of ['ls1', 'fsr', 'nis', 'anime4k', 'xbr', 'integer', 'nearest', 'bicubic']) {
    if (key.includes(name)) return name;
  }
  return 'fsr';
}

// A tela manda os nomes do GDZ: lsfg31, lsfg23, lsfg11. Preservar o sufixo importa, porque
// lsfg31 e lsfg3 nao sao a mesma coisa no Settings.xml do Lossless (LSFG3 vs LSFG3).
function normalizeFrameGeneration(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (key === '' || key === 'none' || key === 'desligado' || key === 'off') return 'off';
  if (key === 'lsfg31' || key === 'lsfg3') return 'lsfg31';
  if (key === 'lsfg23' || key === 'lsfg2') return 'lsfg23';
  if (key === 'lsfg11' || key === 'lsfg1') return 'lsfg11';
  if (key.includes('3')) return 'lsfg31';
  if (key.includes('2')) return 'lsfg23';
  if (key.includes('1')) return 'lsfg11';
  return 'off';
}

// Envia Ctrl+Alt+S ao jogo em primeiro plano: é o atalho que inicia a escala no Lossless.
// Usa keybd_event porque o atalho é global e precisa chegar com o jogo em foco.
function pressStartHotkey() {
  try {
    const { execFileSync } = require('child_process');
    const script = `
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public static class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
[K]::keybd_event(0x11,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
[K]::keybd_event(0x12,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
[K]::keybd_event(0x53,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120
[K]::keybd_event(0x53,0,2,[UIntPtr]::Zero)
[K]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[K]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
Write-Output "HOTKEY_OK"
`;
    const file = path.join(require('os').tmpdir(), 'vl-hotkey.ps1');
    require('fs').writeFileSync(file, script, 'utf8');
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return /HOTKEY_OK/.test(out);
  } catch (e) {
    return false;
  }
}

function mountScaler(ex) {
  // ── capacidades do motor ──
  ex.scalingGetCapabilities = async () => {
    try {
      const st = engine.status();
      return {
        ok: st.available,
        embedded: true,
        dist: null,
        engines: ['lossless'],
        running: st.running,
        exe: st.exe,
        reason: st.available ? undefined : 'LosslessScaling.exe não encontrado em native\\lossless.',
        message: st.available
          ? 'Motor Lossless disponível (LS1, FSR, NIS, Anime4K, XBR, geração de quadros).'
          : 'Motor não encontrado.',
        modes: ['ls1', 'fsr', 'nis', 'anime4k', 'xbr', 'integer', 'nearest', 'bicubic'],
        frameGeneration: ['lsfg11', 'lsfg23', 'lsfg31'],
      };
    } catch (e) {
      return { ok: false, embedded: true, engines: [], reason: e.message, message: e.message };
    }
  };

  // ── resolução atual (lê do desktop) ──
  ex.scalingGetRes = async () => {
    const { screen } = require('electron');
    const d = screen.getPrimaryDisplay();
    return {
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      workArea: d.workArea,
    };
  };

  // ── aplicar escala ──
  ex.scalingApply = async (cfg) => {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    const type = normalizeType(c.scaleType);
    const fg = normalizeFrameGeneration(c.frameGeneration);

    if (type === 'off' && fg === 'off') {
      const r = engine.stop();
      return { success: !!r.ok, stopped: true, embedded: true, message: r.message };
    }

    let factor = Number(c.scaleFactor);
    if (!Number.isFinite(factor) || factor < 1) factor = 1.5;
    factor = Math.min(factor, 3.5);

    let sharpness = Number(c.sharpness);
    if (!Number.isFinite(sharpness)) sharpness = 0;
    sharpness = Math.min(Math.max(sharpness, 0), 100);

    const applied = engine.accepts({
      scaleType: type,
      fsrType: c.fsrType || 'fsr1',
      scaleFactor: factor,
      sharpness,
      frameGeneration: fg,
      multiplier: Number(c.multiplier) || Number(c.lsfg3Multiplier) || 2,
      targetFps: Number(c.targetFps) || Number(c.lsfg3Target) || 300,
      flowScale: Number(c.flowScale) || 1.0,
      queueTarget: Number(c.queueTarget) || 1,
      maxFrameLatency: Number(c.maxFrameLatency) || 1,
      syncMode: c.syncMode || 'standard',
      captureApi: c.captureApi || 'dxgi',
      lsfg3Mode: c.lsfg3Mode || 'adaptive',
      resizeBefore: !!c.resizeBeforeScaling,
      hdrCompat: !!c.hdrCompat,
      scaleCursor: !!c.scaleCursor,
      vrs: c.vrs !== false,
      autoScale: !!c.autoScale,
      autoDelay: Number(c.autoDelay) || 0,
    });

    if (!applied.ok) {
      return { success: false, embedded: true, engine: 'lossless', error: applied.error || applied.message };
    }

    // Depois de abrir, dispara o atalho que faz o Lossless começar a capturar. Se o atalho não
    // sair, a configuração continua gravada: o usuário pode apertar Ctrl+Alt+S no jogo.
    const hotkey = pressStartHotkey();
    return {
      success: true,
      embedded: true,
      engine: 'lossless',
      message: hotkey
        ? 'Lossless iniciado e captura disparada.'
        : 'Lossless iniciado. Aperte Ctrl+Alt+S no jogo para começar a escalar.',
      hotkeySent: hotkey,
      config: { type, factor, sharpness, frameGeneration: fg },
    };
  };

  // ── parar / reverter ──
  ex.scalingRevert = async () => {
    const r = engine.stop();
    return { success: !!r.ok, embedded: true, reverted: true, message: r.message, error: r.error };
  };

  // ── status ──
  ex.scalingStatus = () => {
    // Leitura síncrona: a tela chama isto a cada atualização e não pode esperar processo.
    try {
      const st = engine.status();
      return {
        embedded: true,
        engine: 'lossless',
        available: st.available,
        running: st.running,
        exe: st.exe,
        settings: st.settings,
      };
    } catch (e) {
      return { embedded: true, engine: 'lossless', available: false, error: e.message };
    }
  };

  // ── auxiliar: onde estão os binários do motor ──
  ex.scalingArtifacts = () => {
    try {
      const st = engine.status();
      return {
        dir: path.join(__dirname, 'native', 'lossless'),
        exe: st.exe,
        settings: st.settings,
        ready: st.available,
      };
    } catch (e) {
      return { dir: null, ready: false, error: e.message };
    }
  };

  return ex;
}

module.exports = { mountScaler, pressStartHotkey };
