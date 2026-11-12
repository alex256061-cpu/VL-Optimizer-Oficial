// Sons da interface. Tudo é sintetizado na hora (Web Audio): não há arquivo de áudio.
// Um ouvinte só, no documento, escolhe o som pelo tipo do elemento clicado, então tela nova
// já sai com som sem ninguém ligar nada. Para forçar um som num elemento use data-som="nome";
// data-som="nada" deixa mudo. De fora: gdzSons.tocar('certo').
(function () {
  const KEY = 'gdz-sons';
  let ligado = true;
  try { ligado = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

  // ── Motor ──
  let ctx = null, master = null, ruido = null, dormir = null;
  let gesto = false; // o Chromium só libera áudio depois de um clique ou tecla
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      // meio segundo de ruído branco, de onde sai o "estalo" de cada clique
      ruido = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
      const d = ruido.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    // Sem som por um tempo, solta a saída de áudio do Windows; o próximo clique acorda de novo.
    clearTimeout(dormir);
    dormir = setTimeout(() => { if (ctx.state === 'running') ctx.suspend(); }, 15000);
    return ctx;
  }

  // Uma nota: vai de f0 a f1 enquanto o volume cai até sumir.
  function nota(t, { tipo = 'sine', f0, f1 = f0, dur, vol, ataque = 0.004 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  // Um sopro curto de ruído filtrado: é o que dá o "tec" de botão físico.
  function estalo(t, { freq, dur, vol }) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = ruido;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.4, dur + 0.02);
  }

  // k é uma variação pequena de altura: o mesmo botão nunca soa idêntico duas vezes.
  const SONS = {
    toque(t, k) { nota(t, { f0: 940 * k, f1: 560 * k, dur: 0.07, vol: 0.16 }); estalo(t, { freq: 3400, dur: 0.016, vol: 0.05 }); },
    forte(t, k) {
      nota(t, { f0: 330 * k, f1: 150 * k, dur: 0.13, vol: 0.26 });
      nota(t, { tipo: 'triangle', f0: 990 * k, f1: 620 * k, dur: 0.06, vol: 0.07 });
      estalo(t, { freq: 2600, dur: 0.02, vol: 0.06 });
    },
    aba(t, k) { nota(t, { f0: 640 * k, f1: 430 * k, dur: 0.09, vol: 0.15 }); nota(t, { f0: 1280 * k, f1: 860 * k, dur: 0.05, vol: 0.035 }); },
    passo(t, k) { nota(t, { f0: 1500 * k, f1: 1150 * k, dur: 0.035, vol: 0.07 }); estalo(t, { freq: 4200, dur: 0.01, vol: 0.03 }); },
    liga(t) { nota(t, { tipo: 'triangle', f0: 523.25, dur: 0.07, vol: 0.13 }); nota(t + 0.06, { tipo: 'triangle', f0: 783.99, dur: 0.14, vol: 0.14 }); },
    desliga(t) { nota(t, { tipo: 'triangle', f0: 587.33, dur: 0.07, vol: 0.12 }); nota(t + 0.06, { tipo: 'triangle', f0: 392, dur: 0.13, vol: 0.12 }); },
    abre(t) { nota(t, { f0: 340, f1: 680, dur: 0.14, vol: 0.11, ataque: 0.02 }); },
    fecha(t) { nota(t, { f0: 600, f1: 300, dur: 0.12, vol: 0.1, ataque: 0.01 }); },
    certo(t) { [659.25, 987.77, 1318.51].forEach((f, i) => nota(t + i * 0.075, { tipo: 'triangle', f0: f, dur: 0.24, vol: 0.12 })); },
    aviso(t) { nota(t, { tipo: 'triangle', f0: 740, dur: 0.2, vol: 0.11, ataque: 0.008 }); },
    erro(t) { [0, 0.11].forEach((d) => { nota(t + d, { tipo: 'triangle', f0: 196, f1: 150, dur: 0.12, vol: 0.2 }); nota(t + d, { tipo: 'square', f0: 98, f1: 75, dur: 0.1, vol: 0.03 }); }); },
  };

  const ultimo = {};
  function tocar(nome, k) {
    const som = SONS[nome];
    if (!som || !ligado || !gesto || document.hidden) return;
    const agora = performance.now();
    if (agora - (ultimo[nome] || 0) < 40) return; // vários de uma vez (ex.: Otimização Rápida) viram um som só
    if (!audio()) return;
    ultimo[nome] = agora;
    som(ctx.currentTime + 0.004, k || 1 + (Math.random() - 0.5) * 0.06);
  }

  // ── Qual som para qual elemento ──
  const ESTADO = '.toggle, .tw-switch, [role="switch"]';
  const TIPOS = [
    ['nada', '.wc-min, .wc-max, .wc-close'], // controles da janela ficam como os do Windows
    ['aba', '.nav-item, .tab, .op-cat, [role="tab"]'],
    ['passo', '.gta-seg button, .fpm-pos button, .tw-dns-opt, .plan-opt, .opx-opt'],
    ['forte', '.dh-cta, .qo-btn, .btn-main, .game-opt-btn, .run-btn'],
    ['toque', 'button, a[href], [role="button"], [onclick], .icon-btn, summary'],
  ];
  const CLICAVEL = '[data-som], ' + ESTADO + ', ' + TIPOS.map((x) => x[1]).join(', ');

  // Aquecer no apertar: quando o clique chega (ao soltar) a saída de áudio já está acordada.
  const acordar = () => { gesto = true; if (ligado) audio(); };
  document.addEventListener('pointerdown', acordar, true);
  document.addEventListener('keydown', acordar, true);

  // Interruptor: o "tec" sai no clique e o tom de ligado/desligado só quando ele vira na tela.
  // O clique pode parar no aviso de plano e não virar nada; se a ação falhar depois, o
  // interruptor volta calado e quem fala é o som de erro do aviso.
  let pendentes = [];
  let estadoEm = 0;
  document.addEventListener('click', (e) => {
    const alvo = e.target.closest && e.target.closest(CLICAVEL);
    if (!alvo || alvo.disabled || alvo.getAttribute('aria-disabled') === 'true') return;
    if (alvo.dataset.som) { pendentes = []; tocar(alvo.dataset.som); return; }
    if (alvo.matches(ESTADO)) { pendentes.push(performance.now() + 8000); tocar('passo'); return; }
    pendentes = [];
    const tipo = TIPOS.find((x) => alvo.matches(x[1]));
    if (tipo) tocar(tipo[0]);
  }, true);

  const estaLigado = (el, attr, valor) => (attr === 'class' ? /(^|\s)on(\s|$)/.test(valor || '') : valor === 'true');
  new MutationObserver((recs) => {
    let som = null;
    for (const r of recs) {
      const el = r.target;
      if (!el.matches(ESTADO)) continue;
      const antes = estaLigado(el, r.attributeName, r.oldValue);
      const depois = estaLigado(el, r.attributeName, el.getAttribute(r.attributeName));
      if (antes !== depois) som = depois || som === 'liga' ? 'liga' : 'desliga';
    }
    if (!som) return;
    const agora = performance.now();
    pendentes = pendentes.filter((ate) => ate > agora);
    if (!pendentes.length) return; // mudou sozinho (leitura do Windows, outra tela): sem som
    pendentes.shift();
    estadoEm = agora;
    tocar(som);
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked'], attributeOldValue: true });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[type="checkbox"]')) tocar(el.checked ? 'liga' : 'desliga');
    else if (el.matches('select, input[type="radio"]')) tocar('passo');
  }, true);

  // Barra deslizante: um "tec" por passo, mais agudo conforme sobe.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches('input[type="range"]')) return;
    const min = Number(el.min) || 0, max = Number(el.max) || 100;
    tocar('passo', 0.8 + 0.5 * ((Number(el.value) - min) / (max - min || 1)));
  }, true);

  // Janela de aviso (plano, consentimento) que entra ou sai da tela.
  new MutationObserver((recs) => {
    const temDialogo = (n) => n.nodeType === 1 && (n.matches('[role="dialog"]') || !!n.querySelector('[role="dialog"]'));
    for (const r of recs) {
      if ([...r.addedNodes].some(temDialogo)) tocar('abre');
      else if ([...r.removedNodes].some(temDialogo)) tocar('fecha');
    }
  }).observe(document.body, { childList: true });

  // Aviso no rodapé: o som acompanha o resultado. Mensagem que não dá para classificar com
  // certeza (texto de erro vindo do Windows) fica com o som neutro.
  const RUIM = /falh|não foi possível|não encerrou|\berro\b|⚠|protegid|inválid|faz parte do plano/i;
  const BOM = /✓|sucesso|conclu[ií]d|ligad|aplicad|restaurad|limp[oa]|liberad|resgatad|copiad|instalad|atualizad|removid|encerrad|revertid|iniciad|marcada|grava|obrigado|vai abrir|dns:/i;
  const toastOrig = window.toast;
  if (typeof toastOrig === 'function') {
    window.toast = function (msg) {
      const texto = String(msg == null ? '' : msg);
      if (RUIM.test(texto)) tocar('erro');
      else if (!BOM.test(texto)) tocar('aviso');
      // o interruptor que acabou de virar já avisou que deu certo
      else setTimeout(() => { if (performance.now() - estadoEm > 600) tocar('certo'); }, 90);
      return toastOrig.apply(this, arguments);
    };
  }

  // ── Botão na barra de título ──
  const barra = document.querySelector('.titlebar .tb-ctrl, .titlebar .tb-controls');
  let botao = null;
  function pintar() {
    if (!botao) return;
    botao.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    botao.title = ligado ? 'Sons ligados' : 'Sons desligados';
    botao.querySelector('.snd-on').style.display = ligado ? '' : 'none';
    botao.querySelector('.snd-off').style.display = ligado ? 'none' : '';
  }
  function definir(v) {
    if (ligado && !v) tocar('desliga'); // a despedida ainda toca
    ligado = !!v;
    try { localStorage.setItem(KEY, ligado ? 'on' : 'off'); } catch (e) {}
    if (ligado) tocar('liga');
    pintar();
  }
  if (barra) {
    botao = document.createElement('button');
    botao.className = 'wc-btn snd-btn';
    botao.dataset.som = 'nada'; // quem fala é o definir()
    botao.setAttribute('aria-label', 'Ligar ou desligar os sons da interface');
    botao.style.webkitAppRegion = 'no-drag';
    botao.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path class="snd-on" d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/><path class="snd-off" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
    botao.addEventListener('click', () => definir(!ligado));
    barra.prepend(botao);
    pintar();
  }

  window.gdzSons = { tocar, definir, ligado: () => ligado };
})();
