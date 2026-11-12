// Teste de taxa de polling do mouse (aba Input Lag › Mouse).
// Mede de verdade: usa os eventos crus do mouse no Chromium (pointerrawupdate, que dispara
// a cada relatório USB; na falta dele, pointermove + getCoalescedEvents) e calcula a taxa
// pela mediana dos intervalos enquanto o mouse está em movimento. Guarda os resultados para
// comparar antes e depois (trocar polling no software do mouse, porta USB, hub, receptor).
(function () {
  const DURATION_MS = 5000;
  const PAUSE_MS = 20;        // intervalo maior que isso = mouse parado, não entra na conta
  const MIN_GAP_MS = 0.05;    // eventos com o mesmo carimbo de tempo são o mesmo relatório
  const STD_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
  const KEY = 'gdz-mouse-tests';

  const $ = (id) => document.getElementById(id);
  const pad = $('mt-pad');
  if (!pad) return;

  const hasRaw = 'onpointerrawupdate' in window;
  let running = false, stamps = [], startAt = 0, tick = null;

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))); } catch (e) {} }

  function onRaw(e) {
    if (!running) return;
    const list = !hasRaw && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (list.length ? list : [e])) stamps.push(ev.timeStamp);
  }

  function start() {
    if (running) return;
    running = true; stamps = []; startAt = 0;
    pad.classList.add('is-running'); pad.classList.remove('is-done');
    $('mt-hint').textContent = 'Mexa o mouse em círculos, sem parar…';
    $('mt-btn').disabled = true;
    tick = setInterval(() => {
      if (!startAt && stamps.length) startAt = performance.now();
      const left = startAt ? Math.max(0, DURATION_MS - (performance.now() - startAt)) : DURATION_MS;
      $('mt-bar').style.width = (100 - (left / DURATION_MS) * 100) + '%';
      $('mt-live').textContent = startAt ? `${(left / 1000).toFixed(1)} s` : 'esperando o mouse';
      if (startAt && left <= 0) finish();
    }, 50);
  }

  function analyse(ts) {
    ts = ts.slice().sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      if (d >= MIN_GAP_MS && d < PAUSE_MS) gaps.push(d);
    }
    if (gaps.length < 50) return null;
    const sorted = gaps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const hz = 1000 / median;
    const near = STD_RATES.reduce((b, r) => Math.abs(r - hz) < Math.abs(b - hz) ? r : b, STD_RATES[0]);
    const nominal = Math.abs(near - hz) <= near * 0.15 ? near : null; // só afirma a taxa padrão se estiver perto dela
    const stable = gaps.filter((g) => Math.abs(g - median) <= median * 0.25).length / gaps.length;
    const late = gaps.filter((g) => g > median * 1.8).length;
    return { hz: Math.round(hz), nominal, stable: Math.round(stable * 100), late, samples: gaps.length, at: Date.now() };
  }

  function finish() {
    clearInterval(tick); running = false;
    pad.classList.remove('is-running');
    $('mt-btn').disabled = false; $('mt-btn').textContent = 'Testar de novo';
    $('mt-bar').style.width = '0%';
    const r = analyse(stamps);
    if (!r) {
      $('mt-live').textContent = '';
      $('mt-hint').textContent = 'Poucos movimentos para medir. Clique em testar e mexa o mouse sem parar por 5 segundos.';
      return;
    }
    const list = load(); list.unshift(r); save(list);
    pad.classList.add('is-done');
    $('mt-hint').textContent = 'Clique em testar e mexa o mouse em círculos por 5 segundos';
    render();
  }

  function fmtAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  }
  function verdict(r) {
    if (r.stable >= 85) return { cls: 'ok', txt: 'estável' };
    if (r.stable >= 60) return { cls: 'warn', txt: 'oscilando' };
    return { cls: 'bad', txt: 'instável' };
  }

  function render() {
    const list = load();
    const r = list[0];
    $('mt-result').hidden = !r;
    if (!r) return;
    const v = verdict(r);
    $('mt-hz').textContent = r.hz.toLocaleString('pt-BR');
    $('mt-nominal').textContent = !r.nominal ? 'fora das taxas padrão'
      : r.nominal >= 1000 ? `provável ${r.nominal / 1000} kHz` : `provável ${r.nominal} Hz`;
    $('mt-stable').textContent = `${r.stable}%`;
    $('mt-stable-tag').className = 'mt-tag ' + v.cls; $('mt-stable-tag').textContent = v.txt;
    $('mt-late').textContent = r.late;
    const prev = list[1];
    const cmp = $('mt-cmp');
    if (prev) {
      const diff = r.hz - prev.hz;
      const sign = Math.abs(diff) < prev.hz * 0.05 ? 'igual' : diff > 0 ? 'subiu' : 'caiu';
      cmp.innerHTML = `Antes <b>${prev.hz.toLocaleString('pt-BR')} Hz</b> · ${prev.stable}% estável <span class="mt-ago">(${fmtAgo(prev.at)})</span> → agora <b>${r.hz.toLocaleString('pt-BR')} Hz</b> · ${r.stable}% <span class="mt-delta ${sign}">${sign}</span>`;
      cmp.hidden = false;
    } else {
      cmp.hidden = true;
    }
    // Aviso honesto quando o resultado indica algo para corrigir fora do Windows
    const tip = $('mt-tip');
    if (r.hz < 100) tip.textContent = `Deu ${r.hz} Hz, perto da taxa da tela: os movimentos chegaram uma vez por quadro, não a cada relatório do mouse. Teste de novo com o app em primeiro plano, sem outra janela por cima.`;
    else if (r.nominal && r.nominal <= 500) tip.textContent = `O mouse está reportando ${r.nominal} Hz. Se ele suporta 1000 Hz ou mais, suba no software do fabricante (G Hub, Synapse, etc.) e teste de novo.`;
    else if (r.stable < 60) tip.textContent = 'Taxa instável costuma ser receptor sem fio longe do mouse, hub USB ou porta frontal. Teste numa porta traseira da placa-mãe.';
    else tip.textContent = '';
    tip.hidden = !tip.textContent;
  }

  window.addEventListener(hasRaw ? 'pointerrawupdate' : 'pointermove', onRaw, { passive: true });
  $('mt-btn').addEventListener('click', start);
  $('mt-clear').addEventListener('click', () => { save([]); render(); });
  render();
})();
