# VL OPTIMIZER — CHECKPOINT DO PROJETO

> Arquivo de retomada. Se o contexto da conversa estourar, **leia só este arquivo** e continue daqui.
> Data: 2026-11-11 · Versão do app: 1.0.0 · Raiz: `C:\Users\lucas larado\Desktop\deeepvl\l-optimizer`

---

## CHANGELOG — 2026-11-11 (2ª rodada)

- **Lossless Scaling integrado** (usuário comprou; caminho: `C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.exe`).
  - `ls-find-exe` detecta Steam (registro + libraryfolders.vdf + caminhos comuns) e grava em `scaling.json`.
  - `ls-config` (sem args) lê `%LOCALAPPDATA%\Lossless Scaling\Settings.xml` e devolve `current`, `recommended`, `configured`.
  - `ls-config` (com cfg) grava 21 campos no Settings.xml (FrameGeneration, LSFG3Mode1/Multiplier/Target/FlowScale/Size,
    CaptureApi, QueueTarget, ScalingType, FSRType, Sharpness, ScalingMode, ScaleFactor, SyncMode, HdrSupport,
    ResizeBeforeScaling, ScaleCursor, VRS, AutoScale/Delay, WindowedMode, StartAsAdmin) com backup em `lossless-settings.backup.xml`.
  - `ls-launch` grava as opções, fecha instância antiga e abre `LosslessScaling.exe -StartMinimized`; confere 8 s depois se
    o engine aceitou o arquivo (flag `settingsRejected` em `scaling.json`, avisada no próximo clique).
  - Schemas confirmados no binário (3.2.1): tipo `Settings`, `Settings.xml`, `-StartMinimized`, enums
    `LSFG3/LSFG2/LSFG1/OFF`, `ADAPTIVE/FIXED`, `DXGI/WGC`, `VSYNC1..4`, `DEFAULT`, `PERFORMANCE`, `ANIME4K`, `INTEGER`.
    `LSFG2Mode` e `ScalingFitMode` **não** são gravados (literais não confirmados) — o resto sim.
- **Gargalo corrigido**: `measure-bottleneck` agora devolve `cpu`, `coreMax`, `gpu`, `ram`, `ramGb`, `game`, `seconds`,
  `samples`, `verdict`, `dica` (era `meters.*`) — a tela de resultado renderiza.
- **GPU dedicada corrigida**: `gamesScan` resolve o `.exe` de cada jogo (`findGameExe`, prefere nome da pasta e ignora
  launcher/unins/setup) e `gpuDedicated` grava o caminho do executável no `UserGpuPreferences`.
- **Slots de RAM corrigidos**: usa `Win32_PhysicalMemoryArray.MemoryDevices` (mostrava threads como slots).
- **Hibernação**: probe agora lê `HKLM\SYSTEM\CurrentControlSet\Control\Power\HibernateEnabled`.
- **Meus jogos**: filtra apps que não são jogos (Steamworks, SteamVR, Lossless, etc.).
- Textos da aba VL Scaling atualizados para "Lossless Scaling / Motor detectado".

---

## CHANGELOG — 2026-11-11 (3ª rodada)

- **Sensores de verdade**: GPU via `nvidia-smi` (uso, temperatura, VRAM, consumo, ventoinha, clocks) no PC Info e no overlay
  (CPU/GPU temp + RAM). Pacote de RPM/clock por núcleo via `ProcessorInformation`. Discos: `Get-StorageReliabilityCounter`
  (temperatura/desgaste/horas — quando o SSD expõe; o KingFast deste PC não expõe e o campo some sozinho).
- **1% low real de 10 s**: a janela do PresentMon agora guarda timestamp por quadro e calcula o percentil sobre os últimos
  10 s (antes era aproximação de 600 quadros).
- **FPS por processo**: segunda sessão do PresentMon (`--session_name LOPT_LIST`) agrega quadros por aplicativo e preenche
  a lista da página Medidor com o FPS de cada processo (só aparece app que está realmente apresentando).
- **DNS só no adaptador físico ativo** (`Get-NetAdapter -Physical | Status Up`), tanto ao aplicar quanto ao detectar —
  VPN/virtual não é mais tocada.
- Build entregue em `dist` (o antigo `dist2` foi promovido) e `atualizar.cmd` faz a troca com o app aberto.

---

## 0. COMO RETOMAR (resumo em 10 linhas)

1. O app é um **Electron** (shell + UI) com motor **PowerShell** próprio, tema **vermelho/preto**, marca **VL** (logo "L" do usuário vetorizada).
2. A UI foi reaproveitada do GDZ (mesmos HTML/CSS/JS), retematizada por script; o backend foi **reescrito do zero** (`engine.js`, `engine-extras.js`, `features.js`).
3. Tudo que é tweak tem **backup e desfazer** (`%APPDATA%\VL\data\backups.json`).
4. Build portátil pronto em `dist\VL Optimizer-win32-x64\VL Optimizer.exe` (regerar com o comando da seção 9).
5. **Pendências quebradas** prioritárias: resultado do Gargalo, "GPU dedicada" por jogo, slots de RAM, UAC não testado (seção 3).
6. **Lossless Scaling** será comprado pelo usuário; quando chegar, ligar o botão *Scale* ao engine (seção 8).
7. Nome do produto: **VL** (janela "VL Optimizer", barra "VL OPTIMIZER", scaling "VL Scaling").
8. Rastros de GDZ/redes sociais foram removidos (login, TikTok, Discord, gdzfps, KeyAuth).
9. Não usar `ELECTRON_RUN_AS_NODE=1` no ambiente (o `start.cmd` limpa).
10. Logos/ícones em `assets/`; screenshots em `shots/`; análise do GDZ em `referencia/`.

