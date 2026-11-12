// fsr1_easu.hlsl — EASU (Edge Adaptive Spatial Upsampling), FSR 1.0, versão 32-bit fiel
// Porte direto de FsrEasuF / FsrEasuTapF / FsrEasuSetF (GPUOpen-Effects/FidelityFX-FSR, ffx_fsr1.h).
// FSR 1.0 — MIT, Copyright (c) 2021 Advanced Micro Devices, Inc.
//
// Uso: dispatch outW/8 x outH/8. Cada thread escreve 1 texel de saída.
// cbuffer b0 = 4 × uint4 (con0..con3) gerados na CPU por fsrEasuCon().

#include "common.hlsli"

Texture2D<float4> InputTexture : register(t0);
SamplerState InputSampler : register(s0);
RWTexture2D<float4> OutputTexture : register(u0);

cbuffer EasuCon : register(b0)
{
    uint4 con0;
    uint4 con1;
    uint4 con2;
    uint4 con3;
};

// dimensões de saída para o guard do dispatch (4 threads além da borda)
cbuffer SizeCB : register(b1)
{
    uint2 gOutputSize;
    uint2 _pad;
};

// asUint()/asFloat() do ffx_a: reinterprete de bits (não multiplicação)
float2 FsrAF2AU2(uint2 v) { return asfloat(v); }
float4 FsrAF4(uint4 v) { return asfloat(v); }

// ── gather4 por canal: f (R), g (G), b (B) ──
// O sampler é CLAMP, então as bordas replicam o pixel da ponta (igual ao FSR original).
float4 FsrEasuRF(float2 p) { return InputTexture.GatherRed(InputSampler, p); }
float4 FsrEasuGF(float2 p) { return InputTexture.GatherGreen(InputSampler, p); }
float4 FsrEasuBF(float2 p) { return InputTexture.GatherBlue(InputSampler, p); }

// ─────────────────────────────────────────────────────────────
// FsrEasuTapF: acumula cor e peso de 1 tap do kernel Lanczos anisotrópico
// ─────────────────────────────────────────────────────────────
void FsrEasuTapF(inout float3 aC, inout float aW, float2 off, float2 dir, float2 len,
                 float lob, float clp, float3 c)
{
    // Rotaciona o offset pela direção.
    float2 v;
    v.x = (off.x * dir.x) + (off.y * dir.y);
    v.y = (off.x * (-dir.y)) + (off.y * dir.x);
    // Anisotropia.
    v *= len;
    // Distância^2.
    float d2 = v.x * v.x + v.y * v.y;
    d2 = min(d2, clp);
    // Aproximação de Lanczos2 sem sin/rcp/sqrt:
    //  (25/16 * (2/5 * x^2 - 1)^2 - (25/16 - 1)) * (1/4 * x^2 - 1)^2
    float wB = AF1(2.0 / 5.0) * d2 + AF1(-1.0);
    float wA = lob * d2 + AF1(-1.0);
    wB *= wB;
    wA *= wA;
    wB = AF1(25.0 / 16.0) * wB + AF1(-(25.0 / 16.0 - 1.0));
    float w = wB * wA;
    aC += c * w;
    aW += w;
}

// ─────────────────────────────────────────────────────────────
// FsrEasuSetF: acumula direção e comprimento num quad bilinear
// biS/biT/biU/biV são predicados de tempo de compilação => 4 chamadas com constantes
// ─────────────────────────────────────────────────────────────
void FsrEasuSetF(inout float2 dir, inout float len, float2 pp,
                 bool biS, bool biT, bool biU, bool biV,
                 float lA, float lB, float lC, float lD, float lE)
{
    float w = AF1(0.0);
    // Predicados viram if constante — o compilador dobra em 4 variações
    if (biS) w = (AF1(1.0) - pp.x) * (AF1(1.0) - pp.y);
    if (biT) w = pp.x * (AF1(1.0) - pp.y);
    if (biU) w = (AF1(1.0) - pp.x) * pp.y;
    if (biV) w = pp.x * pp.y;

    // Direção é a '+' diff:
    //    a
    //  b c d
    //    e
    // magnitude = média abs dos dois lados de 'c'
    float dc = lD - lC;
    float cb = lC - lB;
    float lenX = max(abs(dc), abs(cb));
    lenX = FsrRcpLo(lenX);
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = FsrSat(abs(dirX) * lenX);
    lenX *= lenX;
    len += lenX * w;

    // Eixo Y
    float ec = lE - lC;
    float ca = lC - lA;
    float lenY = max(abs(ec), abs(ca));
    lenY = FsrRcpLo(lenY);
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = FsrSat(abs(dirY) * lenY);
    lenY *= lenY;
    len += lenY * w;
}

