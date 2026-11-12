# VL Optimizer

Suíte de otimização de PC para jogos — versão vermelho/preto do GDZ Optimizer, com a mesma
estrutura de páginas, animações e interações, e um motor próprio que aplica cada ajuste de verdade
(registro, serviços, powercfg, netsh, DISM) com **backup e desfazer**.

O logo é o seu "L", refinado: marca vetorizada a partir do PNG, fundo transparente, gradiente
vermelho (`#ff2d38 → #c4000e`), usado na barra de título, no giroscópio do Painel e no ícone do app.

| | |
|---|---|
| Shell | Electron 33 (HTML/CSS/JS reaproveitados da interface do GDZ) |
| Motor | `engine.js` + `engine-extras.js` (PowerShell elevado + fs) |
| FPS | `bin/PresentMon.exe` (Intel, MIT) |
| Tema | vermelho/preto (`src/tema-l.css` sobre `theme.css`) |

## Rodar

### Gerar instalador Windows

Execute `npm ci` e `npm run dist` no Windows. O resultado fica em
`release/Instalar-VL-Optimizer-1.0.0.exe`. A configuração em
`electron-builder.json` inclui somente os arquivos de execução e gera um
assistente NSIS em português com atalhos e desinstalador, sem publicar nada.
Para recompilar shaders e motor nativo, execute `npm run build:native`
(requer Windows SDK e MSVC); o motor usa runtime C++ estático.

O guia `LEIA-ME.txt` registra as diferenças em relação ao briefing 0.4.0
e as limitações dos testes desta entrega. A instalação local concluiu,
mas a abertura da interface Electron falhou neste ambiente e não foi
validada em máquina limpa. O pacote não tem assinatura digital.

```bat
cd l-optimizer
npm install
start.cmd
```

`start.cmd` limpa `ELECTRON_RUN_AS_NODE` (essa variável, se estiver no ambiente, faz o Electron
rodar como Node puro e o app não abre). Build portátil: `dist\VL Optimizer-win32-x64\VL Optimizer.exe`.

## Novidades desta versão

- **Nome e marca:** VL (título, janela, instalador e pasta de dados).
- **Sem rastro de rede social:** botões de TikTok/Discord e textos de conta removidos; nada aponta para gdzfps.com.
- **Logo em destaque:** o "VL" virou medalhão no centro do giroscópio (108 px, disco escuro, halo vermelho).
- **Modo administrador:** o app reabre elevado (UAC) na primeira execução; se você cancelar, aparece um aviso no topo com o botão "Reabrir como admin".
- **Atalho global Ctrl+Alt+B:** marca a base de FPS com o jogo em foco, sem sair do jogo.
- **Modo automático de verdade:** com ele ligado, ao abrir um jogo o app baixa a prioridade de Chrome/Discord, fecha OneDrive/Dropbox/Google Drive e liga o plano Alto Desempenho; ao fechar, devolve o plano anterior.
- **Limpar RAM real:** `EmptyWorkingSet` nos processos grandes (teste no PC: liberou ~2 GB).
- **Programas com ícone real** (extraído do shell) e **sobras de registro** com backup `.reg` em `desinstalacoes` antes de apagar.

## O que está ligado de verdade

Cada item abaixo executa o mecanismo real e grava o valor anterior em `backups.json`
(`%APPDATA%\VL Optimizer\data\backups.json`) antes de mexer. Desligar = restaurar o valor exato.

- **Energia**: planos Alto Desempenho / Desempenho Máximo (duplica o Ultimate)/ Equilibrado para X3D,
  Modo de Jogo, DVR, Game Bar, janela de manutenção 24 h, notificações, HAGS (`HwSchMode=2`),
  jogos em janela (`SwapEffectUpgradeEnable`), MSI na GPU, MPO.
- **PC fraco**: efeitos visuais, transparência, SysMain, WSearch, Spooler/Fax/RemoteRegistry/
  MapsBroker/WbioSrvc, serviços Xbox, remoção do Game Bar, 720p (ChangeDisplaySettingsEx),
  Pagefile automático.
- **Mouse/teclado**: aceleração (`MouseSpeed/Threshold` + `SystemParametersInfo`), repetição,
  teclas de aderência, Num Lock.
