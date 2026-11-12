// Dashboard v3 (layout do Figma "Redesign v3").
// Tudo aqui vem de dado real: o mostrador do giroscópio conta os ajustes recomendados para este
// PC que estão ligados no Windows agora (otimizacoes.js lê o estado), e o texto usa as
// recomendações medidas no PC. Nada de "ganho estimado" inventado.
(function () {
  const $ = (id) => document.getElementById(id);

  // ── Mostrador em volta do giroscópio: um traço por recomendado, acesos os que já estão ligados ──
  // 270° de arco, aberto embaixo, onde fica o número.
  const DIAL_FROM = 135, DIAL_SWEEP = 270, DIAL_C = 130, DIAL_R1 = 117, DIAL_R2 = 127;
  function drawDial(total, done) {
    const dial = $('dh-dial');
    if (!dial) return;
    if (dial.childElementCount !== total) {
      const ticks = [];
      for (let i = 0; i < total; i++) {
        const a = (DIAL_FROM + (total > 1 ? (i * DIAL_SWEEP) / (total - 1) : DIAL_SWEEP / 2)) * Math.PI / 180;
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', (DIAL_C + DIAL_R1 * Math.cos(a)).toFixed(2));
        l.setAttribute('y1', (DIAL_C + DIAL_R1 * Math.sin(a)).toFixed(2));
        l.setAttribute('x2', (DIAL_C + DIAL_R2 * Math.cos(a)).toFixed(2));
        l.setAttribute('y2', (DIAL_C + DIAL_R2 * Math.sin(a)).toFixed(2));
        l.style.transitionDelay = `${i * 24}ms`; // acende um depois do outro
        ticks.push(l);
      }
      dial.replaceChildren(...ticks);
      dial.getBoundingClientRect(); // fixa o estado apagado antes de acender, senão a transição não roda
    }
    [...dial.children].forEach((l, i) => l.classList.toggle('on', i < done));
  }
  drawDial(24, 0); // enquanto o Windows ainda está sendo lido

  // ── Giroscópio: inclina na direção do mouse enquanto ele está no card ──
  const hero = $('dh-hero');
  const gyro = hero && hero.querySelector('.dh-gyro');
  // Efeitos desligados em Sobre, ou "reduzir movimento" ligado no Windows
  const noFx = () => document.documentElement.dataset.fx === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (gyro) {
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    let raf = 0, ev = null;
    hero.addEventListener('pointermove', (e) => {
      ev = e;
      if (raf || noFx()) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = gyro.getBoundingClientRect();
        gyro.style.setProperty('--gy-x', clamp((ev.clientX - (r.left + r.width / 2)) / r.width).toFixed(3));
        gyro.style.setProperty('--gy-y', clamp((ev.clientY - (r.top + r.height / 2)) / r.height).toFixed(3));
      });
    });
    hero.addEventListener('pointerleave', () => {
      gyro.style.removeProperty('--gy-x');
      gyro.style.removeProperty('--gy-y');
    });
    // A pausa com a janela sem foco é do fundo.js (.gy-paused no body), junto com a do fundo.
  }

  // ── Em equilíbrio: com tudo aplicado, os aros param alinhados e só o conjunto balança ──
  // Cada aro sai de onde estava no giro e vai até a pose alinhada; o resto é do giroscopio.css (.gy-done).
  let balanced = null;
  function setBalanced(on) {
    if (!gyro || on === balanced) return;
    balanced = on;
    gyro.querySelectorAll('.gy-ring').forEach((ring) => {
      ring.getAnimations().forEach((a) => { if (a.id === 'gy-lock') a.cancel(); });
      if (!on) { ring.style.animation = ''; ring.style.transform = ''; return; }
      const from = getComputedStyle(ring).transform;
      ring.style.animation = 'none';
      ring.style.transform = 'none';
      if (noFx() || from === 'none') return;
      ring.animate([{ transform: from }, { transform: 'none' }], { duration: 1600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).id = 'gy-lock';
    });
    gyro.classList.toggle('gy-done', on);
  }

  // ── Número do mostrador: conta até o valor em vez de trocar de uma vez ──
  let shown = null, tween = 0;
  function countTo(n) {
    const el = $('dh-num');
    if (shown === n) return;
    const from = shown === null ? 0 : shown;
    shown = n;
    cancelAnimationFrame(tween);
    if (noFx()) { el.textContent = n; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      el.textContent = Math.round(from + (n - from) * (1 - (1 - k) ** 3));
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  // ── Saudação ──
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }
  ipcRenderer.invoke('get-user').then((u) => {
    const n = u && (u.username || (u.email || '').split('@')[0]);
    const el = $('dh-greet');
    if (el) el.textContent = n ? `${greeting()}, ${n}` : 'Dashboard';
  }).catch(() => {});

  // Sidebar recolhível: o texto de cada item vai para um <span class="nav-label">, que o CSS
  // esmaece quando a barra fica só com ícones.
  document.querySelectorAll('.sidebar .nav-item').forEach((item) => {
    const text = [...item.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text.length || item.querySelector('.nav-label')) return;
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = text.map((n) => n.textContent.trim()).join(' ');
    text[0].replaceWith(label);
    text.slice(1).forEach((n) => n.remove());
    item.setAttribute('aria-label', label.textContent);
    item.tabIndex = 0;
  });
  document.querySelectorAll('.sidebar .sb-section').forEach((sec) => {
    if (sec.querySelector('.sb-sec-txt')) return;
    const t = document.createElement('span');
    t.className = 'sb-sec-txt';
    t.textContent = sec.textContent.trim();
    sec.textContent = '';
    sec.appendChild(t);
  });
  document.querySelector('.sidebar .sb-nav')?.addEventListener('keydown', (e) => {
    const it = e.target.closest('.nav-item');
    if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); it.click(); }
  });
  // Ao escolher uma aba, a barra recolhe na hora para devolver o espaço à página.
  const sidebar = document.querySelector('.sidebar');
  sidebar?.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-item')) return;
    sidebar.classList.add('sb-closing');
    document.activeElement?.blur?.();
  });
  sidebar?.addEventListener('mouseleave', () => sidebar.classList.remove('sb-closing'));

  // Nome curto da CPU nos cards ("Ryzen 7 7800X3D 8-Core Processor" → "Ryzen 7 7800X3D")
  const origAbbr = window.abbreviateHW;
  if (origAbbr) window.abbreviateHW = (name) => (origAbbr(name) || name || '').replace(/\s+\d+-Core\s+Processor\b/i, '').replace(/\s+Processor\b/i, '').trim() || name;

  // ── Recomendados que valem para este PC (catálogo do otimizacoes.js, estado lido do Windows) ──
  let lastRecs = null;
  function refreshHero() {
    if (!window.gdzOpt || !gdzOpt.loaded()) return;
    const acts = gdzOpt.recommended();
    if (!acts.length) return;
    const done = acts.filter((a) => a.on);
    const pending = acts.filter((a) => !a.on);

    countTo(done.length);
    $('dh-of').textContent = `de ${acts.length}`;
    drawDial(acts.length, done.length);
    setBalanced(!pending.length);

    const chip = $('dh-chip');
    chip.hidden = false;
    if (pending.length) {
      $('dh-title').textContent = done.length ? 'Dá para melhorar' : 'Nada aplicado ainda';
      chip.className = 'dh-chip warn';
      chip.textContent = `${pending.length} ${pending.length === 1 ? 'pendente' : 'pendentes'}`;
      $('dh-link-txt').textContent = `Ver ${pending.length === 1 ? 'a pendente' : `as ${pending.length} pendentes`}`;
    } else {
      $('dh-title').textContent = 'Tudo no ponto';
      chip.className = 'dh-chip ok';
      chip.textContent = 'tudo aplicado';
      $('dh-link-txt').textContent = 'Ver as otimizações';
    }

    const parts = [];
    if (pending.length) {
      parts.push(pending.length === 1
        ? `Falta só ${pending[0].title}.`
        : `Faltam ${pending.length} otimizações, a começar por ${pending[0].title}.`);
    } else {
      parts.push('Todos os ajustes recomendados para o seu PC estão ligados. Qualquer um pode ser desligado quando você quiser.');
    }
    const r = lastRecs;
    if (r && r.startupOn > 0) parts.push(`${r.startupOn} ${r.startupOn === 1 ? 'app abre' : 'apps abrem'} junto com o Windows.`);
    if (r && r.tempBytes >= 100 * 1024 ** 2) parts.push(`${fmtBytes(r.tempBytes)} de temporários para limpar.`);
    $('dh-desc').textContent = parts.join(' ');
  }

  async function refreshRecs() {
    try { lastRecs = await ipcRenderer.invoke('get-recommendations'); } catch (e) { lastRecs = null; }
    // Badge da Inicialização: número real de apps que abrem com o Windows (antes era um "5" fixo)
    const badge = document.querySelector('.nav-item[onclick*="inicializacao"] .nav-badge');
    if (badge) {
      const n = lastRecs && lastRecs.startupOn;
      badge.textContent = n || '';
      badge.hidden = !n;
    }
    refreshHero();
  }

  // Atualiza junto com o app: toda ação aplicada/desfeita passa por syncUndoButtons,
  // e limpeza de temporários/inicialização passa por loadRecs.
  const origSync = window.syncUndoButtons;
  window.syncUndoButtons = async function () { const r = await origSync.apply(this, arguments); refreshHero(); return r; };
  const origRecs = window.loadRecs;
  window.loadRecs = async function () { const r = await origRecs.apply(this, arguments); refreshRecs(); return r; };

  // O catálogo avisa sempre que lê o Windows ou um ajuste muda.
  window.addEventListener('gdz-opt-change', refreshHero);

  // Data da última Otimização Rápida (quickOpt escreve "agora mesmo" em #last-opt)
  const LAST_KEY = 'gdz-last-quickopt';
  function fmtLast(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'última vez agora mesmo';
    if (min < 60) return `última vez há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `última vez há ${h} h`;
    const d = Math.round(h / 24);
    return `última vez há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  const last = $('last-opt');
  function showLast() {
    let ts = null;
    try { ts = Number(localStorage.getItem(LAST_KEY)) || null; } catch (e) {}
    last.textContent = ts ? fmtLast(ts) : 'nenhuma otimização rápida ainda';
  }
  if (last) {
    new MutationObserver(() => {
      if (last.textContent === 'agora mesmo') {
        try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) {}
        showLast();
      }
    }).observe(last, { childList: true, characterData: true, subtree: true });
    showLast();
    setInterval(showLast, 60000);
  }

  setTimeout(refreshRecs, 600);
})();