---

## 1. MAPA DE ARQUIVOS

```
l-optimizer/
  main.js            janelas (dashboard, VL Scaling, overlay), IPC, ticker FPS, UAC, atalho global
  preload.js         ponte segura (lista branca de canais) — expõe window.electron
  engine.js          catálogo TWEAKS/ACTIONS/ONCES/TOOLS, backup/restore, probes, checks, DNS, caps
  engine-extras.js   limpeza, disco, programas (ícones/sobras), jogos, FiveM, PC info, FPS (PresentMon),
                     gargalo, OptiScaler, scaling
  features.js        elevação (UAC), modo automático dos jogos, limpeza de RAM (EmptyWorkingSet)
  package.json       productName "VL", electron ^33
  start.cmd          roda limpando ELECTRON_RUN_AS_NODE
  README.md          guia do usuário/dev
  ESTADO.md          ESTE arquivo (retomada)
  assets/            logo.png (512), icon.png (1024), icon.ico, logo-branco.png
  bin/               PresentMon.exe (Intel, MIT) + LOptimizer.ico
  src/               UI (dashboard.html, gdz-scaling.html, fps-overlay.html + css/js)
    tema-l.css       overrides vermelhos (carregado por último)
    giroscopio.css   logo em destaque no giroscópio (bloco "Logo VL em destaque")
  shots/             screenshots de todas as páginas (dashboard, desempenho, limpeza, scaling, sobre…)
  tools/             scripts python usados (retheme, logo, patches) — histórico de edições
  referencia/analise-gdz-completa.md   análise opção-por-opção do GDZ original
  dist/VL Optimizer-win32-x64/         build portátil (asar=false, 180 MB)
```

Páginas da UI (ids `pg-*`): dashboard, desempenho, inputlag, memoria, limpeza, programas, live,
tweaks (Windows), inicializacao, jogos, opti, scaling (janela separada), fps, gargalo, pcinfo,
hardware, sobre. Nav: sidebar recolhível (72px → 240px no hover), tour de 1º uso, Ctrl+K.

## 2. PRONTO E TESTADO ✅

- **Re-brand VL** em toda a UI, título, janela, scaling, build, pasta de dados e autostart.
- **Tema vermelho/preto** (paleta trocada por script em 27 arquivos); CTA claro/vermelho; toggles vermelhos.
- **Logo**: PNG do usuário → alfha transparente → gradiente vermelho; medalhão de 100 px no giroscópio
  (disco escuro + halo + logo na frente dos anéis) + `icon.ico` multi-tamanho.
- **Remoção de rastros**: login.html/login-theme.css apagados; CSP sem keyauth; social row e bloco de
  plano removidos; TikTok/Discord/gdzfps fora de busca/tour/plano.
- **Motor**: 32 tweaks + 18 ações com backup/desfazer real (testado: KeyboardDelay 1→0→1).
  Probes em um único PowerShell (rápido). Serviços, powercfg, netsh, DISM/SFC, DNS, UWP, hibernação,
  720p via ChangeDisplaySettingsEx, MSI/MPO, efeitos visuais, etc.
- **Limpeza**: 11 categorias reais (temp>1dia, lixeira, dumps, Chrome/Edge/Opera/Brave, Discord, Steam,
  Epic, shaders), com detecção de app aberto; varredura assíncrona com orçamento de tempo.
- **Disco**: varredura em árvore (fs, assíncrona, yield a cada 500 itens), maiores arquivos, abrir no Explorer.
- **Programas**: 82 apps reais; **ícones do shell** (55 extraídos); desinstalação pelo desinstalador;
  **sobras de pasta (Lixeira) + registro (backup .reg em `desinstalacoes/`)**.
- **Inicialização**: Run (HKCU/HKLM/x86) + pastas, liga/desliga com backup próprio.
- **PC Info**: CPU/GPU/RAM (SMBIOS)/discos/volumes/telas/rede/bateria/BIOS; avançado com tabela de sensores.
- **FPS**: PresentMon em `bin/`, live FPS/frametime/1% low, overlay click-through, base + ganho,
  gravação antes/depois (15/30/60 s) com veredito ±3%. (não testado com jogo real)
