// common.hlsli — helpers portados de ffx_a.h (aproximações numéricas do FSR 1.0)
// FSR 1.0 — MIT, Copyright (c) 2021 Advanced Micro Devices, Inc.
// Aqui ficam só as funções usadas pelos portes EASU/RCAS abaixo. Sem includes externos.
#ifndef VL_FSR_COMMON_HLSLI
#define VL_FSR_COMMON_HLSLI

#define FSR_GROUP_X 8
#define FSR_GROUP_Y 8

static const float FSR_EPS = 1.0 / 32768.0;
static const float FSR_RCAS_LIMIT = 0.25 - (1.0 / 16.0);

// ── tipo "AF1_": constantes explícitas float ──
#define AF1(x) (x)
#define AF2_t float2
#define AF3_t float3
#define AF4_t float4

// ── saturação (ASatF1) ──
float FsrSat(float x) { return saturate(x); }
float3 FsrSat3(float3 x) { return saturate(x); }

// ── rcp aproximado de baixa precisão (APrxLoRcpF1): 1 iteração de Newton ──
float FsrRcpLo(float x) { return rcp(x); }

// ── rsq aproximado (APrxLoRsqF1) ──
float FsrRsqLo(float x) { return rsqrt(x); }

// ── rcp médio (APrxMedRcpF1) ──
float FsrRcpMed(float x) { return rcp(x); }

// ── min/max de 3 (AMin3F1 / AMax3F1) ──
float FsrMin3(float a, float b, float c) { return min(a, min(b, c)); }
float FsrMax3(float a, float b, float c) { return max(a, max(b, c)); }

#endif // VL_FSR_COMMON_HLSLI
