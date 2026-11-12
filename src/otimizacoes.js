// ── Otimizações: catálogo único ──
// Cada ajuste do app aparece UMA vez, na página do assunto dele. Antes o mesmo ajuste estava
// em até três páginas (PC High End, PC Fraco, Input Lag, Live...) com nomes diferentes.
// Três fontes de estado, todas do main.js:
//   T(id)     → ajuste de 'tweaks-status' (liga/desliga com backup; título e texto vêm de lá)
//   A(nome)   → ação de ACTIONS com desfazer ('run-action' / 'revert-action' / 'actions-status')
//   O(nome)   → ação de uma vez só ('run-action', botão)
//   C(nome)   → verificação só de leitura ('run-check')
//   TOOL(id)  → ferramenta demorada ('tweak-tool')
//   FIX(nome) → reparo de ajuste de versões antigas ('revert-action' ou 'run-action')
// Usa ipcRenderer, toast(), addRecent(), go(), navItemFor() e syncUndoButtons() do dashboard.
(function () {
  const T = (id, o = {}) => ({ kind: 'tweak', id, key: 'tweak:' + id, ...o });
  const A = (act, o) => ({ kind: 'act', act, key: 'act:' + act, ...o });
  const O = (act, o) => ({ kind: 'once', act, key: 'once:' + act, ...o });
  const C = (check, o) => ({ kind: 'check', check, key: 'check:' + check, ...o });
  const TOOL = (id, o) => ({ kind: 'tool', id, key: 'tool:' + id, ...o });
  const FIX = (act, o) => ({ kind: 'fix', act, key: 'fix:' + act, ...o });
  const TIP = (o) => ({ kind: 'tip', key: 'tip:' + o.title, ...o });
  const DNS = { kind: 'dns', key: 'dns' };

  const IC = {
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    game: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1"/><circle cx="18" cy="13" r="1"/>',
    gpu: '<rect x="1" y="4" width="22" height="16" rx="3"/><circle cx="12" cy="12" r="3"/>',
    warn: '<path d="M12 2L2 19h20L12 2z"/><path d="M12 9v5M12 16v1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
    key: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    ram: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M8 8V6M12 8V6M16 8V6M8 16v2M12 16v2M16 16v2"/>',
    disk: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>',
    live: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0112.8 12.8M5.6 18.4A9 9 0 0118.4 5.6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    win: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    tool: '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  };

  // ── Onde cada ajuste mora ──
  const PAGES = [
    { id: 'desempenho', name: 'Desempenho', icon: IC.bolt,
      blurb: 'Plano de energia, Modo de Jogo, placa de vídeo e o que roda por trás do jogo.',
      groups: [
        { name: 'Energia e processador', icon: IC.cpu, blurb: 'O processador trabalhando no máximo enquanto você joga.', items: [
          A('Plano de Alta Performance', { title: 'Plano de energia Alto Desempenho', tags: ['FPS mais estável'],
            rec: (c) => !c.x3dDual && !c.laptop,
            desc: 'O processador não baixa a velocidade para economizar energia, então não perde tempo acelerando quando o jogo pede. Menos travadinhas e FPS mínimo mais alto.',
            note: (c) => (c.laptop ? 'Gasta mais bateria: em notebook, use só ligado na tomada.' : 'Gasta um pouco mais de energia.') }),
          A('Modo Máximo Desempenho', { title: 'Plano de energia Desempenho Máximo', tags: ['FPS mais estável'],
            desc: 'Versão mais forte do Alto Desempenho: também tira a economia de energia do disco, do USB e da placa de rede. Ligado, ele já conta como Alto Desempenho: não precisa dos dois.',
            note: 'Mais consumo e temperatura. Indicado só para PC de mesa.' }),
          A('Modo X3D Correto', { title: 'Modo certo para Ryzen X3D', cap: 'x3dDual', rec: true, tags: ['Mais FPS'],
            desc: 'Para Ryzen 7900X3D, 7950X3D, 9900X3D e 9950X3D: plano Equilibrado, Modo de Jogo e Game Bar ligados. É assim que o driver da AMD coloca o jogo nos núcleos com cache extra.' }),
        ] },
        { name: 'Jogo sem interrupção', icon: IC.game, blurb: 'Nada roubando processador ou abrindo por cima da partida.', items: [
          T('game-mode'),
          A('DVR Desativado', { title: 'Sem gravação em segundo plano', rec: true, tags: ['Mais FPS', 'Live'],
            desc: 'Desliga a gravação automática do Xbox Game Bar, que fica filmando os últimos minutos de jogo e ocupa a placa de vídeo o tempo todo. Também libera o encoder para o OBS.' }),
          A('Game Bar Desativado', { title: 'Game Bar (Win+G) desligada', rec: true, tags: ['Mais FPS'],
            desc: 'A tela do Xbox Game Bar para de abrir por cima do jogo com o Win+G e de ficar carregada em segundo plano. A gravação automática também sai. O app continua instalado: desligar aqui devolve tudo.' }),
          T('steam-overlay'),
          TIP({ title: 'Dica: a sobreposição da NVIDIA se desliga na NVIDIA App', cap: 'nvidia',
            desc: 'A NVIDIA App guarda essa opção por conta própria e reescreve qualquer alteração feita por fora, então nenhum otimizador consegue desligá-la de verdade. Na NVIDIA App: Configurações → Sobreposição na tela → desligue. Ela fica acoplada ao jogo o tempo todo e leva junto a gravação do ShadowPlay.' }),
          TIP({ title: 'Dica: a sobreposição do Discord se desliga dentro do Discord', cap: 'discord',
            desc: 'Essa opção fica guardada na sua conta do Discord, não no PC, então nenhum otimizador consegue desligá-la de fora (quem diz que desliga, não desliga). No Discord: Configurações (engrenagem) → Sobreposição de jogo → desligue "Ativar sobreposição no jogo". Ela injeta no jogo igual às outras e costuma custar FPS.' }),
          A('Sem Reinício Durante o Jogo', { title: 'Windows não reinicia sozinho', rec: true, tags: ['Estabilidade'],
            desc: 'As atualizações de segurança continuam chegando, mas o PC só reinicia quando você mandar. Nada de reinício no meio da partida ou da live.' }),
          A('Desativar Notificações', { title: 'Sem notificações do Windows', tags: ['Conforto'],
            desc: 'Os avisos que sobem no canto da tela (apps, e-mail, Windows) param de aparecer.',
            note: 'Vale o tempo todo, não só no jogo: você deixa de ver os avisos também fora dele.' }),
          T('bg-apps'),
          T('edge-bg'),
        ] },
        { name: 'Placa de vídeo e tela', icon: IC.gpu, blurb: 'Como a imagem sai do jogo e chega no monitor.', items: [
          A('HAGS Ativo', { title: 'Agendamento de GPU por hardware (HAGS)', rec: true, restart: 'reboot', tags: ['Menos atraso'],
            desc: 'A própria placa de vídeo organiza a fila de quadros, tirando trabalho do processador. Obrigatório para o DLSS Frame Generation.' }),
          A('Jogos em Janela Otimizados', { title: 'Jogos em janela e sem bordas otimizados', rec: true, tags: ['Menos atraso'],
            desc: 'Jogos em janela ou em "tela cheia sem bordas" (o jeito que o FiveM costuma rodar) passam a mostrar a imagem do modo moderno: menos atraso, com G-Sync/FreeSync e Auto HDR funcionando.' }),
          T('dlss-rec', { cap: 'rtx' }),
          T('gpu-msi'),
          T('mpo'),
        ] },
        { name: 'Para PC fraco', icon: IC.warn, warn: true,
          blurb: 'Tiram recursos do Windows para sobrar processador, memória e disco. Cada um avisa o que você perde.', items: [
          A('Efeitos Visuais Off', { title: 'Sem efeitos visuais do Windows', tags: ['PC fraco'],
            desc: 'Tira sombras e animações de janelas e menus. Ajuda em PC com vídeo integrado ou pouca memória.',
            note: 'O Windows fica com a cara mais simples.' }),
          T('transparency'),
          A('SysMain Desativado', { title: 'SysMain (Superfetch) desligado', tags: ['PC fraco', 'Disco'],
            desc: 'O Windows para de pré-carregar na memória os programas que você mais usa. Ajuda em PC com HD (não SSD) e 8 GB de RAM ou menos.',
            note: 'Com SSD o ganho é quase zero, e os programas podem abrir um pouco mais devagar.' }),
          A('Indexação Off', { title: 'Indexação de arquivos desligada', tags: ['PC fraco', 'Disco'],
            desc: 'O Windows para de ler o disco o tempo todo para montar o índice da pesquisa. Alivia HDs lentos.',
            note: 'A pesquisa de arquivos do Windows fica bem mais lenta.' }),
          A('Serviços Desativados', { title: 'Serviços pouco usados desligados', tags: ['PC fraco'],
            desc: 'Desliga impressão, fax, registro remoto, mapas offline e leitor de digital.',
            note: 'Não use se você tem impressora ou entra no Windows pela digital.' }),
          A('Serviços Xbox Desativados', { title: 'Serviços do Xbox desligados', tags: ['PC fraco'],
            desc: 'Desliga o login e a sincronização de saves do Xbox. Controles do Xbox continuam funcionando.',
            note: 'Jogos do Game Pass, Forza e Minecraft Bedrock deixam de abrir.' }),
          A('Game Bar Removido', { title: 'Xbox Game Bar desinstalado', tags: ['PC fraco'],
            desc: 'Remove o Game Bar (Win+G) e o aviso "ms-gamingoverlay" que aparece sem ele. Desligar aqui reinstala.' }),
          A('720p Boost Ativo', { title: 'Tela em 720p (emergência)', tags: ['Mais FPS'],
            desc: 'Baixa a resolução do Windows para 1280×720 para a placa de vídeo aguentar. Volta ao desligar ou ao reiniciar o PC.',
            note: 'Tudo fica maior e menos nítido. Prefira baixar a resolução dentro do jogo ou usar o VL Scaling.' }),
          O('UWP Removidos', { title: 'Remover apps que vêm com o Windows', btn: 'Remover', tags: ['PC fraco'],
            desc: 'Desinstala Cortana, Clima, Mapas, Filmes e TV, Your Phone, apps do Xbox e outros apps de fábrica.',
            note: 'Não tem desfazer: para ter algum de volta, reinstale pela Microsoft Store.',
            confirm: 'Remover os apps que vêm com o Windows?\n\nNão dá para desfazer pelo L: para ter algum de volta, reinstale pela Microsoft Store.' }),
        ] },
        { name: 'Antes de jogar', icon: IC.clock, blurb: 'Ações de uma vez: valem até você reabrir os programas ou reiniciar o PC.', items: [
          O('Chrome/Discord Limitados', { title: 'Chrome e Discord em prioridade baixa', btn: 'Aplicar',
            desc: 'Quando o processador ficar disputado, o jogo tem a vez. Os dois continuam funcionando normalmente.' }),
          O('Apps de Sincronização Fechados', { title: 'Fechar OneDrive, Dropbox e Google Drive', btn: 'Fechar',
            desc: 'Fecha os apps de nuvem para não usarem disco e internet durante o jogo. Voltam a abrir na próxima vez que você ligar o PC.' }),
        ] },
      ] },

    { id: 'inputlag', name: 'Mouse e teclado', icon: IC.mouse,
      blurb: 'Mira consistente e nenhuma janela abrindo no meio da partida.',
      groups: [
        { name: 'Mouse', icon: IC.mouse, blurb: 'A mira sempre na mesma distância para o mesmo movimento.', items: [T('mouse-accel')] },
        { name: 'Teclado', icon: IC.key, blurb: 'Resposta imediata e nada abrindo sozinho no meio da partida.', items: [T('kbd-repeat'), T('sticky'), T('numlock')] },
      ] },

    { id: 'memoria', name: 'Memória', icon: IC.ram,
      blurb: 'Uso de RAM, cache da memória e memória virtual.',
      groups: [
        { name: 'Memória', icon: IC.ram, blurb: 'Para o jogo não fechar sozinho por falta de memória.', items: [
          A('Pagefile Automático', { title: 'Memória virtual gerenciada pelo Windows', rec: true, restart: 'reboot', tags: ['Estabilidade'],
            desc: 'Volta o arquivo de paginação para o automático. Otimizadores que desligam ou fixam esse arquivo fazem jogos pesados, como o GTA, fecharem do nada.' }),
        ] },
      ] },

    // A limpeza de arquivos e o "O que ocupa o disco" ficam em cima, no limpeza.js; aqui, só o que
    // é ajuste do Windows. Os temporários entraram na limpeza de arquivos.
    { id: 'limpeza', name: 'Limpeza', icon: IC.disk, noBar: true,
      blurb: 'Cache de navegadores e apps, temporários e o que ocupa o disco.',
      groups: [
        { name: 'Mais espaço no disco C:', icon: IC.disk, blurb: 'Ajustes do Windows que devolvem alguns GB.', items: [
          TOOL('update-cleanup'),
          T('hibernate'),
        ] },
      ] },

    { id: 'live', name: 'Internet e live', icon: IC.globe,
      blurb: 'DNS, upload livre para o jogo e a live, e correções de rede.',
      groups: [
        { name: 'Internet', icon: IC.globe, blurb: 'Conexão livre para o jogo e correções para quando a rede fica estranha.', items: [
          DNS, T('delivery'), T('lso'), T('eee'), T('nic-intmod'), TOOL('flush-dns'), TOOL('net-reset'),
        ] },
        { name: 'Live e gravação', icon: IC.live, blurb: 'OBS sem "lag de codificação". A gravação do Windows fica em Desempenho.', items: [
          A('OBS Prioritário', { title: 'OBS com prioridade', cap: 'obs', rec: true, tags: ['Live'],
            desc: 'Abre o OBS como administrador (assim ele reserva placa de vídeo e acaba o "lag de codificação") e impede o Windows de jogá-lo para núcleos lentos.',
            note: 'O Windows vai pedir confirmação toda vez que o OBS abrir.' }),
          C('encoder', { title: 'Configuração ideal do OBS', btn: 'Ver',
            desc: 'Diz qual encoder, preset e bitrate usar no OBS com a sua placa de vídeo.' }),
        ] },
      ] },

    { id: 'tweaks', name: 'Windows', icon: IC.win, search: true,
      blurb: 'Privacidade, praticidade e reparos. Quase nada aqui muda o FPS.',
      groups: [
        { name: 'Privacidade e propaganda', icon: IC.shield, blurb: 'Menos dados enviados, menos anúncios e menos processos de fundo.', items: [
          T('telemetry'), T('suggestions'), T('bing'), T('activity'), T('widgets'), T('location'),
        ] },
        { name: 'Praticidade e aparência', icon: IC.win, blurb: 'Não mudam o FPS: ligue só o que você gostar.', items: [
          T('end-task'), T('file-ext'), T('hidden-files'), T('this-pc'), T('classic-menu'), T('dark'),
          T('taskbar-left'), T('task-view'), T('search-icon'), T('bsod-detail'),
        ] },
        { name: 'Manutenção e reparo', icon: IC.tool, blurb: 'Consertos de uma vez. Rodam em segundo plano.', items: [
          TOOL('restore-point'),
          TOOL('repair'),
          O('Explorer Mínimo', { title: 'Reiniciar a barra de tarefas', btn: 'Reiniciar',
            desc: 'Reinicia o Explorador do Windows. Resolve barra de tarefas ou Iniciar travados. Não muda o FPS.' }),
          O('Padrões Restaurados', { title: 'Limpar ajustes antigos do L', btn: 'Limpar',
            desc: 'Versões antigas do VL aplicavam ajustes sem efeito ou prejudiciais (recuperação da placa de vídeo, timer, fila do mouse, rede). Volta tudo ao padrão do Windows.' }),
          FIX('Defender Off', { title: 'Religar o Windows Defender', btn: 'Religar',
            desc: 'Religa a proteção em tempo real, se uma versão antiga do VL a desligou.' }),
          FIX('Desativar Atualizações Windows', { title: 'Religar o Windows Update', btn: 'Religar',
            desc: 'Religa o serviço de atualizações, se uma versão antiga do VL o desativou.' }),
          FIX('System Restore Off', { title: 'Religar a Restauração do Sistema', btn: 'Religar',
            desc: 'Volta a criar pontos de restauração, se uma versão antiga do VL os desligou.' }),
          FIX('DPI Scaling Off', { title: 'Consertar a escala da tela', btn: 'Consertar',
            desc: 'Desfaz o antigo "Desativar DPI Scaling", que deixava textos e janelas minúsculos em telas grandes.' }),
        ] },
      ] },

    { id: 'hardware', name: 'Verificar hardware', icon: IC.cpu, checksOnly: true,
      blurb: 'Confere driver, BIOS e memória. Só lê: não muda nada no PC.',
      groups: [
        { name: 'Processador', icon: IC.cpu, blurb: 'Driver de chipset, microcode e configuração certa para o seu modelo.', items: [
          C('amd', { title: 'Verificar Ryzen', cap: 'amd', desc: 'Confere o driver de chipset da AMD e, nos X3D de dois CCDs, a configuração que o driver precisa.' }),
          C('intel', { title: 'Verificar processador Intel', cap: 'intel', desc: 'Confere o microcode dos Core de 13ª/14ª geração (degradação), os requisitos do Core Ultra 200S e o Modo de Jogo nos híbridos.' }),
          TIP({ title: 'Dica: o maior ganho do Ryzen está na BIOS', cap: 'amd', desc: 'Ligue o EXPO para a memória e, se souber ajustar, o PBO com Curve Optimizer.' }),
          TIP({ title: 'Dica: Intel com P-cores e E-cores', cap: 'intelHybrid', desc: 'Deixe o Windows escolher os núcleos com o Modo de Jogo ligado. Desligar E-cores ou forçar afinidade não traz ganho.' }),
        ] },
        { name: 'Placa de vídeo', icon: IC.gpu, blurb: 'Driver, HAGS e Resizable BAR.', items: [
          C('gpu', { title: 'Verificar placa de vídeo', desc: 'Confere a idade do driver, o HAGS e, na NVIDIA, se o Resizable BAR está ligado.' }),
          TIP({ title: 'Dica NVIDIA RTX: mais FPS com o DLSS 4.5', cap: 'rtx', desc: 'Ligue "DLSS no modelo recomendado pela NVIDIA" em Desempenho → Placa de vídeo e tela (é o botão "Recomendado" de Substituição do DLSS na NVIDIA App). Depois, dentro do jogo, baixe o DLSS de Qualidade para Equilibrado ou Desempenho: a imagem desses modos melhorou bastante no DLSS 4.5 e é daí que vem o FPS. Não force a Predefinição M em todos os modos: ela só pesa mais. Vale para jogos que têm DLSS (o FiveM clássico não tem).' }),
          TIP({ title: 'Dica NVIDIA: menor atraso sem cortes na imagem', cap: 'nvidia', desc: 'No jogo, ligue o NVIDIA Reflex. No Painel NVIDIA: V-Sync ligado + G-Sync ligado + limite de FPS 3 abaixo da taxa do monitor (ex.: 141 em 144 Hz).' }),
          TIP({ title: 'Dica AMD Radeon: menor atraso', cap: 'amdGpu', desc: 'No jogo, ligue o AMD Anti-Lag 2 quando existir. No Adrenalin: FreeSync ligado, Enhanced Sync desligado e limite de FPS um pouco abaixo da taxa do monitor.' }),
        ] },
        { name: 'Memória RAM', icon: IC.ram, blurb: 'Velocidade do kit e dual channel.', items: [
          C('ram', { title: 'Verificar memória (XMP/EXPO)', desc: 'Confere se a memória está na velocidade do kit e em dual channel. XMP/EXPO desligado é o maior ganho de FPS de graça que existe.' }),
        ] },
      ] },
  ];

  const TOOLS = {
    'restore-point': { title: 'Criar ponto de restauração', btn: 'Criar ponto',
      desc: 'Todo ajuste do VL já tem volta. O ponto de restauração é uma garantia extra do próprio Windows antes de mexer em muita coisa.' },
    'flush-dns': { title: 'Limpar cache de DNS', btn: 'Limpar',
      desc: 'Resolve site ou servidor de jogo que "não abre" depois de mudar de rede ou de DNS. Instantâneo.' },
    'net-reset': { title: 'Resetar a rede', btn: 'Resetar',
      desc: 'Refaz as configurações de rede do Windows (Winsock e TCP/IP). Use quando a internet funciona no celular mas não no PC.',
      note: 'Apaga IP fixo e pode desconfigurar VPNs. Reinicie o PC depois.',
      confirm: 'Resetar a rede do Windows?\n\nIP fixo e configurações de VPN podem ser apagados. Você vai precisar reiniciar o PC.' },
    'update-cleanup': { title: 'Limpar sobras do Windows Update', btn: 'Limpar', time: 'Leva de 5 a 20 minutos', tags: ['Espaço em disco'],
      desc: 'Apaga versões antigas de arquivos do sistema que as atualizações deixam para trás. Costuma liberar alguns GB no disco C:.' },
    'repair': { title: 'Reparar arquivos do Windows', btn: 'Reparar', time: 'Leva de 15 a 40 minutos',
      desc: 'Roda o DISM e o SFC: verificam e consertam arquivos do Windows corrompidos. Indicado para travamentos, telas azuis e erros estranhos.',
      confirm: 'Reparar os arquivos do Windows?\n\nPode levar até 40 minutos e usa bastante o disco. Dá para continuar usando o PC.' },
  };
  const RESTART = { reboot: 'Vale após reiniciar', explorer: 'Reinicia a barra de tarefas', net: 'Internet cai uns segundos' };
  const DNS_INFO = { title: 'Servidor DNS',
    desc: 'É quem traduz o nome dos sites e servidores para o endereço deles. Trocar ajuda quando sites e launchers demoram para abrir ou o DNS da operadora cai. Não diminui o ping dentro do jogo.' };
  // Palavras que o jogador usa para o problema e que não estão no texto do ajuste. A busca do
  // topo (busca.js) procura nelas também.
  const SYN = {
    'tweak:lso': 'upload discord live stream caindo cai conexao rede offload realtek intel',
    'tweak:eee': 'energy efficient ethernet green ethernet cabo conexao caindo cai desconecta pico de ping 100mb realtek intel',
    'tweak:nic-intmod': 'interrupt moderation interrupcao latencia ping placa de rede',
    'tweak:transparency': 'transparencia vidro fosco acrilico mica blur video integrado',
    'tweak:dlss-rec': 'dlss 4.5 predefinicao preset modelo m k l override substituicao nvidia app super resolution transformer rtx',
    'tweak:mpo': 'flicker piscando pisca tela preta faixa gsync freesync monitor',
    'tweak:gpu-msi': 'interrupcao latencia msi utility irq travadinha stutter',
    'tweak:steam-overlay': 'shift tab overlay',
    'tweak:game-mode': 'game mode',
    'tweak:delivery': 'delivery optimization p2p atualizacao internet',
    'tweak:edge-bg': 'microsoft edge navegador segundo plano',
    'tweak:hibernate': 'hibernacao inicializacao rapida fast startup',
    'tweak:mouse-accel': 'aceleracao precisao do ponteiro enhance pointer precision sensibilidade',
    'tweak:sticky': 'teclas de aderencia shift 5 vezes sticky keys',
    'tweak:kbd-repeat': 'repeticao delay atraso',
    'tweak:telemetry': 'privacidade rastreamento dados',
    'tweak:bing': 'pesquisa busca web',
    'tweak:widgets': 'noticias clima',
    'tweak:bsod-detail': 'bsod erro crash',
    'tweak:classic-menu': 'menu de contexto botao direito windows 10',
    'act:HAGS Ativo': 'hardware accelerated gpu scheduling frame generation dlss',
    'act:Plano de Alta Performance': 'power plan energia',
    'act:Modo Máximo Desempenho': 'ultimate performance power plan',
    'act:DVR Desativado': 'game dvr gravacao xbox captura',
    'act:Game Bar Desativado': 'xbox win+g overlay',
    'act:Pagefile Automático': 'memoria virtual paginacao swap crash fecha sozinho',
    'act:OBS Prioritário': 'lag de codificacao encoding stream live',
    'act:Jogos em Janela Otimizados': 'sem bordas borderless janela flip',
    'dns': 'dns cloudflare google quad9 adguard 1.1.1.1 8.8.8.8 anuncios sites',
  };
  const DNS_OPTS = [
    { id: 'auto', name: 'Automático', desc: 'O da sua operadora (padrão do Windows).' },
    { id: 'cloudflare', name: 'Cloudflare', desc: '1.1.1.1 · o mais rápido na maioria do Brasil.' },
    { id: 'google', name: 'Google', desc: '8.8.8.8 · estável e conhecido.' },
    { id: 'quad9', name: 'Quad9', desc: '9.9.9.9 · bloqueia sites de golpe e vírus.' },
    { id: 'adguard', name: 'AdGuard', desc: 'Bloqueia anúncios e rastreadores em todo o PC.' },
  ];

  // ── Estado ──
  const st = { tweaks: null, acts: {}, blocked: {}, caps: null, dns: 'auto', tools: [], loaded: false,
    // Plano do usuario logado. Mesmo modelo da referencia: user.features guarda as paginas
    // liberadas e ['*'] libera tudo. Sem login (ou sem Supabase), tudo liberado.
    conta: null,
    loading: null, busy: new Set(), queries: {}, lastLoad: 0 };
  const $ = (sel, root = document) => root.querySelector(sel);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svg = (inner, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#e0101f" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const invoke = async (ch, arg) => { try { return await ipcRenderer.invoke(ch, arg); } catch (e) { return { success: false, error: e.message }; } };
  const val = (v) => (typeof v === 'function' ? v(st.caps || {}) : v);
  const tweak = (id) => (st.tweaks || []).find(t => t.id === id) || null;

  const CAPS = {
    amd: (c) => c.cpuVendor === 'amd', intel: (c) => c.cpuVendor === 'intel', x3dDual: (c) => !!c.x3dDual,
    intelHybrid: (c) => !!c.intelHybrid, nvidia: (c) => !!c.nvidia, amdGpu: (c) => !!c.amdGpu, obs: (c) => !!c.obsExe,
    discord: (c) => !!c.discord, rtx: (c) => !!c.rtx,
  };
  // Some quando não se aplica a este PC (em vez de aparecer bloqueado).
  const hidden = (it) => !!(it.cap && st.caps && !CAPS[it.cap](st.caps));

  // Dados que a linha mostra, venham do main.js (tweak) ou do catálogo.
  function info(it) {
    if (it.kind === 'tweak') {
      const t = tweak(it.id);
      if (!t) return null;
      return { title: it.title || t.title, desc: it.desc || t.desc, note: t.note, tags: t.tags, rec: t.rec, restart: t.restart, blocked: t.blocked, on: t.on };
    }
    if (it.kind === 'tool') return { ...TOOLS[it.id], ...it };
    const blocked = (it.kind === 'act' || it.kind === 'once') && Object.prototype.hasOwnProperty.call(st.blocked, it.act) ? st.blocked[it.act] : null;
    return { ...it, note: val(it.note), rec: !!val(it.rec), blocked, on: it.kind === 'act' ? st.acts[it.act] === true : false };
  }
  const isSwitch = (it) => it.kind === 'tweak' || it.kind === 'act';
  const allItems = () => PAGES.flatMap(p => p.groups.flatMap(g => g.items.map(it => ({ it, page: p }))));

  // ── Carregar ──
  function load(silent) {
    if (st.loading) return st.loading;
    if (!silent || !st.loaded) PAGES.forEach(p => { const r = root(p); if (r && !st.loaded) r.replaceChildren(el('div', 'tw-loading', 'Lendo as configurações do Windows…')); });
    st.loading = (async () => {
      const [tw, ac, caps, plano] = await Promise.all([invoke('tweaks-status'), invoke('actions-status'), invoke('get-caps'), invoke('conta-plano').catch(() => null)]);
      st.conta = (plano && typeof plano === 'object') ? plano : { semLogin: true };
      if (caps && typeof caps === 'object' && !caps.error) { st.caps = caps; st.blocked = caps.blocked || {}; }
      if (tw && Array.isArray(tw.tweaks)) { st.tweaks = tw.tweaks; st.dns = tw.dns || 'auto'; st.tools = tw.tools || []; }
      if (ac && ac.success && ac.on) st.acts = ac.on;
      st.lastLoad = Date.now();
      if (!st.tweaks && !st.loaded) { renderError(); return; }
      if (!st.loaded) { st.loaded = true; renderAll(); } else repaint();
      if (!mostrarBloqueioDePc()) { paintLocks(); ligarGuardaDeNavegacao(); }
      changed();
    })().finally(() => { st.loading = null; });
    return st.loading;
  }
  // Várias mudanças seguidas viram uma leitura só.
  let refreshT;
  function refreshSoon(ms = 900) { clearTimeout(refreshT); refreshT = setTimeout(() => load(true), ms); }

  function renderError() {
    PAGES.forEach(p => {
      const r = root(p);
      if (!r) return;
      const box = el('div', 'tw-empty', 'Não foi possível ler as configurações do Windows.');
      const b = el('button', 'run-btn', 'Tentar de novo');
      b.onclick = () => load();
      box.append(el('br'), b);
      r.replaceChildren(box);
    });
  }

  // ── Desenhar ──
  const root = (p) => document.getElementById('opt-' + p.id);

  function renderAll() {
    // Ajuste novo no main.js que ainda não tem lugar no catálogo: entra no fim da página Windows.
    const placed = new Set(allItems().filter(x => x.it.kind === 'tweak').map(x => x.it.id));
    const extra = (st.tweaks || []).filter(t => !placed.has(t.id)).map(t => T(t.id));
    const win = PAGES.find(p => p.id === 'tweaks');
    win.groups = win.groups.filter(g => !g.extra);
    if (extra.length) win.groups.push({ name: 'Outros ajustes', icon: IC.win, blurb: 'Ajustes novos desta versão.', items: extra, extra: true });
    PAGES.forEach(renderPage);
    renderOverview();
  }

  function renderPage(p) {
    const r = root(p);
    if (!r) return;
    const parts = [];
    if (!p.checksOnly && !p.noBar) parts.push(pageBar(p));
    if (p.search) parts.push(searchBox(p));
    for (const g of p.groups) {
      const rows = g.items.filter(it => !hidden(it)).map(it => row(it, p)).filter(Boolean);
      if (!rows.length) continue;
      const sec = el('section', 'tw-sec' + (g.warn ? ' op-warn' : ''));
      const hdr = el('div', 'tw-sec-hdr');
      const ic = el('div', 'tw-sec-ic'); ic.innerHTML = svg(g.icon);
      const txt = el('div');
      txt.append(el('div', 'tw-sec-name', g.name), el('div', 'tw-sec-blurb', g.blurb));
      hdr.append(ic, txt, el('div', 'tw-sec-count'));
      const list = el('div', 'tw-list');
      list.append(...rows);
      sec.append(hdr, list);
      sec._group = g;
      parts.push(sec);
    }
    if (p.search) { const none = el('div', 'tw-empty', 'Nenhum ajuste encontrado para essa busca.'); none.dataset.none = '1'; none.hidden = true; parts.push(none); }
    r.replaceChildren(...parts);
    if (p.search) filter(p);
    paintPage(p);
  }

  function pageBar(p) {
    const bar = el('div', 'op-bar');
    const txt = el('div', 'op-bar-txt');
    txt.append(el('b', 'op-bar-count'), el('span', 'op-bar-sub', 'Tudo aqui tem volta: desligue para deixar como estava.'));
    const b = el('button', 'qo-btn op-rec-btn', 'Aplicar recomendados');
    b.type = 'button';
    b.onclick = () => applyRecommended(p, b);
    bar.append(txt, b);
    return bar;
  }

  function searchBox(p) {
    const s = el('label', 'tw-search op-search');
    s.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ff6b74" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    const inp = el('input');
    inp.type = 'text';
    inp.placeholder = 'Buscar ajuste (ex.: Edge, notificação, tela azul)…';
    inp.value = st.queries[p.id] || '';
    inp.oninput = () => { st.queries[p.id] = inp.value; filter(p); };
    s.append(inp);
    return s;
  }

  function filter(p) {
    const r = root(p);
    const q = norm(st.queries[p.id]).trim();
    let any = false;
    r.querySelectorAll('.tw-sec').forEach(sec => {
      let vis = 0;
      sec.querySelectorAll('.tw-row').forEach(row => {
        const ok = !q || (row.dataset.search || '').includes(q);
        row.classList.toggle('is-hidden', !ok);
        if (ok) vis++;
      });
      sec.classList.toggle('is-hidden', !vis);
      if (vis) any = true;
    });
    const none = r.querySelector('[data-none]');
    if (none) none.hidden = any;
  }

  function row(it, p) {
    if (it.kind === 'dns') return dnsRow();
    const d = info(it);
    if (!d) return null;
    const r = el('div', 'tw-row' + (it.kind === 'tip' ? ' op-tip' : ''));
    r.dataset.key = it.key;
    r._item = it;
    r.dataset.search = norm([d.title, d.desc, d.note, ...(d.tags || [])].join(' '));
    const main = el('div', 'tw-main');
    const title = el('div', 'tw-title', d.title);
    if (d.rec && isSwitch(it)) title.append(el('span', 'tw-badge rec', 'Recomendado'));
    if (d.restart && RESTART[d.restart]) title.append(el('span', 'tw-badge', RESTART[d.restart]));
    if (it.kind === 'once' || it.kind === 'tool' || it.kind === 'fix') title.append(el('span', 'tw-badge', 'Uma vez'));
    if (it.kind === 'check') title.append(el('span', 'tw-badge', 'Só verifica'));
    main.append(title, el('div', 'tw-desc', d.desc));
    if (d.tags && d.tags.length) {
      const tags = el('div', 'tw-tags');
      d.tags.forEach(x => tags.append(el('span', 'tw-tag', x)));
      main.append(tags);
    }
    if (d.time) main.append(el('div', 'tw-time', '⏱ ' + d.time + ' · pode continuar usando o PC'));
    if (d.note) main.append(el('div', 'tw-note', '⚠ ' + d.note));
    if (d.blocked) main.append(el('div', 'tw-why', d.blocked));
    if (it.kind === 'check') { const out = el('div', 'check-result op-check'); main.append(out); }
    r.append(main);
    if (isSwitch(it)) {
      const sw = el('button', 'tw-switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', d.title);
      sw.onclick = () => toggle(it, sw);
      r.append(sw);
    } else if (it.kind !== 'tip') {
      const running = it.kind === 'tool' && st.tools.includes(it.id);
      const b = el('button', 'run-btn tw-tool-btn', running ? 'Rodando…' : (d.btn || (it.kind === 'check' ? 'Verificar' : 'Executar')));
      b.type = 'button';
      if (running) { b.classList.add('busy'); b.disabled = true; }
      if (it.kind === 'check') b.dataset.check = it.check;
      if (it.kind === 'tool') b.dataset.tool = it.id;
      b.onclick = () => runButton(it, b, p);
      r.append(b);
    }
    paintRow(r);
    return r;
  }

  function paintRow(r) {
    const it = r._item;
    if (!it || !isSwitch(it)) {
      if (it && (it.kind === 'once')) {
        const d = info(it);
        const b = r.querySelector('.tw-tool-btn');
        r.classList.toggle('is-blocked', !!d.blocked);
        if (b && !b.classList.contains('busy')) b.disabled = !!d.blocked;
      }
      return;
    }
    const d = info(it);
    if (!d) return;
    const sw = r.querySelector('.tw-switch');
    const busy = st.busy.has(it.key);
    r.classList.toggle('is-on', !!d.on && !busy);
    r.classList.toggle('is-blocked', !!d.blocked && !d.on);
    if (!busy) sw.setAttribute('aria-checked', d.on ? 'true' : 'false');
    sw.classList.toggle('busy', busy);
    // Bloqueado mas já ligado (aplicado antes ou por fora) continua podendo ser desligado.
    sw.disabled = busy || (!!d.blocked && !d.on);
    sw.title = d.blocked && !d.on ? d.blocked : d.on ? 'Ligado — clique para voltar como estava' : 'Desligado — clique para aplicar';
  }

  function dnsRow() {
    const box = el('div', 'tw-row tw-dns');
    box.dataset.key = 'dns';
    box.dataset.search = norm('dns servidor cloudflare google quad9 adguard anuncios internet sites');
    const main = el('div', 'tw-main');
    main.append(el('div', 'tw-title', DNS_INFO.title), el('div', 'tw-desc', DNS_INFO.desc));
    const opts = el('div', 'tw-dns-opts');
    for (const o of DNS_OPTS) {
      const b = el('button', 'tw-dns-opt');
      b.type = 'button';
      b.dataset.dns = o.id;
      b.append(el('b', null, o.name), el('span', null, o.desc));
      b.onclick = () => setDns(o.id);
      opts.append(b);
    }
    main.append(opts);
    const why = el('div', 'tw-why', 'Seu PC está com um DNS personalizado que não é nenhum destes.');
    why.dataset.custom = '1';
    main.append(why);
    box.append(main);
    return box;
  }
  function paintDns() {
    document.querySelectorAll('.tw-dns').forEach(box => {
      box.querySelectorAll('.tw-dns-opt').forEach(b => b.classList.toggle('active', b.dataset.dns === st.dns));
      const why = box.querySelector('[data-custom]');
      if (why) why.hidden = st.dns !== 'custom';
    });
  }

  // Contadores e botão "Aplicar recomendados" de uma página.
  function pageItems(p) {
    return p.groups.flatMap(g => g.items).filter(it => isSwitch(it) && !hidden(it)).map(it => ({ it, d: info(it) })).filter(x => x.d);
  }
  const pendingRec = (p) => pageItems(p).filter(x => x.d.rec && !x.d.on && !x.d.blocked && !st.busy.has(x.it.key));

  function paintPage(p) {
    const r = root(p);
    if (!r) return;
    r.querySelectorAll('.tw-row').forEach(paintRow);
    r.querySelectorAll('.tw-sec').forEach(sec => {
      const items = sec._group.items.filter(it => isSwitch(it) && !hidden(it)).map(info).filter(Boolean);
      const n = sec.querySelector('.tw-sec-count');
      if (n) n.textContent = items.length ? `${items.filter(d => d.on).length} de ${items.length} ligados` : '';
    });
    paintDns();
    const items = pageItems(p);
    const cnt = r.querySelector('.op-bar-count');
    if (cnt) cnt.textContent = `${items.filter(x => x.d.on).length} de ${items.length} ajustes ligados`;
    const b = r.querySelector('.op-rec-btn');
    if (b && !b.dataset.busy) {
      const n = pendingRec(p).length;
      const recTotal = items.filter(x => x.d.rec && !x.d.blocked).length;
      b.hidden = !recTotal;
      b.disabled = !n;
      b.textContent = n ? `Aplicar recomendados (${n})` : 'Recomendados aplicados ✓';
    }
  }
  function repaint() { PAGES.forEach(paintPage); renderOverview(); }

  // ── Ações ──
  async function toggle(it, sw, quiet) {
    if (st.busy.has(it.key)) return false;
    const d = info(it);
    const on = !d.on;
    st.busy.add(it.key);
    document.querySelectorAll(`.tw-row[data-key="${CSS.escape(it.key)}"] .tw-switch`).forEach(x => x.setAttribute('aria-checked', on ? 'true' : 'false'));
    repaint();
    let r;
    if (it.kind === 'tweak') r = await invoke('tweak-set', { id: it.id, on });
    else r = await invoke(on ? 'run-action' : 'revert-action', { action: it.act });
    st.busy.delete(it.key);
    let ok = !!(r && r.success);
    if (ok) {
      if (it.kind === 'tweak') {
        const t = tweak(it.id);
        if (t) t.on = r.on === true;
        if (t && t.on !== on) { ok = false; r = { error: 'o Windows não aceitou a mudança.' }; }
      } else st.acts[it.act] = on;
    }
    repaint();
    if (!ok) { toast(`${d.title}: ${(r && r.error) || (on ? 'não foi possível aplicar.' : 'não foi possível desfazer.')}`); return false; }
    if (typeof addRecent === 'function') addRecent(`${d.title}: ${on ? 'ligado' : 'desligado'}`, { page: pageOf(it), el: sw.closest('.tw-row') });
    if (!quiet) {
      if (r.message) toast(`${d.title}: ${r.message}`);
      else if (on && d.restart === 'reboot') toast(`${d.title}: ligado. Vale depois de reiniciar o PC.`);
      else toast(`${d.title}: ${on ? 'ligado' : 'desligado, voltou como estava'}.`);
    }
    selfSync();
    return true;
  }

  async function runButton(it, btn, p) {
    const d = info(it);
    if (it.kind === 'check') return runCheckRow(btn, it.check);
    if (d.confirm && !confirm(d.confirm)) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('busy');
    btn.textContent = it.kind === 'tool' ? 'Rodando…' : 'Aplicando…';
    let r;
    if (it.kind === 'tool') r = await invoke('tweak-tool', { id: it.id });
    else if (it.kind === 'fix') r = await invoke('revert-action', { action: it.act });
    else r = await invoke('run-action', { action: it.act });
    // A página pode ter sido redesenhada enquanto rodava: atualiza o botão que estiver na tela.
    const cur = document.querySelector(`.tw-row[data-key="${CSS.escape(it.key)}"] .tw-tool-btn`) || btn;
    cur.disabled = false;
    cur.classList.remove('busy');
    cur.textContent = label;
    if (r && r.success) {
      toast(r.message ? `${d.title}: ${r.message}` : `${d.title}: concluído.`);
      if (typeof addRecent === 'function') addRecent(d.title, { page: p.id, el: cur.closest('.tw-row') });
      selfSync();
    } else {
      toast(`${d.title}: ${(r && r.error) || 'não foi possível concluir.'}`);
    }
  }

  async function runCheckRow(btn, name) {
    const out = btn.closest('.tw-row').querySelector('.op-check');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    const r = await invoke('run-check', { name });
    btn.disabled = false;
    btn.textContent = label;
    if (!r || typeof r !== 'object' || r.success === false) { out.className = 'check-result op-check'; out.textContent = (r && r.error) || 'Não foi possível verificar.'; return; }
    out.className = 'check-result op-check cr-' + (r.level || 'info');
    window.dispatchEvent(new CustomEvent('gdz-diag', { detail: 'hardware' }));
    const t = el('div', 'cr-title', r.title || '');
    const ul = el('ul');
    (r.lines || []).forEach(l => ul.append(el('li', null, l)));
    out.replaceChildren(t, ul);
  }

  async function setDns(provider) {
    if (provider === st.dns) return;
    const btns = document.querySelectorAll('.tw-dns-opt');
    btns.forEach(b => { b.disabled = true; });
    const r = await invoke('tweak-dns', { provider });
    btns.forEach(b => { b.disabled = false; });
    if (r && r.success) {
      st.dns = r.dns || provider;
      const o = DNS_OPTS.find(x => x.id === st.dns);
      toast(o ? `DNS: ${o.name}.` : 'DNS alterado.');
    } else toast(`DNS: ${(r && r.error) || 'não foi possível alterar.'}`);
    paintDns();
  }

  async function applyRecommended(p, btn) {
    const list = pendingRec(p);
    if (!list.length) return;
    if (!confirm(`Aplicar ${list.length} ajuste${list.length > 1 ? 's' : ''} recomendado${list.length > 1 ? 's' : ''}?\n\n• ${list.map(x => x.d.title).join('\n• ')}\n\nTodos têm volta: dá para desligar um por um depois.`)) return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    let ok = 0, reboot = 0, n = 0;
    for (const x of list) {
      btn.textContent = `Aplicando ${++n} de ${list.length}…`;
      const sw = document.querySelector(`#opt-${p.id} .tw-row[data-key="${CSS.escape(x.it.key)}"] .tw-switch`);
      if (sw && await toggle(x.it, sw, true)) { ok++; if (x.d.restart === 'reboot') reboot++; }
    }
    delete btn.dataset.busy;
    paintPage(p);
    toast(`${ok} de ${list.length} ajustes aplicados.` + (reboot ? ` ${reboot} ${reboot > 1 ? 'valem' : 'vale'} depois de reiniciar o PC.` : ''));
  }

  // syncUndoButtons (do dashboard) atualiza o "Reverter Tudo"; o embrulho abaixo faz o catálogo
  // reler o Windows quando OUTRA parte do app muda algo (Otimização Rápida, perfil de jogo, Reverter Tudo).
  let selfSyncing = false;
  function selfSync() {
    selfSyncing = true;
    try { if (typeof syncUndoButtons === 'function') syncUndoButtons(); } finally { selfSyncing = false; }
    refreshSoon(1500);
  }
  const origSync = window.syncUndoButtons;
  if (typeof origSync === 'function') {
    window.syncUndoButtons = function () {
      const r = origSync.apply(this, arguments);
      if (!selfSyncing && st.loaded) refreshSoon();
      return r;
    };
  }

  const pageOf = (it) => (allItems().find(x => x.it.key === it.key) || { page: PAGES[0] }).page.id;

  // ── Painel: um cartão por página, com quantos recomendados já estão ligados ──
  function renderOverview() {
    const box = document.getElementById('dh-cats');
    if (!box) return;
    const cards = PAGES.filter(p => !p.checksOnly && !p.noBar).map(p => {
      const items = pageItems(p);
      const rec = items.filter(x => x.d.rec && !x.d.blocked);
      const recOn = rec.filter(x => x.d.on).length;
      const c = el('button', 'op-cat');
      c.type = 'button';
      c.onclick = () => goTo(p.id);
      const ic = el('div', 'op-cat-ic'); ic.innerHTML = svg(p.icon, 18);
      const txt = el('div', 'op-cat-txt');
      txt.append(el('div', 'op-cat-name', p.name), el('div', 'op-cat-blurb', p.blurb));
      const stt = el('div', 'op-cat-st');
      if (!st.loaded) stt.textContent = '…';
      else if (rec.length) {
        stt.textContent = recOn === rec.length ? 'Recomendados ✓' : `${recOn} de ${rec.length} recomendados`;
        stt.classList.toggle('ok', recOn === rec.length);
      } else stt.textContent = `${items.filter(x => x.d.on).length} de ${items.length} ligados`;
      txt.append(stt);
      c.append(ic, txt);
      return c;
    });
    box.replaceChildren(...cards);
  }

  function changed() { window.dispatchEvent(new Event('gdz-opt-change')); }

  // ── Páginas que exigem plano (mesmo mapa da referência) ──
  //
  // Copiado de src/plano.js da referência: cada página listada aqui exige uma feature na conta
  // do usuário. Páginas fora do mapa (desempenho, inputlag, memoria, limpeza, live, tweaks,
  // scaling) são livres para todo mundo.
  const PAGE_FEATURE = {
    dashboard: 'painel', jogos: 'jogos', fps: 'fps', gargalo: 'gargalo', hardware: 'hardware',
    pcinfo: 'hardware', inicializacao: 'inicializacao', sobre: 'sobre',
  };

  // Libera a página quando: a conta tem ['*'], ou tem a feature que a página pede.
  // Sem login e sem Supabase configurado, st.conta.semLogin é true e tudo é liberado.
  function allowed(page) {
    const ct = st.conta;
    if (!ct || ct.semLogin) return true;
    const fs2 = Array.isArray(ct.features) ? ct.features : [];
    if (fs2.includes('*')) return true;
    const need = PAGE_FEATURE[page];
    return !!need && fs2.includes(need);
  }


  // ── Bloqueio por PC (mesma regra e mesmos textos da referência) ──────────
  //
  // reason 'other_device' + pcBound true  -> o Windows é outro (formatou/trocou): oferece renovar
  // reason 'other_device' + pcBound false -> o plano está em outro PC: orienta falar no suporte
  function mostrarBloqueioDePc() {
    document.getElementById('vl-pc-block')?.remove();
    const ct = st.conta;
    if (!ct || ct.semLogin || ct.reason !== 'other_device') return false;

    const renovar = !!ct.pcBound;
    const titulo = renovar ? 'PC novo: renovar' : 'Plano em outro PC';
    const texto = renovar
      ? 'A sua Licença do PC ficou no Windows de antes. Ela vale até formatar: se você formatou ou trocou de PC, compre de novo pelo mesmo preço (ou passe para o vitalício, que continua depois de formatar) e ela vem para este PC.'
      : 'O seu plano pago está ligado a outro PC. Para usar aqui, fale com o suporte no Discord.';

    const d = document.createElement('div');
    d.id = 'vl-pc-block';
    d.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(5,3,8,.9);display:grid;place-items:center;backdrop-filter:blur(8px);padding:24px';

    const card = document.createElement('div');
    card.style.cssText = 'max-width:430px;width:100%;background:#120b18;border:1px solid rgba(255,31,46,.28);border-radius:18px;padding:30px;text-align:center';

    card.innerHTML =
      '<div style="width:52px;height:52px;margin:0 auto 18px;border-radius:14px;background:rgba(255,31,46,.12);display:grid;place-items:center">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ff3b47" stroke-width="2" stroke-linecap="round">' +
      '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg></div>' +
      '<div style="font-size:19px;font-weight:900;color:#f5f5f7;letter-spacing:-.02em;margin-bottom:12px">' + titulo + '</div>' +
      '<div style="font-size:13.5px;color:#a8a4b8;line-height:1.65;margin-bottom:22px">' + texto + '</div>' +
      '<button id="vl-pc-sair" style="width:100%;border:0;border-radius:11px;padding:13px;background:linear-gradient(135deg,#ff1f2e,#c00c1a);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit">Sair e entrar com outra conta</button>' +
      '<div style="font-size:11.5px;color:#5f5a73;margin-top:14px">PC atual: ' + (ct.nome || '') + (ct.maxDevices ? ' · limite de ' + ct.maxDevices + ' PC' + (ct.maxDevices > 1 ? 's' : '') : '') + '</div>';

    d.appendChild(card);
    document.body.appendChild(d);

    card.querySelector('#vl-pc-sair').onclick = async () => {
      try { await invoke('ir-para-login'); } catch (e) { location.reload(); }
    };
    return true;
  }

  // Aplica o cadeado no menu lateral, como a referência faz com .nav-locked
  function paintLocks() {
    document.querySelectorAll('.sidebar .nav-item').forEach((item) => {
      const oc = item.getAttribute('onclick') || '';
      const m = /go\('([^']+)'/.exec(oc);
      const page = m ? m[1] : null;
      const locked = !!page && !allowed(page);
      item.classList.toggle('nav-locked', locked);
      const tem = item.querySelector('.nav-lock');
      if (locked && !tem) {
        const l = el('span', 'nav-lock');
        l.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
        item.appendChild(l);
      } else if (!locked && tem) tem.remove();
    });
  }

  // Intercepta a navegação: página trancada mostra o aviso em vez de abrir.
  function ligarGuardaDeNavegacao() {
    const baseGo = window.go;
    if (typeof baseGo !== 'function' || baseGo.__vlGuarda) return;
    window.go = function (pg, e) {
      if (!allowed(pg)) { mostrarUpgrade(pg); return; }
      return baseGo(pg, e);
    };
    window.go.__vlGuarda = true;
  }

  function mostrarUpgrade(pg) {
    const nome = (PAGES.find(x => x.id === pg) || {}).name || 'Esta parte';
    const d = document.createElement('div');
    d.id = 'vl-upgrade';
    d.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(5,3,8,.82);display:grid;place-items:center;backdrop-filter:blur(6px)';
    d.innerHTML = '<div style="max-width:380px;background:#120b18;border:1px solid rgba(255,31,46,.25);border-radius:16px;padding:28px;text-align:center;font-family:inherit">' +
      '<div style="font-size:15px;font-weight:800;color:#f5f5f7;margin-bottom:8px">' + nome + ' faz parte do plano completo</div>' +
      '<div style="font-size:13px;color:#a8a4b8;line-height:1.55;margin-bottom:20px">Assine no site e entre com o mesmo e-mail e senha: o acesso é liberado na hora.</div>' +
      '<button id="vl-up-fechar" style="width:100%;border:0;border-radius:10px;padding:12px;background:linear-gradient(135deg,#ff1f2e,#c00c1a);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit">Entendi</button></div>';
    document.body.appendChild(d);
    d.querySelector('#vl-up-fechar').onclick = () => d.remove();
  }

  // ── API para o resto do app ──
  window.gdzOpt = {
    loaded: () => st.loaded,
    refresh: () => load(true),
    // Recomendados que valem para este PC, na ordem das páginas (anel do Painel).
    // Mantém o filtro por rec:true — é o critério original e o que dá a contagem correta. Contar
    // todos os itens inflava o número (48 em vez de 19) e não reflete o que o catálogo recomenda.
    recommended: () => PAGES.filter(p => !p.checksOnly).flatMap(p => pageItems(p)
      .filter(x => x.d.rec && !x.d.blocked).map(x => ({ key: x.it.key, page: p.id, title: x.d.title, on: !!x.d.on }))),
    // Leva para o primeiro recomendado que falta (ou para Desempenho).
    goPending() {
      const x = this.recommended().find(r => !r.on);
      if (!x) { goTo('desempenho'); return; }
      goTo(x.page, document.querySelector(`#opt-${x.page} .tw-row[data-key="${CSS.escape(x.key)}"]`));
    },
    rowFor: (key) => document.querySelector(`.tw-row[data-key="${CSS.escape(key)}"]`),
    pages: () => PAGES.map(p => ({ id: p.id, name: p.name, blurb: p.blurb, icon: p.icon })),
    // Índice da busca do topo: cada item que vale para este PC, com o estado atual.
    searchIndex() {
      if (!st.loaded) return [];
      return PAGES.flatMap(p => p.groups.flatMap(g => g.items.filter(it => !hidden(it)).map(it => {
        const d = it.kind === 'dns' ? DNS_INFO : info(it);
        if (!d || !d.title) return null;
        const state = d.blocked ? 'blocked'
          : isSwitch(it) ? (d.on ? 'on' : d.rec ? 'rec' : 'off')
          : it.kind === 'dns' ? (st.dns === 'auto' ? 'off' : 'on')
          : it.kind === 'check' ? 'check' : it.kind === 'tip' ? 'tip' : 'once';
        return { key: it.key, page: p.id, pageName: p.name, group: g.name, icon: g.icon, title: d.title, desc: d.desc || '',
          tags: d.tags || [], syn: SYN[it.key] || '', state };
      }).filter(Boolean)));
    },
    // Abre a página do item e destaca a linha. A busca da página Windows pode estar escondendo
    // a linha: nesse caso ela é limpa antes.
    reveal(page, key) {
      const show = () => {
        const p = PAGES.find(x => x.id === page);
        const row = document.querySelector(`#opt-${page} .tw-row[data-key="${CSS.escape(key)}"]`);
        if (p && p.search && row && row.classList.contains('is-hidden')) {
          st.queries[p.id] = '';
          const inp = $(`#opt-${p.id} .op-search input`);
          if (inp) inp.value = '';
          filter(p);
        }
        goTo(page, row);
      };
      if (st.loaded) show();
      else { goTo(page); load().then(show); }
    },
    // Roda uma verificação na página Verificar hardware (o resultado aparece lá).
    runCheck(name) {
      goTo('hardware');
      const b = document.querySelector(`#opt-hardware .tw-tool-btn[data-check="${CSS.escape(name)}"]`);
      if (!b) return;
      b.closest('.tw-row').scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCheckRow(b, name);
    },
  };

  // Lê tudo uma vez ao abrir o app (o anel do Painel precisa) e relê ao entrar numa página.
  const baseGo = window.go;
  window.go = function (pg, navEl) {
    baseGo(pg, navEl);
    if (PAGES.some(p => p.id === pg)) {
      if (!st.loaded) load();
      else if (Date.now() - st.lastLoad > 4000) load(true);
    }
  };
  renderOverview();
  setTimeout(() => load(), 400);
})();
