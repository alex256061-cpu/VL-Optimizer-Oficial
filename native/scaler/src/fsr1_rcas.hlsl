// fsr1_rcas.hlsl — RCAS (Robust Contrast Adaptive Sharpening), FSR 1.0, 32-bit fiel
// Porte direto de FsrRcasF (GPUOpen-Effects/FidelityFX-FSR, ffx_fsr1.h v1.20210629).
// FSR 1.0 — MIT, Copyright (c) 2021 Advanced Micro Devices, Inc.
//
// Aplicar DEPOIS do EASU, na resolução final.
// cbuffer b0 = uint4 de FsrRcasCon(): con.x = exp2(-sharpness), sharpness em stops.

#include "common.hlsli"

Texture2D<float4> InputTexture : register(t0);
SamplerState InputSampler : register(s0);
RWTexture2D<float4> OutputTexture : register(u0);

cbuffer RcasCon : register(b0)
{
    uint4 con;
    uint4 _pad;
};

cbuffer SizeCB : register(b1)
{
    uint2 gOutputSize;
    uint2 _pad2;
};

// b (cima), d (esq), e (centro), f (dir), h (baixo)
void FsrRcasF(out float3 pix, out float alpha, uint2 ip, float sharpness)
{
    uint2 sp = ip;
    float hN = 1.0 / float(gOutputSize.y);
    float wN = 1.0 / float(gOutputSize.x);

    // SampleLevel com sampler CLAMP: bordas replicam, igual ao FSR
    float3 b = InputTexture.SampleLevel(InputSampler, (float2(sp) + float2(0.0, -1.0) + 0.5) * float2(wN, hN), 0).rgb;
    float3 d = InputTexture.SampleLevel(InputSampler, (float2(sp) + float2(-1.0, 0.0) + 0.5) * float2(wN, hN), 0).rgb;
    float4 ee = InputTexture.SampleLevel(InputSampler, (float2(sp) + 0.5) * float2(wN, hN), 0);
    float3 e = ee.rgb;
    float3 f = InputTexture.SampleLevel(InputSampler, (float2(sp) + float2(1.0, 0.0) + 0.5) * float2(wN, hN), 0).rgb;
    float3 h = InputTexture.SampleLevel(InputSampler, (float2(sp) + float2(0.0, 1.0) + 0.5) * float2(wN, hN), 0).rgb;
    alpha = ee.a;

    // Luma x2
    float bL = b.b * 0.5 + (b.r * 0.5 + b.g);
    float dL = d.b * 0.5 + (d.r * 0.5 + d.g);
    float eL = e.b * 0.5 + (e.r * 0.5 + e.g);
    float fL = f.b * 0.5 + (f.r * 0.5 + f.g);
    float hL = h.b * 0.5 + (h.r * 0.5 + h.g);

    // Detecção de ruído
    float nz = 0.25 * bL + 0.25 * dL + 0.25 * fL + 0.25 * hL - eL;
    nz = saturate(abs(nz) * FsrRcpMed(FsrMax3(FsrMax3(bL, dL, eL), fL, hL) -
                                      FsrMin3(FsrMin3(bL, dL, eL), fL, hL)));
    nz = -0.5 * nz + 1.0;

    // Min/max do anel
    float mn4R = min(FsrMin3(b.r, d.r, f.r), h.r);
    float mn4G = min(FsrMin3(b.g, d.g, f.g), h.g);
    float mn4B = min(FsrMin3(b.b, d.b, f.b), h.b);
    float mx4R = max(FsrMax3(b.r, d.r, f.r), h.r);
    float mx4G = max(FsrMax3(b.g, d.g, f.g), h.g);
    float mx4B = max(FsrMax3(b.b, d.b, f.b), h.b);

    // peakC = (1.0, -4.0)
    float hitMinR = min(mn4R, e.r) * FsrRcpMed(4.0 * mx4R);
    float hitMinG = min(mn4G, e.g) * FsrRcpMed(4.0 * mx4G);
    float hitMinB = min(mn4B, e.b) * FsrRcpMed(4.0 * mx4B);
    float hitMaxR = (1.0 - max(mx4R, e.r)) * FsrRcpMed(4.0 * mn4R - 4.0);
    float hitMaxG = (1.0 - max(mx4G, e.g)) * FsrRcpMed(4.0 * mn4G - 4.0);
    float hitMaxB = (1.0 - max(mx4B, e.b)) * FsrRcpMed(4.0 * mn4B - 4.0);

    float lobeR = max(-hitMinR, hitMaxR);
    float lobeG = max(-hitMinG, hitMaxG);
    float lobeB = max(-hitMinB, hitMaxB);
    float lobe = max(-FSR_RCAS_LIMIT, min(FsrMax3(lobeR, lobeG, lobeB), 0.0)) * sharpness;

    // Remoção de ruído (FSR_RCAS_DENOISE ligado — é o caminho recomendado)
    lobe *= nz;

    float rcpL = FsrRcpMed(4.0 * lobe + 1.0);
    pix.r = (lobe * b.r + lobe * d.r + lobe * h.r + lobe * f.r + e.r) * rcpL;
    pix.g = (lobe * b.g + lobe * d.g + lobe * h.g + lobe * f.g + e.g) * rcpL;
    pix.b = (lobe * b.b + lobe * d.b + lobe * h.b + lobe * f.b + e.b) * rcpL;
}

[numthreads(FSR_GROUP_X, FSR_GROUP_Y, 1)]
void Fsr1RcasCS(uint3 tid : SV_DispatchThreadID)
{
    uint2 ip = tid.xy;
    if (ip.x >= gOutputSize.x || ip.y >= gOutputSize.y)
        return;

    float sharpness = asfloat(con.x);

    float3 pix;
    float alpha;
    FsrRcasF(pix, alpha, ip, sharpness);

    OutputTexture[ip] = float4(saturate(pix), alpha);
}