- **Gargalo**: medição com jogo em foco (CPU total, núcleo mais quente, GPU 3D) a cada 1 s. (resultado da tela: ver seção 3)
- **Jogos**: Steam/Epic/FiveM scan, painel GTA RP (settings.xml com backup), limpar shader cache.
- **OptiScaler**: download GitHub (latest), instalar/remover com backup, ini próprio. (não validado)
- **Modo administrador**: detecta, tenta UAC, mostra faixa "Modo limitado" com "Reabrir como admin".
- **Atalho global Ctrl+Alt+B**: marca base de FPS + toast.
- **Modo automático**: watcher 5 s; aplica/restaura plano, prioridade Chrome/Discord, fecha sync.
- **RAM**: EmptyWorkingSet real (teste: 2.179 MB liberados, 39 processos), auto 10/20/30/60 min.
- **Sons** (Web Audio), **fundo PCB** reativo à CPU, **tema claro/escuro**, **tour**, **busca**.
- **Build**: `dist\VL Optimizer-win32-x64\VL Optimizer.exe` (asar=false para o PresentMon rodar).

## 3. QUEBRADO — CORRIGIR PRIMEIRO ðŸ”´

1. **Resultado do Gargalo**: o front lê `r.cpu`, `r.coreMax`, `r.gpu`, `r.ram`, `r.ramGb`, `r.game`,
   `r.seconds`/`r.samples`, `r.dica` e monta `gargalo-tweaks-list`. O backend devolve
   `{ meters:{cpu,core,gpu}, verdict, fps, samples, seconds }` → tela vazia/incompleta.
   **Fix**: `measure-bottleneck` retornar os campos do front (cpu médio, coreMax, gpu, ram%, ramGb,
   game, seconds, samples, verdict, dica) + lista de tweaks sugeridos.
2. **"GPU dedicada" por jogo**: `ex.gpuDedicated` grava `g.dir` (pasta) em
   `HKCU\...\DirectX\UserGpuPreferences`; o Windows exige caminho do **.exe** → sem efeito.
   **Fix**: achar o executável principal na pasta do jogo e gravar esse caminho (e devolver `exe` no gamesScan).
3. **PC Info · slots**: `$sys.NumberOfLogicalProcessors` foi usado como nº de slots → "2 de 16 slots".
   **Fix**: `Get-CimInstance Win32_PhysicalMemoryArray | Select MemoryDevices`.
4. **UAC não testado ponta a ponta**: `feat.elevate` usa `Start-Process -Verb RunAs` e sai se aceito;
   se cancelar, segue com faixa. **Fix**: testar de fato; considerar bloquear visualmente tweaks que
   exigem admin quando `admin-status.failed === true`.
5. **Hibernação**: probe lê `HiberbootEnabled` (inicialização rápida), não a hibernação.
   **Fix**: ler `HiberFileSizePercent`/`HibernateEnabled` em `...\Control\Session Manager\Power`.

## 4. FRACO — MELHORAR ðŸŸ¡

- **Sensores**: CPU/GPU/SSD sem temperatura (null). GPU: `nvidia-smi`; SSD: `Get-StorageReliabilityCounter`
  (wear, temperature, power-on hours); CPU desktop: esconder (não há leitura sem driver).
- **FPS por processo**: lista mostra 0; só o alvo mede. 1% low usa janela ~600 quadros (não 10 s reais).
- **Overlay**: não testado com jogo; 300×150 fixo; sem temp.
- **Jogos**: sem capa/tamanho; Steam/Epic não testados (sem launchers na máquina).
- **FiveM**: só procura `settings.xml` em `%LOCALAPPDATA%\FiveM`; presets mexem em MSAA/grama/sombras/
  distância/frame scaling/windowed (faltam textura, partículas, reflexo, densidade).
- **OptiScaler**: `.ini` com chaves não validadas contra o pacote real; "detectar jogo" pega o 1º processo
  com janela; fluxo completo nunca rodou.
- **Inicialização**: sem `StartupApproved` (Task Manager não vê), sem badge de impacto, sem tarefas/serviços.
- **Programas**: desinstalador com múltiplos argumentos pode falhar; sobras de registro por semelhança de nome.
- **Limpeza**: orçamento de 6 s por categoria subestima (16 GB → pode mostrar 4 GB); falta "instaladores de driver".
- **DNS**: aplica em todas as interfaces (VPN pode quebrar).
- **Auto mode/RAM auto**: só com app aberto; sem tray; autostart `--silent` só minimiza.
- **Escala do app/DPI**: usa padrão do Electron (sem zoom configurável).

## 5. NÃO TESTADO ⚪

UAC · Steam/Epic/FiveM · OptiScaler completo · overlay com jogo · desinstalação MSI · scaling (só com Lossless).

## 6. DECISÕES (log)

- Nome **VL** (não "L Optimizer"); arquivos internos `gdz-scaling.html` e chaves `gdz-*` mantidos (invisíveis).
- Sem plano/assinatura: `get-user` devolve plano completo (`features:['*']`) → tudo liberado.
- `dlss-rec` do GDZ virou **indicador do DLSS** (`ShowDlssIndicator`) — preset real só a NVIDIA App escreve.
- Sobreposição Steam via `EnableGameOverlay` (pode ser reescrita pela Steam).
- Sem CSS/JS de login/plano; rastros sociais removidos (pedido explícito do usuário).
- Build com `--asar=false` para o PresentMon executar de dentro de `bin/`.
- Elevação automática pede UAC no 1º start; testes (`--smoke/--shots/--uitest`) pulam elevação.
- Logo: alpha do PNG original → gradiente `#ff2d38→#c4000e`; medalhão com translateZ para ficar à frente.

