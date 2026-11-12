// ── Tutoriais do app ──

// Três tours, todos pelo botão "Tutorial" da barra de título:

//   - Primeiros passos: abre sozinho na primeira vez que o Painel aparece neste PC e mostra o que

//     fazer primeiro, na ordem em que vale a pena (medir o FPS, Otimização Rápida, recomendados, jogos);

//   - Tour desta página: o que dá para fazer na página aberta;

//   - Tour completo: todas as páginas, na ordem do menu, pulando por dentro as que estão com cadeado.

// Cada passo ilumina o lugar da tela de que fala. Nada por baixo recebe clique, então nenhum tour

// aplica nada no Windows. Dá para sair a qualquer momento (botão ou Esc).

// Quem viu os primeiros passos fica marcado em localStorage ('gdz-tour'). Enquanto um tour está

// aberto, o plano.js segura a pergunta das métricas e os avisos de plano (ele procura por #gdz-tour).

// Usa ipcRenderer, toast() e goTo() do dashboard e, se já carregou, window.gdzOpt.

// Página nova no app: acrescente uma entrada em PAGES, na posição em que ela aparece no menu.

(function () {

  const KEY = 'gdz-tour';

  const VERSION = '1'; // subir quando os primeiros passos mudarem a ponto de valer mostrar de novo

  const GAP = 14;      // distância entre o alvo e o cartão

  const EDGE = 12;     // margem mínima do cartão até a borda da janela

  const MAX_DOTS = 10; // tour maior que isso mostra "12 de 40" no lugar das bolinhas



  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const $ = (id) => document.getElementById(id);

  const q = (sel) => document.querySelector(sel);

  const qa = (sel) => [...document.querySelectorAll(sel)];

  const navItem = (pg) => qa('.sidebar .nav-item').find(n => (n.getAttribute('onclick') || '').includes(pg === 'scaling' ? 'openScalingWindow' : `'${pg}'`));

  const locked = (pg) => { const n = navItem(pg); return !!n && n.classList.contains('nav-locked'); }; // quem pinta o cadeado é o plano.js

  const activePage = () => { const p = q('.page.active'); return p ? p.id.replace(/^pg-/, '') : 'dashboard'; };



  let user = null;

  try { Promise.resolve(ipcRenderer.invoke('get-user')).then((u) => { user = u; }).catch(() => {}); } catch (e) {}

  const free = () => !!user && user.plan !== 'pro';



  // ── Passos que se repetem ──

  // target: o que iluminar (um elemento ou vários, que viram um retângulo só). Sem alvo na tela

  // (botão escondido, janela estreita, página que ainda não desenhou), o cartão vai para o centro.

  const SEARCH = {

    target: () => q('#gs-home .gs-box') || q('#gs-home .gs-icon'), side: 'bottom',

    title: 'Ache qualquer ajuste pela busca',

    text: 'Escreva o ajuste ou o problema, como "ping", "mouse" ou "tela", e a busca leva até a opção. Ctrl+K abre a busca em qualquer página.',

  };

  const REVERT = {

    target: () => $('restore-all-btn'), side: 'bottom',

    title: 'Tudo tem volta',

    text: () => 'Antes de mudar qualquer coisa, o app guarda como o Windows estava. Dá para desfazer um ajuste por vez no próprio interruptor, ou tudo de uma vez em "Reverter Tudo", '

      + (rectOf($('restore-all-btn')) ? 'aqui no topo do Painel.' : 'que aparece no topo do Painel depois da primeira otimização.'),

  };

  const recText = () => {

    const rec = window.gdzOpt && window.gdzOpt.loaded() ? window.gdzOpt.recommended() : [];

    const link = (($('dh-link-txt') || {}).textContent || 'Ver as otimizações').trim();

    return 'O mostrador conta quantos ajustes recomendados para o seu hardware já estão ligados no Windows'

      + (rec.length ? ` (agora, ${rec.filter(r => r.on).length} de ${rec.length})` : '')

      + `. O botão "${link}" leva ao próximo que falta. Cada ajuste diz o que faz e o que você perde, e tem interruptor para desligar.`

      + (free() ? ' No plano grátis, os ajustes avulsos aparecem com cadeado.' : '');

  };

  // Valem para toda página do catálogo de otimizações (otimizacoes.js). No tour completo aparecem

  // só na primeira dessas páginas, para não repetir a mesma explicação cinco vezes.

  const optSteps = (id) => [

    { common: true, target: () => q(`#opt-${id} .op-bar`), side: 'bottom',

      title: 'Recomendados de uma vez',

      text: 'O contador mostra quantos ajustes desta página estão ligados. O botão ao lado aplica, de uma vez, só os recomendados para o seu PC que ainda faltam.' },

    { common: true, target: () => q(`#opt-${id} .tw-row:not(.op-tip)`), side: 'bottom',

      title: 'Como ler um ajuste',

      text: 'O título já descreve o estado otimizado. Embaixo vem o que o ajuste faz, o que você perde e, quando precisa, o aviso de reiniciar. O interruptor liga e desliga: desligar deixa o Windows como estava. "Recomendado" marca os que valem para o seu hardware.' },

  ];

  const lastSec = (id) => qa(`#opt-${id} .tw-sec`).pop();



  // ── Primeiros passos ──

  // n: número do passo recomendado (os sem número são "bom saber").

  const INICIO = [

    {

      wide: true, logo: true,

      title: 'Bem-vindo ao VL Optimizer',

      text: 'Um tour de um minuto pelos primeiros passos recomendados, na ordem em que valem a pena. Nada é aplicado no seu PC durante o tutorial.',

      list: ['Medir o FPS antes de mexer', 'Rodar a Otimização Rápida', 'Ligar os recomendados para o seu PC', 'Ajustar os seus jogos'],

      back: 'Pular tutorial', backAct: 'skip', next: 'Começar',

    },

    {

      n: 1, target: () => navItem('fps'), side: 'right',

      title: 'Meça o FPS antes de mexer',

      text: 'Com o jogo aberto, grave o "Antes" no Medidor de FPS. Depois de otimizar, grave o "Depois" no mesmo lugar: a diferença é o ganho real no seu PC. Quem mede é o Windows, sem mexer no jogo, então é seguro com anti-cheat.',

    },

    {

      n: 2, target: () => q('#dh-hero .dh-cta'), side: 'bottom',

      title: 'Rode a Otimização Rápida',

      text: () => 'Um clique liga o básico: o plano de energia certo para o seu processador, Modo de Jogo, gravação em segundo plano desligada, aceleração do mouse desligada e limpeza dos arquivos temporários.'

        + (free() ? ' Está incluída no plano grátis.' : ''),

    },

    // o card inteiro: o texto fala do mostrador e do botão ao lado da Otimização Rápida

    { n: 3, target: () => $('dh-hero'), side: 'bottom', title: 'Ligue os recomendados para o seu PC', text: recText },

    {

      n: 4, target: () => navItem('jogos'), side: 'right',

      title: 'Ajuste os seus jogos',

      text: 'Em Meus jogos aparecem os jogos instalados, com limpeza de cache para cada um. No card do FiveM ficam os gráficos do GTA RP, ajustados direto no arquivo do FiveM e com backup.',

    },

    { kicker: 'Bom saber', ...REVERT },

    { kicker: 'Bom saber', ...SEARCH },

    {

      wide: true, pulse: true,

      title: 'Pronto, agora é com você',

      text: 'Comece pelo passo 1: abra o jogo e grave o seu "Antes". Em "Tutorial", no topo da janela, dá para rever estes passos, ver o tour da página aberta ou o tour completo do app.',

      back: 'Ficar no Painel', backAct: 'close', next: 'Abrir o Medidor de FPS', done: () => goTo('fps'),

    },

  ].map(s => ({ page: 'dashboard', ...s }));



  // ── Páginas, na ordem do menu lateral ──

  // about: a página em uma frase (é o passo que apresenta a página no tour completo).

  // steps: o tour da página. win: abre em janela própria, então não tem passos por dentro.

  const PAGES = [

    { id: 'dashboard', name: 'Painel',

      about: 'O resumo do seu PC: o que já está otimizado, o que falta e os atalhos para cada assunto.',

      steps: [

        { target: () => $('dh-hero'), side: 'bottom', title: 'Recomendados para o seu PC',

          text: () => recText() + ' A Otimização Rápida liga o básico com um clique.' },

        { target: () => $('hw-detect-card'), side: 'left', title: 'Seu hardware',

          text: 'Processador, placa de vídeo e memória detectados neste PC, com o uso de cada um agora. "Medir gargalo" mostra qual deles segura o FPS no jogo.' },

        { target: () => $('dh-cats'), side: 'top', title: 'Otimizações por assunto',

          text: 'Cada cartão abre uma página de ajustes e mostra quantos recomendados já estão ligados nela.' },

        { target: () => { const l = $('rec-list'); return l && l.closest('.icard'); }, side: 'top', title: 'Recomendações',

          text: 'O que o app encontrou no seu PC agora, como programas abrindo junto com o Windows ou arquivos temporários para limpar. Clique numa linha para ir direto ao lugar.' },

        SEARCH,

        REVERT,

      ] },

    { id: 'desempenho', name: 'Desempenho',

      about: 'Os ajustes do Windows que mais pesam no FPS: plano de energia, Modo de Jogo, placa de vídeo e o que roda por trás do jogo.',

      steps: [

        ...optSteps('desempenho'),

        { target: () => q('#opt-desempenho .tw-sec.op-warn .tw-sec-hdr'), side: 'bottom', title: 'Para PC fraco',

          text: 'Este grupo tira recursos do Windows para sobrar processador, memória e disco. Cada ajuste avisa o que você perde: ligue só o que fizer sentido para você.' },

        { target: () => lastSec('desempenho'), side: 'top', title: 'Antes de jogar',

          text: 'Ações de uma vez, sem interruptor: valem até você reabrir os programas ou reiniciar o PC.' },

      ] },

    { id: 'inputlag', name: 'Mouse e teclado',

      about: 'Mira consistente e nenhuma janela abrindo no meio da partida.',

      steps: [

        ...optSteps('inputlag'),

        { target: () => q('#pg-inputlag .mt-card'), side: 'top', title: 'Teste o mouse',

          text: 'Mexa o mouse dentro da área por 5 segundos e veja a taxa de polling real dele. Os resultados ficam guardados para comparar depois de trocar a porta USB ou a configuração no software do mouse.' },

      ] },

    { id: 'memoria', name: 'Memória',

      about: 'Uso de RAM, limpeza do cache da memória e memória virtual.',

      steps: [

        { target: () => q('#pg-memoria .ram-card'), side: 'bottom', title: 'Limpar cache da RAM',

          text: 'Esvazia a lista de espera do Windows, como o ISLC. Ajuda quando a memória livre acaba e o jogo engasga, e não fecha nada. Dá para limpar na hora ou deixar no automático.' },

        ...optSteps('memoria'),

      ] },

    { id: 'limpeza', name: 'Limpeza',

      about: 'Cache de navegadores e apps, temporários, relatórios de erro e o que ocupa cada disco.',

      steps: [

        { target: () => q('#pg-limpeza .lp-card'), side: 'bottom', title: 'Limpeza de arquivos',

          text: 'O L mostra quanto cada item ocupa antes de apagar. Dos navegadores sai só o cache: logins, senhas e histórico ficam. App aberto não é limpo: feche e analise de novo.' },

        { target: () => qa('#pg-limpeza .lp-card')[1], side: 'top', title: 'O que ocupa o disco',

          text: 'Lê o disco inteiro e mostra as pastas e os arquivos maiores. Clique numa pasta para entrar nela. Só lê: para apagar algo, abra no Explorer.' },

      ] },

    { id: 'programas', name: 'Programas',

      about: 'Desinstale programas e apague o que o desinstalador deixa para trás.',

      steps: [

        { target: () => q('#pr-list .pr-row'), side: 'bottom', title: 'Desinstalar sem deixar sobra',

          text: 'O L abre o desinstalador do próprio programa. Quando ele termina, procura pastas e chaves do registro que ficaram e mostra a lista antes de apagar.' },

      ] },

    { id: 'live', name: 'Internet e live',

      about: 'DNS, upload livre para o jogo e a live, OBS e correções de rede.',

      steps: [

        ...optSteps('live'),

        { target: () => { const s = qa('#opt-live .tw-sec')[1]; return s && s.querySelector('.tw-sec-hdr'); }, side: 'bottom', title: 'Live e gravação',

          text: 'Para quem transmite ou grava: o OBS com prioridade acaba com o "lag de codificação". A gravação em segundo plano do Windows fica em Desempenho.' },

      ] },

    { id: 'tweaks', name: 'Windows',

      about: 'Privacidade, praticidade e reparos do Windows. Quase nada aqui muda o FPS.',

      steps: [

        optSteps('tweaks')[0],

        { target: () => q('#opt-tweaks .op-search'), side: 'bottom', title: 'Filtre a lista',

          text: 'Esta é a página com mais ajustes: escreva uma palavra para mostrar só os que têm a ver.' },

        optSteps('tweaks')[1],

        { target: () => { const s = lastSec('tweaks'); return s && s.querySelector('.tw-sec-hdr'); }, side: 'top', title: 'Manutenção e reparo',

          text: 'Consertos de uma vez, que rodam em segundo plano. É aqui que fica "Criar ponto", para ter um ponto de restauração do Windows antes de mexer.' },

      ] },

    { id: 'inicializacao', name: 'Inicialização',

      about: 'Os programas que abrem junto com o Windows.',

      steps: [

        { target: () => q('#startup-list .startup-item'), side: 'bottom', title: 'Desligue o que abre sozinho',

          text: 'Cada linha é um programa que abre junto com o Windows. Desligar só impede de abrir sozinho: o programa continua instalado e abre normalmente quando você quiser.' },

      ] },

    { id: 'jogos', name: 'Meus jogos',

      about: 'Seus jogos instalados, com perfil, limpeza de cache e os ajustes do GTA RP (FiveM).',

      steps: [

        { target: () => q('#pg-jogos .auto-card'), side: 'bottom', title: 'Modo automático',

          text: 'Ligado, o app prepara o PC sozinho quando um dos seus jogos abre (navegador e Discord com prioridade baixa, sincronização de nuvem fechada, plano de energia de desempenho) e desfaz quando o jogo fecha.' },

        { target: () => q('#pg-jogos .content .run-btn') && q('#pg-jogos .content .run-btn').parentElement, side: 'bottom', title: 'Procurar de novo e shaders',

          text: 'Instalou um jogo e ele não apareceu? "Procurar de novo". "Limpar cache de shaders" resolve travadas depois de atualizar o driver de vídeo.' },

        { target: () => qa('#games-grid .game-card').find(c => /fivem/i.test(c.textContent)) || q('#games-grid .game-card'), side: 'right', title: 'Um cartão por jogo',

          text: '"Aplicar perfil" ativa o plano de energia, o Modo de Jogo e desliga a gravação em segundo plano. "Limpar cache" apaga o cache daquele jogo. No FiveM, "Gráficos do GTA RP" abre os ajustes do GTA.' },

        { target: () => q('#gta-card-inner .fpm-card-hdr'), side: 'bottom', title: 'GTA RP (FiveM)',

          text: 'Gráficos do GTA ajustados direto no arquivo do FiveM, com backup para voltar. Nenhuma opção mexe dentro do jogo: sem risco de ban.' },

      ] },

    { id: 'opti', name: 'DLSS / FSR',

      about: 'Troca o upscaler dos jogos (DLSS, FSR, XeSS) com o OptiScaler.',

      steps: [

        { target: () => q('#opx-root .fpm-card'), side: 'bottom', title: 'O upscaler que você quiser',

          text: 'O OptiScaler fica entre o jogo e o upscaler e troca um pelo outro. Instala com backup e sai com um clique. Nunca use em jogo online com anti-cheat (Valorant, CS2, Fortnite, FiveM, Warzone).' },

        { target: () => q('#opx-root .opx-actions'), side: 'bottom', title: 'Adicionar um jogo',

          text: 'Com o jogo aberto, "Detectar jogo aberto" acha ele sozinho. Se preferir, escolha o .exe do jogo.' },

      ] },

    { id: 'scaling', name: 'VL Scaling', win: true,

      about: 'Frame Generation e upscaling em qualquer jogo. Abre numa janela própria.' },

    { id: 'fps', name: 'Medidor de FPS',

      about: 'O FPS real do jogo, um contador na tela e a comparação de antes e depois.',

      steps: [

        { target: () => q('#fpm-root .fpm-grid .fpm-card'), side: 'right', title: 'FPS ao vivo',

          text: 'Abra um jogo e ele aparece aqui sozinho em poucos segundos, com FPS, frametime e 1% low. Quem mede é o Windows (PresentMon), sem mexer no jogo: seguro com anti-cheat.' },

        { target: () => q('#fpm-root .fpm-grid .fpm-card:nth-child(2)'), side: 'left', title: 'FPS na tela',

          text: 'Um contador pequeno por cima do jogo, que não recebe clique nem tira o foco. Aparece com o jogo em janela ou em tela cheia sem bordas.' },

        { target: () => q('#fpm-root > .fpm-card'), side: 'top', title: 'Comparar antes e depois',

          text: 'Grave o mesmo trecho do jogo duas vezes, antes e depois de otimizar, e veja o ganho real.' },

      ] },

    { id: 'gargalo', name: 'Gargalo do PC',

      about: 'Descobre, com o jogo aberto, qual peça está segurando o seu FPS.',

      steps: [

        { target: () => q('#pg-gargalo .hw-row'), side: 'bottom', title: 'As peças do seu PC',

          text: 'Processador, placa de vídeo e memória detectados neste PC.' },

        { target: () => $('btn-medir-gargalo'), side: 'bottom', title: 'Meça com o jogo aberto',

          text: 'Clique em Medir Gargalo, abra o jogo e jogue 40 segundos. No fim aparece qual peça chegou no limite e o que fazer a respeito.' },

      ] },

    { id: 'pcinfo', name: 'Informações do PC',

      about: 'A ficha das peças deste PC e os sensores ao vivo. Só lê: não muda nada.',

      steps: [

        { target: () => $('pci-mode'), side: 'bottom', title: 'Simples ou Avançado',

          text: 'Simples mostra um cartão por peça, com o uso e a temperatura de agora. Avançado abre a ficha completa em abas e a tabela de sensores com mínimo e máximo.' },

        { target: () => q('#pci-root .pci-card'), side: 'right', title: 'Uma peça por cartão',

          text: 'Processador, placa de vídeo, memória, discos, placa-mãe, telas e Windows. Os números se atualizam sozinhos enquanto a página está aberta.' },

        { target: () => $('pci-copy'), side: 'bottom', title: 'Relatório para o suporte',

          text: 'Copia a ficha inteira em texto. É só colar no Discord quando pedirem a configuração do seu PC.' },

      ] },

    { id: 'hardware', name: 'Verificar hardware',

      about: 'Confere driver, BIOS e memória. Só lê: não muda nada no PC.',

      steps: [

        { target: () => $('hw-summary'), side: 'bottom', title: 'O que foi detectado',

          text: 'Processador, placas de vídeo e versão do Windows deste PC.' },

        { target: () => q('#opt-hardware .tw-row'), side: 'bottom', title: 'Uma verificação por linha',

          text: 'Clique em "Verificar" e a linha diz o que encontrou e o que fazer, como um driver desatualizado ou a memória fora da velocidade do kit. Nada aqui altera o PC.' },

      ] },

    { id: 'sobre', name: 'Sobre',

      about: 'Versão do app, redes do VL, o seu plano e as preferências.',

      steps: [

        { target: () => q('#pg-sobre .about-hero'), side: 'bottom', title: 'Versão e comunidade',

          text: 'A versão instalada e as preferências do app: iniciar com o Windows, métricas e efeitos.' },

        { target: () => qa('#pg-sobre .about-pref'), side: 'top', title: 'Preferências',

          text: 'O que é seu para decidir, como o envio das métricas de FPS. Dá para mudar quando quiser.' },

      ] },

  ];

  const pageDef = (id) => PAGES.find(p => p.id === id);



  function pageTour(id) {

    const p = pageDef(id);

    return p && p.steps ? p.steps.map(s => ({ ...s, page: id, kicker: p.name })) : [];

  }

  function fullTour() {

    const steps = [];

    let commonDone = false;

    for (const p of PAGES) {

      const lock = locked(p.id);

      const inside = !lock && !p.win;

      // apresenta a página apontando para ela no menu; com cadeado ou em janela própria, fica nisso

      steps.push({ page: inside ? p.id : null, kicker: p.name, target: () => navItem(p.id), side: 'right',

        title: p.name, text: p.about + (lock ? ' Faz parte do plano pago.' : '') });

      if (!inside) continue;

      const own = p.steps.filter(s => !(s.common && commonDone));

      if (p.steps.some(s => s.common)) commonDone = true;

      own.forEach(s => steps.push({ ...s, page: p.id, kicker: p.name }));

    }

    return [

      { wide: true, logo: true, title: 'Tour completo',

        text: `Todas as páginas do app, na ordem do menu, com o que dá para fazer em cada uma. São ${steps.length} passos e dá para sair quando quiser com Esc. Nada é aplicado no seu PC.`,

        back: 'Agora não', backAct: 'close', next: 'Começar' },

      ...steps,

      { wide: true, pulse: true, title: 'Você viu o app inteiro',

        text: 'Para rever só uma parte, abra a página e escolha "Tour desta página" em Tutorial, no topo da janela.',

        back: 'Ficar aqui', backAct: 'close', next: 'Voltar ao Painel', done: () => goTo('dashboard') },

    ];

  }



  // ── Montagem ──

  let root = null, spot, card, kicker, skip, logo, title, text, list, dots, count, backBtn, nextBtn;

  let steps = [], kind = null, auto = false;

  let idx = 0, watch = null, lastFocus = null, scrolledFor = -1;



  function build() {

    root = el('div', 'tour first');

    root.id = 'gdz-tour';

    spot = el('div', 'tour-spot');

    card = el('div', 'tour-card');

    card.setAttribute('role', 'dialog');

    card.setAttribute('aria-modal', 'true');

    card.setAttribute('aria-labelledby', 'tour-title');

    card.setAttribute('aria-describedby', 'tour-text');



    const top = el('div', 'tour-top');

    kicker = el('span', 'tour-kicker');

    skip = el('button', 'tour-skip', kind === 'inicio' ? 'Pular tutorial' : 'Fechar tour');

    skip.type = 'button';

    skip.onclick = () => close(true);

    top.append(kicker, skip);



    logo = el('img', 'tour-logo');

    logo.src = 'logo.png'; logo.alt = ''; logo.draggable = false;

    title = el('div', 'tour-title'); title.id = 'tour-title';

    text = el('p', 'tour-text'); text.id = 'tour-text';

    list = el('ol', 'tour-list');



    const foot = el('div', 'tour-foot');

    dots = el('div', 'tour-dots');

    dots.setAttribute('aria-hidden', 'true');

    if (steps.length <= MAX_DOTS) steps.forEach(() => dots.append(el('i')));

    count = el('span', 'tour-count');

    const btns = el('div', 'tour-btns');

    backBtn = el('button', 'ghost-btn');

    backBtn.type = 'button';

    backBtn.dataset.som = 'passo';

    backBtn.onclick = () => { const a = steps[idx].backAct; if (a === 'skip') close(true); else if (a === 'close') close(); else show(idx - 1); };

    nextBtn = el('button', 'qo-btn');

    nextBtn.type = 'button';

    nextBtn.onclick = () => {

      if (idx < steps.length - 1) { show(idx + 1); return; }

      const done = steps[idx].done;

      close();

      if (done) done();

    };

    btns.append(backBtn, nextBtn);

    foot.append(dots, count, btns);



    card.append(top, logo, title, text, list, foot);

    root.append(spot, card);

    document.body.append(root);

  }



  // ── Posição ──

  // Retângulo do alvo (ou o que envolve todos, se vierem vários); null se nada está na tela

  // (display none, página escondida).

  function rectOf(t) {

    const rs = (Array.isArray(t) ? t : [t]).filter(e => e && e.isConnected).map(e => e.getBoundingClientRect()).filter(r => r.width > 1 && r.height > 1);

    if (!rs.length) return null;

    const left = Math.min(...rs.map(r => r.left)), top = Math.min(...rs.map(r => r.top));

    const right = Math.max(...rs.map(r => r.right)), bottom = Math.max(...rs.map(r => r.bottom));

    return { left, top, right, bottom, width: right - left, height: bottom - top };

  }



  function place() {

    if (!root) return;

    const s = steps[idx];

    const bar = q('.titlebar');

    // a barra de título fica de fora: dá para arrastar, minimizar e fechar a janela no meio do tour

    root.style.top = (bar ? Math.round(bar.getBoundingClientRect().bottom) : 0) + 'px';

    const area = root.getBoundingClientRect();

    const cw = card.offsetWidth, ch = card.offsetHeight;

    const target = s.target && s.target();

    let t = rectOf(target);

    // o alvo pode estar fora da rolagem, ou só aparecer depois que a página termina de desenhar

    if (t && scrolledFor !== idx) {

      scrolledFor = idx;

      if (t.top < area.top + 8 || t.bottom > area.bottom - 8) {

        const first = Array.isArray(target) ? target.find(e => e && e.isConnected) : target;

        first.scrollIntoView({ block: t.height > area.height * 0.6 ? 'start' : 'center' });

        t = rectOf(target);

      }

    }

    let x, y;

    if (!t) {

      x = (area.width - cw) / 2;

      y = (area.height - ch) / 2;

      // sem alvo, o "furo" encolhe para trás do cartão e a sombra escurece a tela inteira

      spot.classList.add('none');

      Object.assign(spot.style, { left: area.width / 2 - 1 + 'px', top: area.height / 2 - 1 + 'px', width: '2px', height: '2px' });

    } else {

      const pad = 6;

      // o furo não passa da área do tour, mesmo com alvo maior que a janela

      const l = Math.max(4, t.left - area.left - pad), tp = Math.max(4, t.top - area.top - pad);

      const h = { l, t: tp, w: Math.min(area.width - 4, t.right - area.left + pad) - l, h: Math.min(area.height - 4, t.bottom - area.top + pad) - tp };

      spot.classList.remove('none');

      Object.assign(spot.style, { left: h.l + 'px', top: h.t + 'px', width: h.w + 'px', height: h.h + 'px' });

      // o lado pedido pelo passo, se couber; senão o primeiro em que o cartão cabe

      const room = { right: area.width - (h.l + h.w) - GAP - EDGE, bottom: area.height - (h.t + h.h) - GAP - EDGE, left: h.l - GAP - EDGE, top: h.t - GAP - EDGE };

      const fits = (side) => (side === 'left' || side === 'right' ? room[side] >= cw : room[side] >= ch);

      const side = [s.side, 'bottom', 'right', 'left', 'top'].find(fits);

      if (side === 'right' || side === 'left') {

        x = side === 'right' ? h.l + h.w + GAP : h.l - GAP - cw;

        y = h.t + h.h / 2 - ch / 2;

      } else if (side) {

        x = h.l + h.w / 2 - cw / 2;

        y = side === 'bottom' ? h.t + h.h + GAP : h.t - GAP - ch;

      } else { // não cabe em lado nenhum: o cartão fica no canto de baixo, por cima do alvo

        x = area.width - cw - EDGE;

        y = area.height - ch - EDGE;

      }

    }

    x = Math.max(EDGE, Math.min(x, area.width - cw - EDGE));

    y = Math.max(EDGE, Math.min(y, area.height - ch - EDGE));

    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

  }



  // ── Passo a passo ──

  function show(i) {

    if (!root || i < 0 || i >= steps.length) return;

    idx = i;

    const s = steps[i];

    const last = i === steps.length - 1;

    if (s.page && activePage() !== s.page) goTo(s.page);

    card.classList.toggle('wide', !!s.wide);

    kicker.textContent = s.n ? `Passo ${s.n} de ${steps.filter(x => x.n).length}` : s.kicker || '';

    kicker.hidden = !kicker.textContent;

    logo.hidden = !s.logo;

    title.textContent = s.title;

    text.textContent = typeof s.text === 'function' ? s.text() : s.text;

    list.replaceChildren(...(s.list || []).map(t => el('li', null, t)));

    list.hidden = !s.list;

    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));

    dots.hidden = !dots.childElementCount;

    count.textContent = `${i + 1} de ${steps.length}`;

    count.hidden = !!dots.childElementCount;

    backBtn.textContent = s.back || 'Voltar';

    backBtn.hidden = i === 0 && !s.back;

    nextBtn.textContent = s.next || (last ? 'Concluir' : 'Próximo');

    nextBtn.dataset.som = last ? 'certo' : 'passo';

    help && help.classList.toggle('pulse', !!s.pulse);

    place();

    nextBtn.focus({ preventScroll: true });

  }



  // capture: roda antes dos atalhos do app (o Ctrl+K da busca abriria por baixo do tour)

  function onKey(e) {

    if (!root) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); return; }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }

    else if (e.key === 'ArrowRight') show(idx + 1);

    else if (e.key === 'ArrowLeft') show(idx - 1);

    else if (e.key === 'Tab') { // o foco não sai do cartão

      const f = [...card.querySelectorAll('button:not([hidden])')];

      const at = f.indexOf(document.activeElement);

      e.preventDefault();

      f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();

    }

  }



  // which: 'inicio' (primeiros passos), 'pagina' (a página aberta) ou 'completo'.

  function start(which, opts) {

    if (root) return;

    closeMenu();

    const list = which === 'completo' ? fullTour() : which === 'pagina' ? pageTour(activePage()) : INICIO;

    if (!list.length) return;

    steps = list;

    kind = which === 'completo' || which === 'pagina' ? which : 'inicio';

    auto = !!(opts && opts.auto);

    scrolledFor = -1;

    lastFocus = document.activeElement;

    build();

    show(0);

    // o primeiro quadro entra sem deslizar; daí em diante o furo e o cartão andam até o próximo alvo

    requestAnimationFrame(() => requestAnimationFrame(() => root && root.classList.remove('first')));

    document.addEventListener('keydown', onKey, true);

    window.addEventListener('resize', place);

    // as páginas ainda se acomodam depois de abrir (hardware, lista de ajustes, jogos): o furo acompanha o alvo

    watch = setInterval(place, 300);

  }



  function close(skipped) {

    if (!root) return;

    clearInterval(watch);

    document.removeEventListener('keydown', onKey, true);

    window.removeEventListener('resize', place);

    root.remove();

    root = null;

    help && help.classList.remove('pulse');

    if (kind === 'inicio') { try { localStorage.setItem(KEY, VERSION); } catch (e) {} }

    if (lastFocus && lastFocus.isConnected && lastFocus.focus) lastFocus.focus({ preventScroll: true });

    // quem pulou o tour que abriu sozinho ainda não sabe onde ele mora

    if (skipped && auto) toast('Tutorial fechado. Para rever, clique em Tutorial no topo da janela.');

  }



  // ── Botão "Tutorial" na barra de título, com o menu dos três tours ──

  const barra = q('.titlebar .tb-ctrl, .titlebar .tb-controls');

  let help = null, menu = null;



  function closeMenu() {

    if (!menu) return;

    menu.remove();

    menu = null;

    help.setAttribute('aria-expanded', 'false');

    document.removeEventListener('mousedown', menuOutside, true);

    document.removeEventListener('keydown', menuKey, true);

    window.removeEventListener('blur', closeMenu);

    window.removeEventListener('resize', closeMenu);

  }

  function menuOutside(e) { if (!menu.contains(e.target) && !help.contains(e.target)) closeMenu(); }

  function menuKey(e) {

    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); help.focus(); return; }

    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    e.preventDefault();

    const f = [...menu.querySelectorAll('button:not(:disabled)')];

    const at = f.indexOf(document.activeElement);

    f[(at + (e.key === 'ArrowDown' ? 1 : -1) + f.length) % f.length].focus();

  }

  function openMenu() {

    if (menu || root) return;

    const here = pageDef(activePage());

    const hasPage = !!(here && here.steps && here.steps.length);

    menu = el('div', 'tour-menu');

    menu.setAttribute('role', 'menu');

    const item = (which, name, desc, off) => {

      const b = el('button', 'tour-menu-item');

      b.type = 'button';

      b.setAttribute('role', 'menuitem');

      b.disabled = !!off;

      b.append(el('b', null, name), el('span', null, desc));

      b.onclick = () => start(which);

      return b;

    };

    menu.append(

      item('inicio', 'Primeiros passos', 'O que fazer primeiro, em um minuto'),

      item('pagina', 'Tour desta página', hasPage ? `O que dá para fazer em ${here.name}` : 'Esta página não tem tour', !hasPage),

      item('completo', 'Tour completo', 'Todas as páginas do app, uma por uma'),

    );

    const r = help.getBoundingClientRect();

    menu.style.top = Math.round(r.bottom + 6) + 'px';

    menu.style.right = Math.max(8, Math.round(document.documentElement.clientWidth - r.right)) + 'px';

    document.body.append(menu);

    help.setAttribute('aria-expanded', 'true');

    document.addEventListener('mousedown', menuOutside, true);

    document.addEventListener('keydown', menuKey, true);

    window.addEventListener('blur', closeMenu);

    window.addEventListener('resize', closeMenu);

    menu.querySelector('button').focus();

  }



  if (barra) {

    help = el('button', 'wc-btn tour-btn');

    help.title = 'Tutoriais do app';

    help.setAttribute('aria-haspopup', 'menu');

    help.setAttribute('aria-expanded', 'false');

    help.style.webkitAppRegion = 'no-drag';

    help.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 015.4 1c0 1.9-2.7 2.3-2.7 4"/><path d="M12 17.3v.2"/></svg><span>Tutorial</span>';

    help.addEventListener('click', () => (menu ? closeMenu() : openMenu()));

    barra.prepend(help);

  }



  // ── Primeira vez ──

  // Se o localStorage falhar, conta como visto: melhor não mostrar do que mostrar toda vez.

  const seen = () => { try { return localStorage.getItem(KEY) === VERSION; } catch (e) { return true; } };

  function autoStart(tries) {

    if (seen() || root) return;

    // o app pode abrir minimizado junto com o Windows: o tour espera a janela aparecer

    if (document.hidden) { document.addEventListener('visibilitychange', () => autoStart(0), { once: true }); return; }

    // outro aviso na tela, ou a pessoa já saiu do Painel: espera um pouco e desiste até a próxima abertura

    const busy = $('plan-upsell') || $('telemetry-consent') || menu || activePage() !== 'dashboard';

    if (busy) { if (tries < 40) setTimeout(() => autoStart(tries + 1), 1500); return; }

    start('inicio', { auto: true });

  }

  // depois da animação de entrada do Painel e antes da pergunta das métricas (4 s, no plano.js)

  setTimeout(() => autoStart(0), 1200);



  window.gdzTour = { start, open: () => !!root };

})();