// ─────────────────────────────────────────────────────────────
// FsrEasuF: função principal. ip = posição inteira do pixel de saída.
// ─────────────────────────────────────────────────────────────
void FsrEasuF(out float3 pix, uint2 ip, uint4 con0, uint4 con1, uint4 con2, uint4 con3)
{
    // Posição do 'f'
    float2 pp = float2(ip) * FsrAF2AU2(con0.xy) + FsrAF2AU2(con0.zw);
    float2 fp = floor(pp);
    pp -= fp;

    // Kernel de 12 taps:
    //    b c
    //  e f g h
    //  i j k l
    //    n o
    float2 p0 = fp * FsrAF2AU2(con1.xy) + FsrAF2AU2(con1.zw);
    float2 p1 = p0 + FsrAF2AU2(con2.xy);
    float2 p2 = p0 + FsrAF2AU2(con2.zw);
    float2 p3 = p0 + FsrAF2AU2(con3.xy);

    float4 bczzR = FsrEasuRF(p0);
    float4 bczzG = FsrEasuGF(p0);
    float4 bczzB = FsrEasuBF(p0);
    float4 ijfeR = FsrEasuRF(p1);
    float4 ijfeG = FsrEasuGF(p1);
    float4 ijfeB = FsrEasuBF(p1);
    float4 klhgR = FsrEasuRF(p2);
    float4 klhgG = FsrEasuGF(p2);
    float4 klhgB = FsrEasuBF(p2);
    float4 zzonR = FsrEasuRF(p3);
    float4 zzonG = FsrEasuGF(p3);
    float4 zzonB = FsrEasuBF(p3);

    // Luma "x2" (mesmo cálculo do AMD)
    float4 bczzL = bczzB * AF1(0.5) + (bczzR * AF1(0.5) + bczzG);
    float4 ijfeL = ijfeB * AF1(0.5) + (ijfeR * AF1(0.5) + ijfeG);
    float4 klhgL = klhgB * AF1(0.5) + (klhgR * AF1(0.5) + klhgG);
    float4 zzonL = zzonB * AF1(0.5) + (zzonR * AF1(0.5) + zzonG);

    float bL = bczzL.x;
    float cL = bczzL.y;
    float iL = ijfeL.x;
    float jL = ijfeL.y;
    float fL = ijfeL.z;
    float eL = ijfeL.w;
    float kL = klhgL.x;
    float lL = klhgL.y;
    float hL = klhgL.z;
    float gL = klhgL.w;
    float oL = zzonL.z;
    float nL = zzonL.w;

    // Acumula para interpolação bilinear
    float2 dir = AF1(0.0);
    float len = AF1(0.0);
    FsrEasuSetF(dir, len, pp, true,  false, false, false, bL, eL, fL, gL, jL);
    FsrEasuSetF(dir, len, pp, false, true,  false, false, cL, fL, gL, hL, kL);
    FsrEasuSetF(dir, len, pp, false, false, true,  false, fL, iL, jL, kL, nL);
    FsrEasuSetF(dir, len, pp, false, false, false, true,  gL, jL, kL, lL, oL);

    // Normaliza a direção, com limpeza perto de zero
    float2 dir2 = dir * dir;
    float dirR = dir2.x + dir2.y;
    bool zro = dirR < FSR_EPS;
    dirR = FsrRsqLo(dirR);
    dirR = zro ? AF1(1.0) : dirR;
    dir.x = zro ? AF1(1.0) : dir.x;
    dir *= dirR;

    // {0..2} -> {0..1}, e suaviza com quadrado
    len = len * AF1(0.5);
    len *= len;

    // Stretch: {1.0 vert|horz -> sqrt(2) diagonal}
    float stretch = (dir.x * dir.x + dir.y * dir.y) * FsrRcpLo(max(abs(dir.x), abs(dir.y)));

    // Comprimento anisotrópico depois da rotação
    //  x := de 1.0 a 'stretch' nas bordas
    //  y := de 1.0 a 2x nas bordas
    float2 len2 = float2(AF1(1.0) + (stretch - AF1(1.0)) * len, AF1(1.0) + AF1(-0.5) * len);

    // Lobo: +-{sqrt(2) até um pouco além de 2} conforme a borda
    float lob = AF1(0.5) + ((AF1(1.0) / AF1(4.0) - AF1(0.04)) - AF1(0.5)) * len;

    // Ponto de clip de distância^2
    float clp = FsrRcpLo(lob);

    // Min/max dos 4 vizinhos mais próximos (derring)
    float3 min4 = min(FsrMin3(float3(ijfeR.z, ijfeG.z, ijfeB.z),
                              float3(klhgR.w, klhgG.w, klhgB.w),
                              float3(ijfeR.y, ijfeG.y, ijfeB.y)),
                      float3(klhgR.x, klhgG.x, klhgB.x));
    float3 max4 = max(FsrMax3(float3(ijfeR.z, ijfeG.z, ijfeB.z),
                              float3(klhgR.w, klhgG.w, klhgB.w),
                              float3(ijfeR.y, ijfeG.y, ijfeB.y)),
                      float3(klhgR.x, klhgG.x, klhgB.x));

    // Acumulação dos 12 taps
    float3 aC = AF1(0.0);
    float aW = AF1(0.0);

    FsrEasuTapF(aC, aW, float2( 0.0, -1.0) - pp, dir, len2, lob, clp, float3(bczzR.x, bczzG.x, bczzB.x)); // b
    FsrEasuTapF(aC, aW, float2( 1.0, -1.0) - pp, dir, len2, lob, clp, float3(bczzR.y, bczzG.y, bczzB.y)); // c
    FsrEasuTapF(aC, aW, float2(-1.0,  1.0) - pp, dir, len2, lob, clp, float3(ijfeR.x, ijfeG.x, ijfeB.x)); // i
    FsrEasuTapF(aC, aW, float2( 0.0,  1.0) - pp, dir, len2, lob, clp, float3(ijfeR.y, ijfeG.y, ijfeB.y)); // j
    FsrEasuTapF(aC, aW, float2( 0.0,  0.0) - pp, dir, len2, lob, clp, float3(ijfeR.z, ijfeG.z, ijfeB.z)); // f
    FsrEasuTapF(aC, aW, float2(-1.0,  0.0) - pp, dir, len2, lob, clp, float3(ijfeR.w, ijfeG.w, ijfeB.w)); // e
    FsrEasuTapF(aC, aW, float2( 1.0,  1.0) - pp, dir, len2, lob, clp, float3(klhgR.x, klhgG.x, klhgB.x)); // k
    FsrEasuTapF(aC, aW, float2( 2.0,  1.0) - pp, dir, len2, lob, clp, float3(klhgR.y, klhgG.y, klhgB.y)); // l
    FsrEasuTapF(aC, aW, float2( 2.0,  0.0) - pp, dir, len2, lob, clp, float3(klhgR.z, klhgG.z, klhgB.z)); // h
    FsrEasuTapF(aC, aW, float2( 1.0,  0.0) - pp, dir, len2, lob, clp, float3(klhgR.w, klhgG.w, klhgB.w)); // g
    FsrEasuTapF(aC, aW, float2( 1.0,  2.0) - pp, dir, len2, lob, clp, float3(zzonR.z, zzonG.z, zzonB.z)); // o
    FsrEasuTapF(aC, aW, float2( 0.0,  2.0) - pp, dir, len2, lob, clp, float3(zzonR.w, zzonG.w, zzonB.w)); // n

    // Normaliza e aplica derring (clamp no min/max 2x2 mais próximo)
    pix = min(max4, max(min4, aC * AF1(1.0) / aW));
}

[numthreads(FSR_GROUP_X, FSR_GROUP_Y, 1)]
void Fsr1EasuCS(uint3 tid : SV_DispatchThreadID)
{
    uint2 ip = tid.xy;
    if (ip.x >= gOutputSize.x || ip.y >= gOutputSize.y)
        return;

    float3 pix;
    FsrEasuF(pix, ip, con0, con1, con2, con3);
    OutputTexture[ip] = float4(saturate(pix), 1.0);
}