## 7. PENDÊNCIAS PRIORIZADAS (com critério de aceite)

| # | tarefa | aceite |
|---|---|---|
| 1 | ✅ Gargalo: shape do retorno | tela mostra CPU/núcleo/GPU/RAM e veredito com números reais |
| 2 | ✅ GPU dedicada por exe | `UserGpuPreferences` recebe o `jogo.exe` resolvido (fallback: erro claro se não achar) |
| 3 | ✅ Slots de RAM | PC Info mostra "2 de 4 slots" |
| 4 | UAC testado | aceitar → app reabre admin; cancelar → faixa com botão (falta validar na prática) |
| 5 | ✅ Hibernação status | lê `HibernateEnabled` (testar visualmente ligando/desligando) |
| 6 | Sensores GPU/SSD | GPU temp/uso via nvidia-smi; SSD wear/horas/temp |
| 7 | OptiScaler validado | baixar, instalar em jogo real, abrir com DLL e ini lido |
| 8 | FiveM validado | achar settings.xml, aplicar preset, restaurar backup |
| 9 | FPS por processo + 1% low 10 s | lista com FPS de cada processo; janela real de 10 s |
| 10 | Inicialização via StartupApproved | Task Manager reflete liga/desliga |
| 11 | Limpeza sem corte/limite | tamanho converge com varredura crua |
| 12 | DNS só interface ativa | VPN não perde DNS |

## 8. INTEGRAÇÃO LOSSLESS (validada no app real)

**Schema real (Lossless Scaling 3.2.2), confirmado abrindo o app:**
- Arquivo: `%LOCALAPPDATA%\Lossless Scaling\Settings.xml`, raiz `<Settings>`.
- As opções de scaling **não** ficam na raiz: ficam dentro de `<GameProfiles>` → `<Profile>` (o perfil "Padrão" é o que não tem `<Path>`).
- **O app crasha (ArgumentOutOfRange no MainWindow Loaded) se não houver nenhum perfil** — por isso o VL sempre garante um `<Profile>` no GameProfiles.
- **O app crasha se for aberto por CreateProcess** (spawn). Abrir por shell (ShellExecute / `shell.openPath` / `cmd start`) funciona. O `lsLaunch` usa `shell.openPath`.
- Enums exatos (case-sensitive): `FrameGeneration` = Off/LSFG3/LSFG2/LSFG1/LSFI/LSFI1 · `ScalingType` = Off/LS1/FSR/NIS/SGSR/BicubicCAS/Anime4K/XBR/SharpBilinear/Integer/Nearest · `FSRType` = ORIGINAL/OPTIMIZED · `LSFG3Mode1` = FIXED/ADAPTIVE · `LSFGSize` = BALANCED/PERFORMANCE · `SyncMode` = OFF/DEFAULT/VSYNC1..4 · `CaptureApi` = DXGI/WGC/GDI · `ScalingMode` = Auto/Custom · `ScalingFitMode` = AspectRatio/Fullscreen · `LSFG2Mode` = X2/X3/X4 · `Anime4kType` = S/M/L/VL/UL · `LS1Type` = BALANCED/PERFORMANCE.
- Um literal inválido faz o app descartar TODAS as opções (volta ao padrão e reescreve o arquivo) — por isso os literais são fixos no código.
- O app lê o arquivo no start e **não reescreve** quando aceita (mtime não muda).
- Fluxo do VL: `ls-config` lê o perfil Padrão; `ls-config(cfg)` grava 24 campos com backup em `%APPDATA%\VL\data\lossless-settings.backup.xml`; `ls-launch` grava, mata instância antiga (espera sair), abre por `shell.openPath` e confere 9 s depois se o engine aceitou.
- Teste feito: janela do Lossless aberta mostrando LSFG 3.1, Adaptativo, Alvo 120, Desempenho, NIS, DXGI, fila 1, Vsync ½, latência 1 — exatamente o que o VL gravou.

## 9. COMANDOS

```bat
cd l-optimizer
npm install
start.cmd                                  :: roda limpando ELECTRON_RUN_AS_NODE

:: testes de fumaça (screenshot em smoke.png, sem elevação)
node_modules\.bin\electron.cmd . --smoke
node_modules\.bin\electron.cmd . --shots   :: captura todas as páginas em shots/
node_modules\.bin\electron.cmd . --uitest  :: liga/desliga um tweak e confere o registro

:: build portátil (asar=false é obrigatório por causa do PresentMon)
npx --yes @electron/packager . "VL Optimizer" --platform=win32 --arch=x64 ^
  --icon=assets/icon.ico --out=dist --overwrite --app-version=1.0.0 --asar=false
```

## 10. ARMADILHAS CONHECIDAS

- `ELECTRON_RUN_AS_NODE=1` no ambiente faz o Electron rodar como Node e o app não abre (usar `start.cmd`).
- PresentMon precisa estar **fora do asar** (por isso `--asar=false` no build).
- PowerShell: scripts são gravados em arquivo UTF-8 com BOM em `%APPDATA%\VL\data` (evita problema de quote).
- `ps()` usa `-File` (sem injeção de shell); saída JSON (`Json` helper) parseada no main.
- O app pode ser reiniciado pelo UAC; a instância elevada recebe `--elevated` e não tenta de novo.
- Arquivos em `src/` estavam em ANSI por causa de edições antigas com PowerShell; **sempre salvar UTF-8**.

