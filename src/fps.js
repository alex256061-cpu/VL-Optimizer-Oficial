// ── Medidor de FPS ──
// Os números vêm do PresentMon, rodando no main.js ('fps-status'). Aqui só desenhamos, escolhemos
// o processo, gravamos as sessões "antes" e "depois" e ligamos o overlay. Usa ipcRenderer, toast()
// e escapeHtml() do script do dashboard.
(function () {
  const POS = ['Superior esquerdo', 'Superior direito', 'Inferior esquerdo', 'Inferior direito'];
  const SHOW = [['frametime', 'Frametime'], ['low1', '1% low'], ['cpu', 'Uso da CPU'], ['cpuTemp', 'Temp. da CPU'],
    ['gpu', 'Uso da GPU'], ['gpuTemp', 'Temp. da GPU'], ['ram', 'RAM'], ['name', 'Nome do jogo']];
  const SECS = [15, 30, 60];
  const NOISE = 3; // diferença abaixo de 3% é variação normal entre duas medições
  const st = { timer: null, data: null, recording: false, secs: 30, drawn: false };
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (n == null ? '--' : Number(n).toFixed(d));
  const game = (n) => String(n || '').replace(/\.exe$/i, '');
  const tone = (fps) => (fps >= 100 ? 'good' : fps >= 50 ? 'mid' : 'bad');

  function skeleton() {
    $('fpm-root').innerHTML = `
      <div class="fpm-grid">
        <div class="fpm-card">
          <div class="fpm-card-hdr"><div><div class="fpm-title">Ao vivo</div>
            <div class="fpm-sub">Medido pelo Windows (PresentMon), sem mexer no jogo: seguro com anti-cheat.</div></div>
            <span class="fpm-dot" id="fpm-dot" title="Medidor"></span></div>
          <div class="fpm-live">
            <div class="fpm-big"><span class="fpm-big-num" id="fpm-fps">--</span><span class="fpm-big-unit">FPS</span></div>
            <div class="fpm-stats">
              <div><div class="fpm-stat-l">Frametime</div><div class="fpm-stat-v" id="fpm-ft">--</div></div>
              <div><div class="fpm-stat-l">1% low (10 s)</div><div class="fpm-stat-v" id="fpm-low">--</div></div>
            </div>
          </div>
          <div class="fpm-proc">
            <span class="fpm-proc-l">Medindo</span>
            <select class="fpm-select" id="fpm-target" aria-label="Processo medido"></select>
          </div>
          <div class="fpm-msg" id="fpm-msg"></div>
          <div class="fpm-base" id="fpm-base">
            <div class="fpm-base-l">
              <div class="fpm-stat-l">Ganho ao vivo</div>
              <div class="fpm-base-v" id="fpm-base-v">Sem base</div>
              <div class="fpm-base-d" id="fpm-base-d">Jogue sem DLSS, marque a base e depois ligue o DLSS no jogo: o ganho aparece aqui e no FPS na tela.</div>
            </div>
            <div class="fpm-base-act">
              <button class="fpm-btn" id="fpm-base-mark">Marcar base agora</button>
              <button class="fpm-btn ghost" id="fpm-base-clear" hidden>Limpar</button>
            </div>
          </div>
        </div>

        <div class="fpm-card">
          <div class="fpm-card-hdr"><div><div class="fpm-title">FPS na tela</div>
            <div class="fpm-sub">Um contador pequeno por cima do jogo. Não recebe clique nem tira o foco do jogo.</div></div>
            <div class="toggle" id="fpm-ov" role="switch" tabindex="0" aria-label="Mostrar FPS na tela"></div></div>
          <div class="fpm-pos" id="fpm-pos">${POS.map((p, i) => `<button data-pos="${i}">${p}</button>`).join('')}</div>
          <div class="fpm-show-t">O que mostrar</div>
          <div class="fpm-show" id="fpm-show">${SHOW.map(([k, label]) => `<button data-k="${k}" aria-pressed="false">${label}</button>`).join('')}</div>
          <div class="fpm-note">Aparece com o jogo em <b>janela</b> ou <b>tela cheia sem bordas</b> (borderless). Em tela cheia exclusiva o Windows não deixa nenhum programa desenhar por cima: troque o modo de tela no jogo.</div>
        </div>
      </div>

      <div class="fpm-card" style="margin-top:16px">
        <div class="fpm-card-hdr"><div><div class="fpm-title">Comparar antes e depois</div>
          <div class="fpm-sub">Grave o mesmo trecho do jogo duas vezes e veja o ganho real de ativar DLSS, FSR ou qualquer otimização.</div></div>
          <select class="fpm-select" id="fpm-secs" aria-label="Duração da gravação">${SECS.map(s => `<option value="${s}">${s} segundos</option>`).join('')}</select></div>
        <div class="fpm-steps">
          <span class="fpm-step"><b>1</b>Grave o "Antes" no jogo</span>
          <span class="fpm-step"><b>2</b>Ative o DLSS/FSR no menu do jogo</span>
          <span class="fpm-step"><b>3</b>Grave o "Depois" no mesmo lugar</span>
        </div>
        <div class="fpm-slots">${['a', 'b'].map(slotHtml).join('')}</div>
        <div class="fpm-cmp" id="fpm-cmp" hidden></div>
      </div>`;

    $('fpm-target').addEventListener('change', async (e) => {
      const pid = e.target.value ? Number(e.target.value) : null;
      await ipcRenderer.invoke('fps-set-target', { pid });
      poll();
    });
    const ov = $('fpm-ov');
    ov.addEventListener('click', () => setOverlay({ on: !ov.classList.contains('on') }));
    ov.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ov.click(); } });
    $('fpm-show').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) setOverlay({ show: { [b.dataset.k]: b.getAttribute('aria-pressed') !== 'true' } });
    });
    $('fpm-pos').addEventListener('click', (e) => { const b = e.target.closest('button[data-pos]'); if (b) setOverlay({ pos: Number(b.dataset.pos) }); });
    $('fpm-base-mark').addEventListener('click', async () => {
      const r = await ipcRenderer.invoke('fps-base-mark');
      toast(r && r.success ? `Base marcada: ${fmt(r.base.fps, 0)} FPS. Agora ligue o DLSS no jogo.` : (r && r.error) || 'Não foi possível marcar a base.');
      poll();
    });
    $('fpm-base-clear').addEventListener('click', async () => { await ipcRenderer.invoke('fps-base-clear'); poll(); });
    $('fpm-secs').value = String(st.secs);
    $('fpm-secs').addEventListener('change', (e) => { st.secs = Number(e.target.value); });
    for (const s of ['a', 'b']) {
      $('fpm-rec-' + s).addEventListener('click', () => record(s));
      $('fpm-clr-' + s).addEventListener('click', () => clear(s));
    }
    st.drawn = true;
  }

  function slotHtml(s) {
    return `<div class="fpm-slot">
      <div class="fpm-slot-hdr"><span class="fpm-tag">${s === 'a' ? 'ANTES' : 'DEPOIS'}</span>
        <input class="fpm-label" id="fpm-lbl-${s}" maxlength="40" placeholder="${s === 'a' ? 'Ex.: Nativo' : 'Ex.: DLSS Qualidade'}" aria-label="Nome da gravação"></div>
      <div class="fpm-slot-res" id="fpm-res-${s}"></div>
      <div class="fpm-bar" id="fpm-bar-${s}" hidden><i></i></div>
      <div class="fpm-slot-act">
        <button class="fpm-btn" id="fpm-rec-${s}">Gravar</button>
        <button class="fpm-btn ghost" id="fpm-clr-${s}" title="Apagar esta gravação">Apagar</button>
      </div></div>`;
  }

  function renderSlot(s, ses) {
    const res = $('fpm-res-' + s);
    const lbl = $('fpm-lbl-' + s);
    if (ses && document.activeElement !== lbl && !lbl.dataset.dirty) lbl.value = ses.label;
    $('fpm-clr-' + s).disabled = !ses;
    if (!ses) { res.innerHTML = '<div class="fpm-slot-empty">Nenhuma gravação ainda.</div>'; return; }
    const when = new Date(ses.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    res.innerHTML = `
      <div><div class="fpm-stat-l">FPS médio</div><div class="fpm-stat-v">${fmt(ses.fps, 1)}</div></div>
      <div><div class="fpm-stat-l">1% low</div><div class="fpm-stat-v">${fmt(ses.low1, 1)}</div></div>
      <div><div class="fpm-stat-l">0.1% low</div><div class="fpm-stat-v">${fmt(ses.low01, 1)}</div></div>
      <div><div class="fpm-stat-l">Frametime</div><div class="fpm-stat-v">${fmt(ses.frametime, 2)} ms</div></div>`;
    let meta = res.parentElement.querySelector('.fpm-slot-meta');
    if (!meta) { meta = document.createElement('div'); meta.className = 'fpm-slot-meta'; res.after(meta); }
    meta.textContent = `${game(ses.name)} · ${ses.secs} s · ${ses.frames.toLocaleString('pt-BR')} frames · ${when}`;
  }

  function renderCompare(a, b) {
    const box = $('fpm-cmp');
    if (!a || !b) { box.hidden = true; return; }
    box.hidden = false;
    const pct = (x, y) => (y - x) / x * 100;
    // No frametime, menor é melhor: o ganho é a redução.
    const rows = [
      ['FPS médio', a.fps, b.fps, 1, false],
      ['1% low', a.low1, b.low1, 1, false],
      ['0.1% low', a.low01, b.low01, 1, false],
      ['Frametime', a.frametime, b.frametime, 2, true],
    ];
    const cell = ([name, x, y, d, lower]) => {
      const p = pct(x, y), better = lower ? -p : p;
      const cls = Math.abs(p) < NOISE ? 'same' : better > 0 ? 'up' : 'down';
      return `<div class="fpm-gain"><div class="fpm-stat-l">${name}</div>
        <div class="fpm-gain-v ${cls}">${p > 0 ? '+' : ''}${p.toFixed(1)}%</div>
        <div class="fpm-gain-d">${fmt(x, d)} → ${fmt(y, d)}${lower ? ' ms' : ''}</div></div>`;
    };
    const g = pct(a.fps, b.fps), l = pct(a.low1, b.low1);
    const A = `"${escapeHtml(a.label)}"`, B = `"${escapeHtml(b.label)}"`;
    // O FPS médio decide o veredito; o 1% low (engasgos) complementa.
    const lowTxt = l >= NOISE ? `os engasgos diminuíram (1% low ${l.toFixed(0)}% melhor)` : l <= -NOISE ? `os engasgos aumentaram (1% low ${Math.abs(l).toFixed(0)}% pior)` : '';
    let verdict;
    if (Math.abs(g) < NOISE) verdict = `FPS médio praticamente igual entre ${A} e ${B}` + (lowTxt ? `, mas ${lowTxt}.` : ': a diferença está dentro da variação normal.');
    else if (g > 0) verdict = `${B} rodou <b>${g.toFixed(0)}% mais rápido</b> que ${A}` + (lowTxt ? (l > 0 ? `, e ${lowTxt}.` : `, mas ${lowTxt}.`) : '.');
    else verdict = `${B} rodou <b>${Math.abs(g).toFixed(0)}% mais devagar</b> que ${A}` + (lowTxt ? (l > 0 ? `, mas ${lowTxt}.` : `, e ${lowTxt}.`) : '.');
    const warn = a.name.toLowerCase() !== b.name.toLowerCase()
      ? `<div class="fpm-warn">As gravações são de jogos diferentes (${escapeHtml(game(a.name))} e ${escapeHtml(game(b.name))}): a comparação não vale.</div>` : '';
    box.innerHTML = `<div class="fpm-cmp-grid">${rows.map(cell).join('')}</div><div class="fpm-verdict">${verdict}</div>${warn}`;
  }

  function render(d) {
    st.data = d;
    const live = d.live;
    $('fpm-dot').classList.toggle('on', !!d.success);
    const big = $('fpm-fps');
    big.textContent = live ? live.fps : '--';
    big.className = 'fpm-big-num' + (live ? ' ' + tone(live.fps) : '');
    $('fpm-ft').textContent = live ? fmt(live.frametime, 1) + ' ms' : '--';
    $('fpm-low').textContent = live ? live.low1 + ' FPS' : '--';

    const msg = $('fpm-msg');
    if (!d.success) { msg.className = 'fpm-msg err'; msg.textContent = d.error || 'O medidor não iniciou.'; }
    else if (d.needsAdmin) { msg.className = 'fpm-msg err'; msg.textContent = 'O medidor precisa de administrador: o Windows bloqueia a leitura de quadros sem ele. Use "Reabrir como admin" no topo.'; }
    else if (!live) { msg.className = 'fpm-msg'; msg.textContent = 'Abra um jogo: ele aparece aqui sozinho em poucos segundos.'; }
    else msg.textContent = '';

    // Lista de processos: só reconstrói quando muda, para não fechar o menu aberto.
    const sel = $('fpm-target');
    const opts = [['', 'Automático' + (live && !d.pinned ? ` (${game(live.name)})` : '')]]
      .concat(d.processes.map(p => [String(p.pid), `${game(p.name)} · ${p.fps} FPS`]));
    const sig = opts.map(o => o[0]).join(',') + '|' + (d.pinned || '');
    if (sel.dataset.sig !== sig && document.activeElement !== sel) {
      sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('');
      sel.value = d.pinned ? String(d.pinned) : '';
      sel.dataset.sig = sig;
    } else if (document.activeElement !== sel) {
      // Atualiza só os textos (FPS de cada processo).
      [...sel.options].forEach((o, i) => { if (opts[i]) o.textContent = opts[i][1]; });
    }

    // Ganho ao vivo contra a base (Ctrl+Alt+B dentro do jogo, ou o botão).
    const bv = $('fpm-base-v'), bd = $('fpm-base-d'), lb = live && live.base;
    const key = d.hotkey ? ` Dentro do jogo, aperte <b>${d.hotkey}</b>.` : '';
    $('fpm-base-clear').hidden = !d.base;
    $('fpm-base-mark').disabled = !live;
    if (!d.base) {
      bv.className = 'fpm-base-v'; bv.textContent = 'Sem base';
      bd.innerHTML = 'Jogue sem DLSS e marque a base. Depois ligue o DLSS no jogo: o ganho aparece aqui e no FPS na tela.' + key;
    } else if (!lb) {
      bv.className = 'fpm-base-v'; bv.textContent = `Base ${fmt(d.base.fps, 0)} FPS`;
      bd.textContent = `Marcada em ${game(d.base.name)}. Abra esse jogo para ver o ganho.`;
    } else {
      const g = lb.gain, cls = g == null || Math.abs(g) < NOISE ? 'same' : g > 0 ? 'up' : 'down';
      bv.className = 'fpm-base-v ' + cls;
      bv.textContent = g == null ? '--' : `${g > 0 ? '+' : ''}${g.toFixed(1)}%`;
      bd.innerHTML = `Base <b>${fmt(lb.fps, 0)}</b> → agora <b>${lb.now}</b> FPS (média de 3 s).` + (Math.abs(g) < NOISE ? ' Igual à base: ligou mesmo o DLSS/FSR no jogo?' : '') + key;
    }

    const ov = d.overlay || {};
    $('fpm-ov').classList.toggle('on', !!ov.on);
    $('fpm-ov').setAttribute('aria-checked', ov.on ? 'true' : 'false');
    document.querySelectorAll('#fpm-pos button').forEach(b => {
      b.classList.toggle('on', Number(b.dataset.pos) === ov.pos);
      b.disabled = !ov.on;
    });
    document.querySelectorAll('#fpm-show button').forEach(b => {
      const on = !!(ov.show && ov.show[b.dataset.k]);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !ov.on;
    });

    const rec = d.recording;
    for (const s of ['a', 'b']) {
      renderSlot(s, d.sessions[s]);
      const mine = rec && rec.slot === s;
      const btn = $('fpm-rec-' + s);
      btn.disabled = !!rec || !d.success;
      btn.textContent = mine ? `Gravando ${game(rec.name)}… ${rec.left} s` : d.sessions[s] ? 'Gravar de novo' : 'Gravar';
      const bar = $('fpm-bar-' + s);
      bar.hidden = !mine;
      if (mine) bar.firstElementChild.style.width = Math.round((1 - rec.left / rec.secs) * 100) + '%';
    }
    renderCompare(d.sessions.a, d.sessions.b);
  }

  async function poll() {
    if (!$('pg-fps').classList.contains('active')) { stop(); return; }
    try { render(await ipcRenderer.invoke('fps-status')); } catch (e) {}
  }
  function start() {
    if (!st.drawn) skeleton();
    poll();
    clearInterval(st.timer);
    st.timer = setInterval(poll, 1000);
  }
  function stop() { clearInterval(st.timer); st.timer = null; }

  async function setOverlay(patch) {
    const r = await ipcRenderer.invoke('fps-overlay-set', patch);
    if (r && r.success && st.data) { st.data.overlay = r.overlay; render(st.data); }
    if (patch.on === true) toast('FPS na tela ligado. Use o jogo em janela ou tela cheia sem bordas.');
  }

  async function record(s) {
    const lbl = $('fpm-lbl-' + s);
    const live = st.data && st.data.live;
    if (!live) { toast('Abra o jogo antes de gravar.'); return; }
    toast(`Gravando ${game(live.name)} por ${st.secs} s. Volte para o jogo e jogue normalmente.`);
    // A gravação segura a resposta até terminar; o progresso vem pelo poll.
    const r = await ipcRenderer.invoke('fps-record', { slot: s, secs: st.secs, label: lbl.value });
    delete lbl.dataset.dirty;
    if (!r || !r.success) toast((r && r.error) || 'A gravação falhou.');
    else {
      toast(`Gravação "${r.session.label}": ${fmt(r.session.fps, 1)} FPS de média.`);
      window.dispatchEvent(new CustomEvent('gdz-diag', { detail: 'fps' }));
    }
    poll();
  }

  async function clear(s) {
    await ipcRenderer.invoke('fps-clear', { slot: s });
    $('fpm-lbl-' + s).value = '';
    const meta = $('fpm-res-' + s).parentElement.querySelector('.fpm-slot-meta');
    if (meta) meta.remove();
    poll();
  }

  document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('fpm-label')) e.target.dataset.dirty = '1'; });

  const baseGo = window.go;
  window.go = function (pg, el) {
    baseGo(pg, el);
    if (pg === 'fps') start(); else stop();
  };
})();
