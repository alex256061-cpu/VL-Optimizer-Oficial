// fsr1_con.js — porte de FsrEasuCon / FsrRcasCon (constantes do EASU/RCAS)
// FSR 1.0 — MIT, Copyright (c) 2021 Advanced Micro Devices, Inc.
// Referência: GPUOpen-Effects/FidelityFX-FSR, ffx-fsr/ffx_fsr1.h (v1.20210629)
'use strict';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

// AU1_AF1(f): bits do float32 como uint32 (reinterpret, não conversão)
function asUint(f) {
  f32[0] = f;
  return u32[0];
}

// FsrEasuCon — con0..con3 em ordem de memória (uint4 con0 = v[0..3])
function fsrEasuCon(viewportW, viewportH, inputW, inputH, outputW, outputH) {
  const v = new Uint32Array(16);
  // con0: posição do 'F' (passo do pixel de saída em espaço de input)
  v[0] = asUint(viewportW / outputW);
  v[1] = asUint(viewportH / outputH);
  v[2] = asUint(0.5 * viewportW / outputW - 0.5);
  v[3] = asUint(0.5 * viewportH / outputH - 0.5);
  // con1: rcp do input + offset do gather em p0
  v[4] = asUint(1.0 / inputW);
  v[5] = asUint(1.0 / inputH);
  v[6] = asUint(1.0 / inputW);
  v[7] = asUint(-1.0 / inputH);
  // con2: p1 e p2 relativos a p0
  v[8] = asUint(-1.0 / inputW);
  v[9] = asUint(2.0 / inputH);
  v[10] = asUint(1.0 / inputW);
  v[11] = asUint(2.0 / inputH);
  // con3: p3 relativo a p0
  v[12] = asUint(0.0);
  v[13] = asUint(4.0 / inputH);
  v[14] = 0;
  v[15] = 0;
  return v;
}

// FsrRcasCon — con.x = exp2(-sharpness)
// sharpness é em STOPS: 0.0 = máximo, >0 = cada unidade dobra a suavização.
function fsrRcasCon(sharpness) {
  const s = Math.max(0, Number(sharpness) || 0);
  return asUint(Math.pow(2.0, -s));
}

// Derivado: sharpness em stops a partir do valor 0..100 do slider (não é do FSR
// original, é nossa convenção de UI — 0% = sem sharpen, 100% = máximo).
function fsrRcasFromPercent(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  // 0% -> 4 stops (quase nada); 100% -> 0 stops (máximo)
  return 4.0 * (1.0 - p);
}

module.exports = { fsrEasuCon, fsrRcasCon, fsrRcasFromPercent, asUint };