## 11. CONTRATOS IPC (canais usados pela UI)

Tweaks/ações: `tweaks-status`, `tweak-set{id,on}`, `tweak-dns{provider}`, `tweak-tool{id}`,
`run-action{action}`, `revert-action{action}`, `actions-status`, `get-caps`, `run-check{name}`,
`restore-all`, `get-backups`.
Sistema: `get-user`, `get-stats`, `get-mem-stats`, `get-processes`, `get-hardware`, `pcinfo-get`,
`pcinfo-live`, `startup-list`, `startup-set{name,scope,enabled}`, `get-recommendations`,
`admin-status`, `elevate-now`, `autostart-get/set`.
Limpeza/disco: `clean-scan`, `clean-run{ids}`, `disk-drives`, `disk-scan{drive}`,
`disk-scan-status`, `disk-scan-cancel`, `disk-open{target}`.
Programas/jogos: `apps-list`, `apps-extra`, `apps-uninstall{key}`, `apps-exists{key}`,
`apps-leftovers{key}`, `apps-remove-leftovers{key,ids}`, `games-scan`, `games-status`,
`set-auto-mode{on}`, `game-clean{id}`, `shader-clean`, `fivem-gfx-status/apply/restore`.
FPS: `fps-status`, `fps-set-target{pid}`, `fps-record{slot,secs,label}`, `fps-clear{slot}`,
`fps-overlay-set{patch}`, `fps-base-mark`, `fps-base-clear`; evento `fps-update`, `overlay-update`,
`fps-hotkey`.
Outros: `opti-*`, `ls-browse-exe/find-exe/launch/stop/config`, `gdz-scaling-get-res/apply/revert`,
`ram-clean`, `ram-status`, `ram-auto-set{on,minutes}`, `measure-bottleneck{seconds,pid}`,
`bn-find-game`, `update-status`, `offers`, `telemetry-consent`, `claim-key`.
Janela: `minimize/maximize/close-window`, `open-scaling-window`, `gs-minimize/maximize/close`.

## 12. TWEAKS E AÇÕES (ids/valores)

TWEAKS (engine.js): `game-mode, steam-overlay, bg-apps, edge-bg, dlss-ind, gpu-msi, mpo,
transparency, mouse-accel, kbd-repeat, sticky, numlock, delivery, lso, eee, nic-intmod, hibernate,
telemetry, suggestions, bing, activity, widgets, location, end-task, file-ext, hidden-files,
this-pc, classic-menu, dark, task-view, search-icon, bsod-detail`.

ACTIONS (com backup): `Plano de Alta Performance, Modo Máximo Desempenho, Modo X3D Correto,
DVR Desativado, Game Bar Desativado, Sem Reinício Durante o Jogo, Desativar Notificações,
HAGS Ativo, Jogos em Janela Otimizados, Efeitos Visuais Off, SysMain Desativado, Indexação Off,
Serviços Desativados, Serviços Xbox Desativados, Game Bar Removido, 720p Boost Ativo,
OBS Prioritário, Pagefile Automático`.

ONCES: `Otimização Rápida, UWP Removidos, Chrome/Discord Limitados, Apps de Sincronização Fechados,
Explorer Mínimo, Padrões Restaurados, Defender Off, Desativar Atualizações Windows,
System Restore Off, DPI Scaling Off`.
TOOLS: `restore-point, flush-dns, net-reset, update-cleanup, repair`.
Checks: `gpu, ram, amd, intel, encoder`.

## 13. DADOS PERSISTIDOS (`%APPDATA%\VL\data`)

`backups.json` (estado anterior de cada ajuste) · `auto-mode.json` · `auto-prev-plan.json` ·
`ram-auto.json` · `fps-base.json` · `fps-sessions.json` · `fps-overlay.json` · `opti.json` ·
`scaling.json` · `startup-disabled.json` · `startup-values.json` · `desinstalacoes/*.reg` ·
`fivem-settings.backup.xml` · scripts `ps-*.ps1` temporários.

## 14. REFERÊNCIA

- `referencia/analise-gdz-completa.md` — análise opção-por-opção do GDZ (origem do catálogo e mecanismos).
- Cópia do GDZ instalado (para comparar comportamento): `C:\Users\lucas larado\AppData\Local\Programs\GDZ Optimizer`.
- Screenshots: `shots/*.png` (preview = dashboard).

---

**Para continuar sem contexto:** abrir este arquivo, escolher a próxima linha de `7. PENDÊNCIAS`,
implementar, rodar `--smoke` + `--shots` e atualizar as seções 2/3/4/7.

**Ajuste de elevação (importante):** a auto-elevação no start foi removida (se o UAC fosse cancelado a janela não abria). Agora o app abre sempre e a faixa do topo oferece **"Reabrir como admin"** — o elevate-now abre a instância elevada, espera o marcador elevated.lock e só então fecha a original.
**Gotcha:** qualquer launch automatizado (cmd/Start-Process) a partir de um shell com ELECTRON_RUN_AS_NODE=1 faz o app rodar como Node e sair com "bad option". Sempre limpar a variável antes (start.cmd já faz).## CHECKLIST DAS 7 ETAPAS (em andamento)