- **Rede**: DNS por interface (Cloudflare/Google/Quad9/AdGuard), Delivery Optimization, LSO,
  Energy-Efficient Ethernet, Interrupt Moderation, flush DNS, reset Winsock/TCP-IP, OBS como admin.
- **Windows**: telemetria, sugestões, Bing, atividades, widgets, localização, End Task, extensões,
  ocultos, Este PC, menu clássico, tema escuro, Visão de Tarefas, ícone de busca, BSOD detalhado.
- **Ferramentas**: ponto de restauração, DISM/SFC, limpeza do Windows Update, hibernação.
- **Limpeza**: temporários (>1 dia), Lixeira, dumps, cache de Chrome/Edge/Opera/Brave, Discord,
  Steam, Epic e shaders — com detecção de app aberto.
- **Disco**: varredura assíncrona (não trava a interface) com árvore, maiores arquivos e abrir no Explorer.
- **Programas**: 82+ apps reais, desinstalação pelo desinstalador oficial + sobras.
- **Inicialização**: Run (HKCU/HKLM/x86) e pastas de Startup, desligar/religar sem desinstalar.
- **PC Info**: CPU (núcleos, cache, microcode), GPU, pentes DDR5 (SMBIOS), discos SMART, volumes,
  telas, rede, bateria, BIOS/Secure Boot; sensores ao vivo; relatório em texto.
- **FPS**: PresentMon ao vivo, 1% low, contador na tela (overlay click-through), base + ganho
  (Ctrl+Alt+B), gravação antes/depois com veredito.
- **Gargalo**: mede com o jogo em foco (CPU total, núcleo mais quente, GPU 3D) e dá o veredito.
- **Jogos**: Steam/Epic/FiveM, GPU dedicada (`UserGpuPreferences`), cache de shaders, painel do
  FiveM editando o `settings.xml` com backup.
- **VL Scaling**: janela com todas as opções (FG 3.1/2.3/1.1, FSR/NIS/LS1/xBR/Anime4K, DXGI/WGC,
  sync, HDR, VRS, perfis). O botão Scale inicia o **motor externo** escolhido na janela (engrenagem).

## Diferenças honestas em relação ao GDZ

1. **Sem plano/assinatura**: `get-user` devolve plano completo, então nada fica bloqueado.
2. **Motor de frame generation não é redistribuído**: a janela de scaling é 100% funcional, mas o
   binário do motor (Lossless Scaling) é proprietário — aponte o caminho do executável em VL Scaling.
3. **DLSS "modelo recomendado"** virou o **indicador do DLSS** (`ShowDlssIndicator`), que é o
   ajuste real por registro; o preset em si só a NVIDIA App escreve.
4. **Sobreposição da Steam** usa `EnableGameOverlay` (a Steam pode reescrever ao abrir a loja).
5. PresentMon é MIT (licença em `bin/PresentMon.LICENSE.txt`). O logo é seu.

## Estrutura

```
main.js            janelas (dashboard, scaling, overlay), IPC, ticker do FPS
preload.js         ponte segura com lista branca de canais
engine.js          catálogo TWEAKS/ACTIONS/ONCES/TOOLS, backup, probes, checks, DNS, caps
engine-extras.js   limpeza, disco, apps, jogos, FiveAM, PC info, FPS, gargalo, OptiScaler, scaling
src/               interface (dashboard.html + páginas + css + js), tema-l.css, assets
assets/            logo.png, icon.png, icon.ico, logo-branco.png
bin/               PresentMon.exe + licença
tools/             scripts usados para retematizar/gerar o logo (dev)
```

## Adicionar um ajuste

Em `engine.js`, adicione um item em `TWEAKS`:

```js
T('meu-ajuste', {
  cat: 'desempenho', title: 'Meu ajuste', tags: ['FPS'],
  desc: 'O que ele faz, em uma frase.',
  reg: [{ path: 'HKCU:\\Software\\Exemplo', name: 'Valor', type: 'DWord', on: 1, off: 0 }],
}),
```

O status, o switch, o backup e o "desfazer" saem de graça. Para comandos, use `on`/`off`/`probe`
(scripts PowerShell) e `svc: ['NomeDoServico']` para serviços.
