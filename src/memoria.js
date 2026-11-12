// Pentes de memória da página Memória (desenho no memoria.css).
// Tudo aqui vem do PC: os slots da placa-mãe na ordem em que estão nela e o pente de cada um
// (tamanho, geração, velocidade em uso, marca e modelo), lidos pelo main no SMBIOS.
// O Windows não diz qual pente guarda o quê, a memória é um bolo só. Por isso todos os pentes
// mostram o MESMO nível, o uso do sistema inteiro, em vez de um cheio e outro vazio de mentira.
(function () {
  const $ = (id) => document.getElementById(id);
  const row = $('rs-row'), page = $('pg-memoria');
  if (!row || !page) return;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // os textos vêm da BIOS: nunca como HTML
    return e;
  };
  const num = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  function slotEl(s, i) {
    const slot = el('div', 'rs-slot' + (s.empty ? ' empty' : s.form === 'dimm' ? '' : ' ' + s.form));
    slot.style.setProperty('--i', i);
    const stage = el('div', 'rs-stage');
    if (s.empty) {
      stage.append(el('div', 'rs-ghost', 'slot vazio'));
    } else {
      const led = el('div', 'rs-led');
      led.append(el('b'), el('i'));
      const pcb = el('div', 'rs-pcb');
      const chips = s.form === 'dimm' ? 8 : 4;
      for (let c = 0; c < chips; c++) {
        if (c === chips / 2) pcb.append(el('span', /DDR5/.test(s.gen) ? 'rs-pmic' : 'rs-spd'));
        const chip = el('span', 'rs-chip');
        chip.style.setProperty('--c', (c * 5 + i * 3) % 8); // cada chip pulsa fora de fase do vizinho
        pcb.append(chip);
      }
      const pins = el('div', 'rs-pins');
      pins.append(el('i'), el('i'));
      const body = el('div', 'rs');
      body.append(led, pcb, pins, el('div', 'rs-scan'));
      stage.append(body);
    }
    stage.append(el('div', 'rs-socket'));

    const cap = el('div', 'rs-cap');
    cap.append(el('span', 'rs-loc', s.label || `Slot ${i + 1}`));
    if (s.empty) {
      cap.append(el('span', 'rs-part', 'Sem pente'));
    } else {
      cap.append(el('span', 'rs-gb', `${num(s.gb)} GB`));
      const spec = [s.gen, s.mts ? `${s.mts} MT/s` : '', s.form === 'soldada' ? 'soldada na placa' : ''].filter(Boolean).join(' · ');
      if (spec) cap.append(el('span', 'rs-spec', spec));
      const model = [s.maker, s.part].filter(Boolean).join(' ');
      if (model) {
        const part = el('span', 'rs-part', model);
        part.title = model;
        cap.append(part);
      }
    }
    slot.append(stage, cap);
    return slot;
  }

  function summary(sticks) {
    const on = sticks.filter((s) => !s.empty);
    const one = (list) => { const u = [...new Set(list.filter(Boolean))]; return u.length === 1 ? u[0] : ''; };
    const gen = one(on.map((s) => s.gen)), mts = one(on.map((s) => s.mts));
    return [
      on.length < sticks.length ? `${on.length} de ${sticks.length} slots` : `${on.length} ${on.length === 1 ? 'pente' : 'pentes'}`,
      `${num(on.reduce((t, s) => t + s.gb, 0))} GB${gen ? ' ' + gen : ''}`,
      mts ? `${mts} MT/s` : '',
    ].filter(Boolean).join(' · ');
  }

  let drawn = '';
  function drawSticks(sticks) {
    const key = JSON.stringify(sticks);
    if (key === drawn) return;
    drawn = key;
    row.replaceChildren(...sticks.map(slotEl));
    row.hidden = false;
    const sum = $('rs-sum');
    if (sum) sum.textContent = summary(sticks);
  }

  // Legenda da barra: em uso | cache | livre. Sem a leitura do cache (contadores do Windows
  // quebrados) a barra fica como sempre foi, só com o uso.
  function drawBar(m, cachePct) {
    const bar = $('mem-cache-bar'), legend = $('mem-legend');
    if (bar) bar.style.width = cachePct > 0.3 ? `calc(${cachePct.toFixed(1)}% + 7px)` : '0';
    if (!legend) return;
    legend.hidden = m.cache == null;
    if (m.cache == null) return;
    if (!legend.childElementCount) {
      const item = (cls, name, tip) => {
        const s = el('span', cls);
        s.append(el('i'), document.createTextNode(name), el('b'));
        if (tip) s.title = tip;
        return s;
      };
      legend.append(
        item('ml-used', 'Em uso'),
        item('ml-cache', 'Cache', 'Arquivos que o Windows deixa na memória para abrir mais rápido. É o que o botão Limpar agora esvazia.'),
        item('ml-free', 'Livre'),
      );
    }
    const vals = [m.used, m.cache, Math.max(0, m.total - m.used - m.cache)];
    legend.querySelectorAll('b').forEach((b, i) => { b.textContent = `${num(vals[i])} GB`; });
  }

  function render(m) {
    if (!m || !m.total) return;
    const pct = Math.max(0, Math.min(100, m.pct));
    const cachePct = m.cache == null ? 0 : Math.max(0, Math.min(100 - pct, (m.cache / m.total) * 100));
    drawBar(m, cachePct);
    if (!Array.isArray(m.sticks) || !m.sticks.some((s) => !s.empty)) return;
    drawSticks(m.sticks);
    row.style.setProperty('--fill', pct + '%');
    row.style.setProperty('--avail', (pct + cachePct).toFixed(1) + '%');
    // quanto mais memória em uso, mais rápido os chips pulsam (de 3,4 s até 1,2 s por batida)
    row.style.setProperty('--beat', (3.4 - Math.round(pct / 10) * 0.22).toFixed(2) + 's');
    row.classList.toggle('warn', pct >= 85 && pct < 93);
    row.classList.toggle('crit', pct >= 93);
    row.querySelectorAll('.rs-pcb').forEach((pcb) => {
      const chips = pcb.querySelectorAll('.rs-chip');
      const lit = pct > 0 ? Math.max(1, Math.round((pct / 100) * chips.length)) : 0;
      chips.forEach((c, i) => c.classList.toggle('on', i < lit));
    });
  }

  window.gdzRam = {
    render,
    // varredura nos pentes enquanto a limpeza do cache roda de verdade
    cleaning(on) { row.classList.toggle('rs-cleaning', !!on); },
  };

  // Ao vivo só com a página aberta e a janela em foco: jogando, o app não fica lendo nada.
  setInterval(() => {
    if (page.classList.contains('active') && !document.hidden && document.hasFocus()) updateMemoryTab();
  }, 2000);

  // O main lê os pentes em segundo plano na primeira chamada; pede de novo até chegarem, para a
  // página já abrir com eles.
  let tries = 0;
  const wait = setInterval(() => {
    if (drawn || ++tries > 12) { clearInterval(wait); return; }
    updateMemoryTab();
  }, 1500);
  updateMemoryTab();
})();