- [x] **1/7 — Remover controles mortos**: switch "Enviar métricas" removido do Sobre; "Optimized version" removido do dashboard e da janela do scaling (não existe no Lossless); "Draw FPS" agora é gravado no Lossless (`DrawFps`).
- [x] **2/7 — Testar overlay e gargalo com um jogo**: feito com Call of Duty aberto. Achados/correções: PresentMon precisa de admin (mensagem clara agora); sessões ETW órfãs travavam a captura (`--stop_existing_session` + nomes `LOPT_TARGET`/`LOPT_LIST`); gargalo agora amostra 1×/s numa única chamada (8 amostras em 8 s); overlay validado com 30 FPS, MS 33.3, 1% 28, CPU/GPU/RAM e nome do jogo.
- [x] **3/7 — Inicialização via `StartupApproved`**: o estado agora é lido/gravado em `Explorer\StartupApproved` (Run/Run32/StartupFolder), igual ao Gerenciador de Tarefas; o valor do Run não é mais movido; impacto estimado (alto/médio/baixo) exibido em cada linha; itens de HKLM pedem admin (mensagem clara).
- [x] **4/7 — Capas e tamanhos dos jogos**: Steam usa `steamId` e puxa a arte do CDN (retrato + wide); tamanho da pasta somado em paralelo (orçamento 4 s por jogo) e exibido no rodapé do card (COD: 97,5 GB); detecção de "Rodando" por processo real.
- [x] **5/7 — Limpeza sem corte**: medição completa (orçamento só como trava de 30 s), categorias em paralelo, nova categoria **Instaladores de driver** (C:\NVIDIA, C:\AMD, C:\Intel, downloader NVIDIA), progresso no rodapé e "Medindo…" por item; temporários saltaram de ~2 GB para 15,6 GB reais.
- [x] **6/7 — PC Info completo**: microcode (0xA601209), família/modelo/stepping reais do `Identifier`, cache L1/L2/L3 somados (`Win32_CacheMemory`), chips de instruções por família, polegadas/ano das telas via EDID (`root\wmi`), bateria real (`BatteryStaticData` etc.), VRAM real pelo `qwMemorySize`, RAM em bytes e "ligado há" em ms. Cache de 2 min + Atualizar forçando leitura.
- [x] **7/7 — OptiScaler validado (instalação/remoção)**; FiveM **não instalado** neste PC, então o painel GTA RP ficou sem validação real. Teste feito: download do release 0.9.4 (.7z, 55 MB), extração com 7zr, cópia de 18 arquivos para uma pasta sandbox, `OptiScaler.dll` → `dxgi.dll` com backup do original, INI real patcheado (Dx12Upscaler=fsr31, Enabled=true, Dxgi=false) e remoção restaurando o `dxgi.dll` original. COD detectado e **bloqueado** (anti-cheat cod/call of duty) — não instalamos em jogo online.

## CHANGELOG — 2026-11-11 (4ª rodada — etapa 2)

- **Medidor de FPS validado com jogo real** (COD): 30 FPS, frametime 33,3 ms, 1% low 28; lista de processos com FPS por app.
- **PresentMon precisa de administrador**: `--stop_existing_session` + sessões próprias (`LOPT_TARGET`, `LOPT_LIST`) para não travar com sessão órfã; se faltar admin o app mostra o aviso "o medidor precisa de administrador".
- **Gargalo**: medição agora dentro de uma única chamada de PowerShell, 1 amostra por segundo (antes eram ~4 amostras em 8 s por causa do overhead).
- **Overlay validado**: janela sempre-no-topo com FPS/MS/1%/CPU/GPU/RAM/nome, print em `shots/overlay-teste.png`.

## CHANGELOG — 2026-11-11 (5ª rodada — etapa 3)

- **Inicialização na forma do Windows**: leitura e escrita em `HKCU/HKLM\...\Explorer\StartupApproved` (`Run`, `Run32`, `StartupFolder`), com blob binário 02 (ligado) / 03 (desligado). O valor do `Run` fica intacto — o Gerenciador de Tarefas passa a refletir o mesmo estado.
- **Impacto estimado** por app (alto/médio/baixo) na lista, com cor.
- Compatibilidade com itens desligados pela versão antiga (backup próprio) mantida.
- Template da lista corrigido (impacto dentro do bloco de informação, sem sobrepor o switch).

## CHANGELOG — 2026-11-11 (6ª rodada — etapa 4)

- **Capa dos jogos**: `steamId` exposto pelo scanner → o renderer monta a arte oficial do CDN da Steam (retrato + alternativas wide). Epic/FiveM seguem com o card de letra.
- **Tamanho em disco**: soma assíncrona da pasta de cada jogo em paralelo, orçamento de 4 s por jogo, rótulo pt-BR no rodapé do card (ex.: 97,5 GB).
- **"Rodando" de verdade**: `gamesStatus` compara os processos abertos com o `.exe` de cada jogo (antes todos apareciam parados).
- **Bug corrigido**: o renderer só mostra jogos com `installed: true` — o scanner não setava a flag e a lista aparecia vazia.

