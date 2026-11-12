# VL Scaler — motor de upscale embutido

Substitui a dependência do **Lossless Scaling** (pago, closed-source) por um motor
próprio embarcado no app. O cliente não instala nada e não paga nada extra.

## Estado atual

| Peça | Estado |
|---|---|
| Shaders EASU + RCAS (FSR 1.0, MIT) | ✅ compilados (`shaders/*.cso`) |
| Constantes (`fsr1_con.js`, porte de `FsrEasuCon`/`FsrRcasCon`) | ✅ validadas contra o exemplo da AMD |
| Backend D3D11 (`engine_main.cpp`) | ✅ compila e executa dispatches |
| Captura | ⚠️ GDI BitBlt funciona; WGC recusa com `0x80070005` |
| Apresentação | ❌ **não correta** — escreve por cima da janela alvo, ver abaixo |
| `fsr1_engine.exe` | ✅ 58 KB, compilado com MSVC 14.44 |

## O que funciona

```
node native/scaler/build.js       # HLSL -> .cso (fxc do Windows SDK)
node native/scaler/build-exe.js   # engine_main.cpp -> fsr1_engine.exe
```

Execução verificada contra uma janela real:

```
vl-scaler start rcas=0.5000 customScale=1 factor=1.50 once=1
D3D11 feature level 0xb000
target hwnd=00000000038B07BE "Sem título - Bloco de Notas"
scale 1424x894 -> 2136x1341
resources 2136x1341
capture: GDI BitBlt (CAPTUREBLT)
rendered 5 frames in 0.20s (24.6 fps)
OK
```

## O bug que falta resolver

O motor captura a janela, roda EASU+RCAS corretamente, e então **desenha o
resultado por cima do cliente da janela com `StretchDIBits`**. A janela alvo
(o jogo) continua desenhando por cima no frame seguinte, e o resultado é a
imagem quebrada vista em `shots/scaler-after.png`.

**Arquitetura correta** (o que o Lossless faz): hook em `IDXGISwapChain::Present`.
No `Present`, detecta a back buffer em resolução menor que o display, roda
EASU+RCAS numa textura e substitui a cópia para o swapchain antes de apresentar.
Isso exige:

1. `IDXGISwapChain::Present` hookado via `IDXGISwapChain` vtable (ou `MinHook` / `Detours`)
2. `CreateSwapChainForHwnd`/`ForComposition` hookado pra pegar a desc
3. Device/context compartilhado com o jogo (mesmo adapter)
4. Sync de thread (a apresentação é em thread própria do jogo)

Enquanto isso não existe, o motor **não deve ser ligado em produção** — ele
corrompe a janela. O `engine-scaler.js` continua retornando erro honesto em vez
de fingir sucesso.

## O que falta

- [ ] Hook de `Present` (MinHook, MIT: https://github.com/TsudaKageyu/minhook)
- [ ] Captura WGC com `GraphicsCaptureSession` permissões / ou hook de back buffer
- [ ] Cursor composto pós-upscale
- [ ] Present threadsafe + handle de resize do swapchain
- [ ] Fallback GDI (só pra apps sem D3D, tipo Notepad, onde não há o que corromper)

## Licença

Os shaders em `src/` são portes 32-bit do **FidelityFX FSR 1.0** da AMD:

> Copyright (c) 2021 Advanced Micro Devices, Inc. MIT License.
> Ver https://github.com/GPUOpen-Effects/FidelityFX-FSR

O aviso MIT da AMD **deve ser mantido** em qualquer redistribuição do
`fsr1_engine.exe` (MIT exige incluir o aviso nos binários entregues).
