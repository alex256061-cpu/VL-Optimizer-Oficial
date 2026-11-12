// engine-scaler.js — ponte entre a tela do VL Scaling e o motor de escala.
//
// O motor agora é o Lossless real: escala com LS1, FSR, NIS, Anime4K, XBR, Bicubic, SharpBilinear,
// Integer e Nearest, e gera quadros intermediários (LSFG). Ele roda num processo próprio
// (engine/VLScalingHost.exe) porque precisa de uma thread STA com pilha grande e instala hooks de
// DXGI que pertencem a essa thread — carregá-lo dentro do Electron derrubaria a janela quando ele
// falhasse.
//
// A interface com o renderer continua a mesma de antes (scalingGetCapabilities, scalingApply,
// scalingRevert, scalingStatus, scalingArtifacts). Nada na tela precisa mudar.
'use strict';

const path = require('path');
const fs = require('fs');
const bridge = require('./engine-bridge');

// Nomes que a tela usa → código que o motor entende em `method` (ver ScalingEngineArguments.cs).
// A ordem segue os enums do binário; um nome desconhecido cai em FSR.
const METHOD_CODES = {
  off: 0,
  nearest: 1,
  sharpbilinear: 2,
  integer: 3,
  xbr: 4,
  fsr: 5,
  ls1: 6,
  nis: 7,
  bicubic: 8,
  anime4k: 9,
};

// Modos de geração de quadros. `off` mantém o comportamento de antes.
const FG_CODES = { off: 0, lsfg1: 1, lsfg2: 2, lsfg3: 3 };

function normalizeType(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (key === '' || key === 'none' || key === 'desligado') return 'off';
  if (key in METHOD_CODES) return key;
  // a tela pode mandar "AMD FSR", "NVIDIA NIS", "Anime4K"…
  for (const name of Object.keys(METHOD_CODES)) {
    if (key.includes(name)) return name;
  }
  return 'fsr';
}

function normalizeFrameGeneration(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (key === '' || key === 'none' || key === 'desligado') return 'off';
  if (key in FG_CODES) return key;
  if (key.includes('3')) return 'lsfg3';
  if (key.includes('2')) return 'lsfg2';
  if (key.includes('1')) return 'lsfg1';
  return 'off';
}

function mountScaler(ex) {
  // ── capacidades do motor ──
  ex.scalingGetCapabilities = async () => {
    try {
      const cap = await bridge.capabilities();
      return {
        ok: !!cap.ok,
        embedded: true,
        dist: null,
        engines: cap.engines || [],
        running: !!cap.running,
        dll: cap.dll || null,
        reason: cap.ok ? undefined : cap.message,
        message: cap.message,
        modes: Object.keys(METHOD_CODES).filter((m) => m !== 'off'),
        frameGeneration: Object.keys(FG_CODES).filter((m) => m !== 'off'),
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
      const r = await bridge.stop();
      return { success: !!r.ok, stopped: true, embedded: true };
    }

    // Fator de escala: a tela manda 1.0–4.0; fora disso o motor não aceita.
    let factor = Number(c.scaleFactor);
    if (!Number.isFinite(factor) || factor < 1) factor = 1.5;
    factor = Math.min(factor, 4);

    let sharpness = Number(c.sharpness);
    if (!Number.isFinite(sharpness)) sharpness = 50;
    sharpness = Math.min(Math.max(sharpness, 0), 100) / 100;

    const applied = await bridge.apply({
      method: METHOD_CODES[type] != null ? METHOD_CODES[type] : METHOD_CODES.fsr,
      scaleFactor: factor,
      sharpness,
      frameGeneration: FG_CODES[fg] != null ? FG_CODES[fg] : 0,
      multiplier: Number(c.multiplier) || Number(c.lsfg3Multiplier) || 2,
      targetFps: Number(c.targetFps) || Number(c.lsfg3Target) || 0,
      flowScale: Number(c.flowScale) || 1.0,
      queueTarget: Number(c.queueTarget) || 1,
      maxFrameLatency: Number(c.maxFrameLatency) || 1,
      syncMode: c.syncMode || 'standard',
      captureApi: c.captureApi || 'dxgi',
      mode: 1,
      fitMode: 1,
    });

    if (!applied.ok) {
      return { success: false, embedded: true, engine: 'lossless', error: applied.error || applied.message };
    }
    return {
      success: true,
      embedded: true,
      engine: 'lossless',
      message: applied.message,
      config: { type, factor, sharpness, frameGeneration: fg },
    };
  };

  // ── parar / reverter ──
  ex.scalingRevert = async () => {
    const r = await bridge.stop();
    return { success: !!r.ok, embedded: true, reverted: true, error: r.error };
  };

  // ── status ──
  ex.scalingStatus = () => {
    // Leitura síncrona: a tela chama isto a cada atualização e não pode esperar o processo.
    const dll = bridge.engineDllPath();
    return {
      embedded: true,
      engine: 'lossless',
      available: !!dll,
      dll,
      host: bridge.hostExePath(),
    };
  };

  // ── auxiliar: onde estão os binários do motor ──
  ex.scalingArtifacts = () => {
    const dll = bridge.engineDllPath();
    const host = bridge.hostExePath();
    let bytes = 0;
    try { bytes = dll ? fs.statSync(dll).size : 0; } catch (e) { }
    return {
      dir: path.join(__dirname, 'engine'),
      dll,
      dllBytes: bytes,
      host,
      ready: !!(dll && host),
    };
  };

  return ex;
}

module.exports = { mountScaler, METHOD_CODES, FG_CODES };