## CHANGELOG — 2026-11-11 (7ª rodada — etapa 5)

- **Limpeza sem corte**: a medição não usa mais o orçamento de 6 s (que subestimava); agora mede tudo, com trava de segurança de 30 s e categorias em paralelo. Resultado real neste PC: 15,6 GB de temporários (antes aparecia uma fração).
- **Nova categoria "Instaladores de driver"**: C:\NVIDIA, C:\AMD, C:\Intel e `ProgramData\NVIDIA Corporation\Downloader` (arquivos com mais de 7 dias).
- **Progresso**: `clean-status` devolve índice/total e "Medindo…" por item; o rodapé mostra "medindo X/Y".
- **Sem travar a interface**: a checagem de programas abertos virou uma única chamada assíncrona cacheada (antes eram vários `tasklist` síncronos que travavam o app).

## CHANGELOG — 2026-11-11 (8ª rodada — etapa 6)

- **PC Info completo**: microcode `0xA601209`, família 25 / modelo 97 / stepping 2 (lidos do `Identifier` do registro — o CIM reporta 107/0), cache L1 512 KB / L2 8 MB / L3 96 MB, chips de instruções (SSE→AVX-512, SHA, VAES, GFNI).
- **Telas**: polegadas e ano de fabricação via `WmiMonitorBasicDisplayParams`/`WmiMonitorID` (27,2" 2022 e 28,6" 2015 aqui).
- **VRAM real** pelo `HardwareInformation.qwMemorySize` (12 GB em vez de 4 GB do `AdapterRAM`), iGPU marcada como integrada.
- **Bugs corrigidos**: `bootAt` agora em ms (o "Ligado há" mostrava NaN), `installed` do SO, RAM ao vivo em bytes (mostrava 0,0 GB), campos `maker/part` da memória que quebravam o modo Avançado.
- **Desempenho**: `pcinfo-get` com cache de 2 min; botão Atualizar força nova leitura (primeira leitura ~2,3 s).
- Gotcha: o script do `pcinfo-get` usa `String.raw` — sem isso o JS come as barras dos caminhos (`HKLM:\...` virava `HKLM:...`) e microcode/monitores vinham vazios.

## CHANGELOG — 2026-11-11 (9ª rodada — etapa 7)

- **OptiScaler reescrito para o release atual**: o código antigo procurava `.zip` e baixava sem seguir redirect — nunca funcionaria (o release 0.9.4 é `.7z` de 55 MB). Agora: API → asset `.7z/.zip` → download com redirect → extração (7zr baixado de 7-zip.org, ou Expand-Archive para zip).
- **Instalação igual ao setup oficial**: copia todos os arquivos do pacote para a pasta do jogo (menos `setup_*.bat/sh` e README), renomeia `OptiScaler.dll` para o proxy escolhido (`dxgi.dll` padrão; winmm/version/dbghelp/d3d12/wininet/winhttp), faz backup de qualquer arquivo sobrescrito (`.lopt-backup`) e registra tudo para remover.
- **INI real**: usa o `OptiScaler.ini` do pacote e só altera chaves documentadas (`Dx12Upscaler`, `[FrameGen] Enabled`, `Dxgi`).
- **Anti-cheat**: lista ampliada (cod/call of duty/warzone/fivem/valorant/cs2/fortnite/apex/rust/pubg/tarkov/overwatch/the finals/xdefiant/bf2042). O `opti-install` recusa sem confirmação explícita e a UI já mostra "jogo online com anti-cheat".
- **Sandbox de teste**: pasta com `game.exe` falso e `dxgi.dll` original → instalou 18 arquivos + backup, removeu e restaurou o `dxgi.dll` byte a byte.

## CHANGELOG — 2026-11-11 (10ª rodada — VL Scaling em português)

- **Toda a interface do VL Scaling traduzida**: aba do VL e janela separada. Geração de quadros, Tipo, Modo, Alvo, Escala de fluxo, Modo desempenho, Redimensionamento, Tipo, Fator de escala, Nitidez, API de captura, Alvo da fila, Prender cursor, Escalar cursor, Modo de sincronização, Latência máxima de quadros, Suporte a HDR, Mostrar FPS, Sombreamento variável (VRS), Escala automática, Iniciar minimizado, Iniciar como administrador.
- **Sidebar/janela**: "Perfis de jogo", perfil "Padrão", status "Inativo/Ativo", botões "Parar"/"Aplicar".
- **Opções traduzidas**: Desligado, Adaptativo, Fixo, Fusão, Automático, Personalizado, Inteiro, Vizinho mais próximo, Tela cheia, Esticar, Ajustar, Padrão, Equilibrado, Desempenho.
- Valores internos (enviados ao Lossless) continuam em inglês — só o texto visível mudou.

## CHANGELOG — 2026-11-11 (11ª rodada — marca VL e animação)

- **Logo agora é VL** (não mais o L): novo monograma vetorial com gradiente vermelho (#ff3340 → #b00000), gerado em `assets/logo.png`, `logo-branco.png`, `icon.png` e `icon.ico` (16–256 px). O mesmo arquivo alimenta barra do topo, rail, medallion, Sobre e tour.
- **Animação do giroscópio refeita**: os aros agora giram **no próprio plano** (órbita visível, sem virar de lado e sumir) com períodos **18 s / 9 s / 6 s** (1×/2×/3×) e defasagem de 1/3 de volta — ficam sincronizados. O cardã ficou estático (tilt fixo) para o compositor não re-rasterizar o subtree 3D; core respira em 9 s e o brilho pulsa em 9 s (metade do período base).
- **Miolo** virou uma “moeda” arredondada (62 px, raio 17 px) com padding de 9% na imagem, então o VL não é mais cortado pela borda.
- Aros mais finos (4 / 3,5 / 3 px) e maiores (186 / 142 / 102 px), com cabeça clara mais curta para leitura de movimento.
- Provas: `shots/anim-sheet.png` (4 quadros a 0,75 s) e `shots/dashboard.png`.

## CHANGELOG — 2026-11-11 (12ª rodada — animação original de volta, aro interno corrigido)

- **Animação revertida** para o comportamento original: aros em `gySpinY 18s` / `gySpinX 12s` / `gySpinY 8s reverse`, miolo com `gyRock 7s`, brilho em 5 s, cardã parado, estado `.gy-done` com `gyCalm`. Sem sincronia artificial.
- **Correção pontual**: o aro de dentro tinha 94 px e a bola do VL tem 100 px — ele ficava *dentro* da bola, sumia e parecia perdido dos outros. Agora tem **112 px** (fora da bola de 100 px e dentro do aro de 128 px), mantendo o mesmo giro.
- Logo VL continua (novo monograma), apenas ajustado para caber na bola (84% com 8% de margem).

## CHANGELOG — 2026-11-11 (13ª rodada — aros maiores)

- **Aros ampliados**: externo 164→**184 px** (7 px), meio 128→**152 px** (6 px), interno 112→**132 px** (5 px). A bola do VL continua 100 px e o interno segue fora dela.
- **Moeda à frente**: o `gyRock` ganhou `translateZ(20px)`, então o VL fica na frente dos aros na maior parte do giro (menos "corte" no logo).
- Movimento continua o original, sem sincronia: 18 s / 12 s / 8 s (sentido inverso), balanço 7 s, brilho 5 s.

## SITE DE VENDA (novo)

- Pasta `site/`: landing page estática (HTML/CSS/JS, sem build) com a mesma identidade do app (vermelho/preto, logo VL, giroscópio animado, fundo de circuito).
- Seções: hero com giroscópio e chips, marquee, números, 6 recursos, 6 telas reais do app (abas com troca automática), 3 passos, preço (R$ 49,90 configurável), FAQ e CTA final.
- Configuração comercial no topo de `site/app.js` (`CONFIG.price`, `CONFIG.checkoutUrl`).
- Prévia renderizada em `site/preview/` (desktop 1440 e mobile 430).
- `site/README.md` explica como publicar (Netlify/Vercel/Pages) e o que falta para vender (checkout, entrega, licença/ativação, CNPJ, termos).
- Pacote: `VL-Optimizer-site.zip` na área de trabalho.

## SITE PUBLICADO (Cloudflare Pages)

- **URL de produção:** https://vl-optimizer.pages.dev
- **Planos no ar:** mensal R$ 40/mês e vitalício R$ 99.
- Projeto Cloudflare Pages: `vl-optimizer` (conta "Cartas Mágicas", via wrangler já autenticado).
- Pasta enviada: `C:\Users\lucas larado\Desktop\deeepvl\vl-site-deploy` (cópia limpa de `site/` sem `preview/`).
- Deploy feito com: `npx wrangler pages deploy <pasta> --project-name vl-optimizer --branch main`.
- Para atualizar depois: `npx wrangler pages deploy "C:\Users\lucas larado\Desktop\deeepvl\vl-site-deploy" --project-name vl-optimizer --branch main` (ou `site/` com preview).
- Falta: checkout real em `site/app.js` (`CONFIG.checkoutUrl`), domínio próprio (Pages → Custom domains) e sistema de licença no app.

## SITE — atualização 2026-11-11 (suporte, promessas, avaliações)

- **Suporte no Discord**: seção própria (`#suporte`), link no menu e no rodapé, card com botão e chips. O convite fica em `CONFIG.discordUrl` (vazio até o dono mandar o link; o botão avisa).
- **Promessas fortes e honestas** (`#compromisso`): medido não prometido; desfazer de verdade; sem FPS inventado; sem telemetria escondida. Texto assume que **não** promete “dobrar FPS” — promete número real + botão de voltar.
- **Prova real** (`#resultados`): 15,6 GB de temporários, 30 FPS / 1% low 28 no COD e 96 MB de L3 — medições do PC de teste.
- **Relatos** (`#depoimentos`): três relatos de **teste interno** (marcados como tal) + convite para enviar print. Nada de cliente inventado.
- **Extras**: barra fixa de compra no mobile, SEO (canonical, Twitter, FAQPage JSON-LD, robots, sitemap, 404), imagem com `decoding=async`, nav com Suporte.
- Deploy refeito: https://vl-optimizer.pages.dev (wrangler, branch main).


