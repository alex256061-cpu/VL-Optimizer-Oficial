// ── Informações do PC ──
// A ficha das peças vem do main.js ('pcinfo-get', lida uma vez) e os sensores de 'pcinfo-live'
// (a cada 2 s, só com esta página aberta). Dois modos: Simples, um cartão por peça em linguagem de
// jogador, e Avançado, com abas no estilo CPU-Z e a tabela de sensores com mínimo e máximo.
// Só lê: nada aqui muda o PC. Usa ipcRenderer, toast(), goTo() e escapeHtml() do script do dashboard.
(function () {
  const root = document.getElementById('pci-root');
  if (!root) return;

  const POLL_MS = 2000;
  const WARMUP = 4; // leituras até dar por ausente um sensor que nunca respondeu
  const GIB = 1073741824;
  const st = { info: null, live: null, polls: 0, mode: 'simple', tab: 'cpu', timer: null, loading: false, error: '', defs: [], range: {} };
  try { if (localStorage.getItem('gdz-pcinfo-mode') === 'advanced') st.mode = 'advanced'; } catch (e) {}

  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s == null ? '' : s);
  const nf = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hex = (n) => Number(n).toString(16).toUpperCase();
  const pct = (v) => `${Math.round(v)}%`;
  const temp = (v) => `${Math.round(v)} °C`;
  const ghz = (mhz) => `${nf(mhz / 1000, 2)} GHz`;
  const ramSize = (b) => `${nf(Math.round(b / GIB))} GB`;
  const vramSize = (b) => (b >= GIB * 0.9 ? `${nf(Math.round(b / GIB))} GB` : `${nf(Math.round(b / 1048576))} MB`);
  // Disco no tamanho da caixa (decimal); unidade como o Explorador mostra (binário).
  const diskSize = (b) => { const t = Math.round(b / 1e11); return b >= 1e12 ? `${nf(t / 10, t % 10 ? 1 : 0)} TB` : `${nf(Math.round(b / 1e9))} GB`; };
  const volSize = (b) => { const g = b / GIB; return g >= 1000 ? `${nf(g / 1024, 2)} TB` : `${nf(Math.round(g))} GB`; };
  const netSpeed = (bps) => (bps >= 1e9 ? `${nf(bps / 1e9, bps % 1e9 ? 1 : 0)} Gbps` : `${nf(Math.round(bps / 1e6))} Mbps`);
  const date = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const since = (ms) => {
    const min = Math.max(0, Math.floor((Date.now() - ms) / 60000)), d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${min % 60} min` : `${min} min`;
  };
  const svg = (inner, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const IC = {
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    gpu: '<rect x="1" y="6" width="22" height="12" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><path d="M5 18v3M9 18v3"/>',
    ram: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M8 8V6M12 8V6M16 8V6M8 16v2M12 16v2M16 16v2"/>',
    disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6"/><path d="M16 8h2M16 12h2M7 17h10"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    win: '<path d="M3 5l8-1v7H3zM13 4l8-1v8h-8zM3 13h8v7l-8-1zM13 13h8v8l-8-1z"/>',
    net: '<path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1"/>',
    bat: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>',
  };

  // ── Leitura das peças ──
  const RAM_TYPE = { 18: 'DDR', 19: 'DDR2', 24: 'DDR3', 26: 'DDR4', 27: 'LPDDR', 28: 'LPDDR2', 29: 'LPDDR3', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' };
  const RAM_FORM = { 8: 'DIMM', 12: 'SODIMM' };
  // O Windows costuma devolver o código JEDEC do fabricante, ou nada: aí o modelo do pente entrega a marca.
  const RAM_ID = { '029E': 'Corsair', '04CD': 'G.Skill', '0198': 'Kingston', '859B': 'Crucial', '80AD': 'SK hynix', 'AD00': 'SK hynix', '80CE': 'Samsung', 'CE00': 'Samsung', '802C': 'Micron', '2C00': 'Micron', '04CB': 'ADATA', '04EF': 'Team Group' };
  const RAM_PART = [[/^CM/, 'Corsair'], [/^(KF|KHX|KVR|KCP)/, 'Kingston'], [/^F[345]-/, 'G.Skill'], [/^(BL[SETM]?|CT)\d/, 'Crucial'], [/^(HMA|HMC|HMT)/, 'SK hynix'],
    [/^M[34]\d{2}[A-Z]/, 'Samsung'], [/^A[XD][45]/, 'ADATA'], [/^(TF|TED|TLZ)/, 'Team Group'], [/^PV/, 'Patriot']];
  function ramMaker(m) {
    const id = m.maker.toUpperCase().replace(/^0X/, '');
    if (m.maker && !/^[0-9A-F]{4,}$/.test(id)) return m.maker;
    if (RAM_ID[id.slice(0, 4)]) return RAM_ID[id.slice(0, 4)];
    const hit = RAM_PART.find(([re]) => re.test(m.part.toUpperCase()));
    return hit ? hit[1] : '';
  }
  function ram() {
    const mods = st.info.mem.modules;
    // O canal sai do rótulo do banco ("P0 CHANNEL A"), quando a placa-mãe escreve assim.
    const ch = new Set(mods.map((m) => (/CHANNEL\s*([A-Z])/i.exec(`${m.bank} ${m.slot}`) || [])[1]).filter(Boolean).map((c) => c.toUpperCase()));
    return {
      mods, total: mods.reduce((a, m) => a + m.bytes, 0), type: RAM_TYPE[(mods[0] || {}).type] || '',
      speed: Math.max(0, ...mods.map((m) => m.cfg || m.speed)), slots: st.info.mem.slots,
      channels: ch.size ? ({ 1: 'Single channel', 2: 'Dual channel', 3: 'Triple channel', 4: 'Quad channel' }[ch.size] || `${ch.size} canais`) : '',
    };
  }
  const cpuName = (n) => n.replace(/\((R|TM)\)/gi, '').replace(/\s+CPU\s+@.*$/i, '').replace(/\s+\d+-Core Processor$/i, '').replace(/\s+/g, ' ').trim();
  // Versão que a NVIDIA anuncia (617.42) a partir da versão do Windows (32.0.16.1742).
  function gpuDriver(g) {
    if (g.nv && g.nv.driver) return g.nv.driver;
    const d = g.driver.replace(/\./g, '');
    return g.vendor === 'nvidia' && d.length >= 5 ? `${+d.slice(-5, -2)}.${d.slice(-2)}` : g.driver;
  }
  const diskType = (d) => {
    const base = d.bus === 'NVMe' ? 'SSD NVMe' : d.media === 'SSD' ? 'SSD' : d.media === 'HDD' ? 'HD' : d.bus || 'Disco';
    return base === d.bus ? base : d.bus === 'USB' ? `${base} USB` : base === 'SSD' && d.bus === 'SATA' ? 'SSD SATA' : base;
  };
  const HEALTH = { Healthy: ['Saudável', 'good'], Warning: ['Atenção', 'mid'], Unhealthy: ['Com problema', 'bad'] };
  const boardName = (b) => (b.model.toLowerCase().startsWith(b.maker.toLowerCase()) ? b.model : `${b.maker} ${b.model}`.trim());
  const dispRes = (d) => `${d.w} × ${d.h}`;

  // ── Sensores ──
  // Cada sensor tem uma chave, de onde lê (values) e como escreve. O mesmo cadastro alimenta os
  // cartões do modo Simples, as abas e a tabela de sensores.
  function buildDefs() {
    const i = st.info, d = [];
    const hot = (a, b) => (v) => (v < a ? 'good' : v < b ? 'mid' : 'bad');
    const gb1 = (v) => `${nf(v, 1)} GB`;
    d.push({ g: 'cpu', k: 'cpu.usage', label: 'Uso', fmt: pct, bar: (v) => v });
    d.push({ g: 'cpu', k: 'cpu.mhz', label: 'Velocidade média', fmt: ghz });
    d.push({ g: 'cpu', k: 'cpu.maxMhz', label: 'Núcleo mais rápido', fmt: ghz });
    d.push({ g: 'cpu', k: 'cpu.temp', label: 'Temperatura', fmt: temp, tone: hot(75, 90) });
    i.gpus.forEach((g, n) => {
      const p = `gpu${n}.`, total = (all) => all[p + 'memTotal'] || g.vram / 1048576;
      d.push({ g: p, k: p + 'usage', label: 'Uso', fmt: pct, bar: (v) => v });
      d.push({ g: p, k: p + 'temp', label: 'Temperatura', fmt: temp, tone: hot(75, 87) });
      d.push({ g: p, k: p + 'memUsed', label: 'Memória de vídeo em uso', fmt: (v, all) => `${nf(v / 1024, 1)} de ${nf(total(all) / 1024)} GB`, short: (v) => gb1(v / 1024), bar: (v, all) => v / total(all) * 100 });
      d.push({ g: p, k: p + 'power', label: 'Consumo', fmt: (v) => `${nf(v)} W` });
      d.push({ g: p, k: p + 'fan', label: 'Ventoinha', fmt: pct });
      d.push({ g: p, k: p + 'clock', label: 'Clock da GPU', fmt: (v) => `${nf(v)} MHz` });
      d.push({ g: p, k: p + 'memClock', label: 'Clock da memória', fmt: (v) => `${nf(v)} MHz` });
    });
    d.push({ g: 'ram', k: 'ram.used', label: 'Em uso', fmt: (v, all) => `${nf(v / GIB, 1)} de ${nf(all['ram.total'] / GIB, 1)} GB`, short: (v) => gb1(v / GIB), bar: (v, all) => v / all['ram.total'] * 100 });
    i.disks.forEach((x) => d.push({ g: 'disk', k: `disk${x.id}.temp`, label: x.name, fmt: temp, tone: hot(55, 70) }));
    st.defs = d;
  }
  function values() {
    const L = st.live, i = st.info, v = {};
    if (L) {
      Object.assign(v, { 'cpu.usage': L.cpu.usage, 'cpu.mhz': L.cpu.mhz, 'cpu.temp': L.cpu.temp, 'ram.used': L.ram.used, 'ram.total': L.ram.total });
      v['cpu.maxMhz'] = L.cpu.coreMhz.length ? Math.max(...L.cpu.coreMhz) : null;
      i.gpus.forEach((g, n) => {
        const x = L.gpus.find((y) => y.name === g.name);
        if (x) for (const k of ['usage', 'temp', 'memUsed', 'memTotal', 'power', 'fan', 'clock', 'memClock']) v[`gpu${n}.${k}`] = x[k];
      });
    }
    // A temperatura dos discos chega a cada ~10 s; até lá vale a que veio com a ficha.
    i.disks.forEach((d) => { const t = L && L.disks[d.id]; v[`disk${d.id}.temp`] = t != null ? t : d.temp; });
    return v;
  }
  const has = (x) => x != null && Number.isFinite(x);

  function paintLive() {
    if (!st.info) return;
    const v = values(), byKey = {};
    for (const s of st.defs) {
      byKey[s.k] = s;
      if (!has(v[s.k])) continue;
      const r = st.range[s.k] || (st.range[s.k] = { min: v[s.k], max: v[s.k] });
      r.min = Math.min(r.min, v[s.k]); r.max = Math.max(r.max, v[s.k]);
    }
    // Sensor que este PC não tem (ventoinha em notebook, temperatura da CPU em desktop) some
    // depois das primeiras leituras; até lá a linha fica com "--" para a tela não pular.
    const missing = (k) => st.polls >= WARMUP && !st.range[k];
    root.querySelectorAll('[data-l]').forEach((el) => {
      const s = byKey[el.dataset.l], x = v[el.dataset.l], ok = s && has(x);
      el.textContent = ok ? s.fmt(x, v) : '--';
      el.dataset.tone = ok && s.tone ? s.tone(x) : '';
    });
    root.querySelectorAll('[data-b]').forEach((el) => {
      const s = byKey[el.dataset.b], x = v[el.dataset.b];
      el.style.width = (s && has(x) ? Math.max(0, Math.min(100, s.bar(x, v))) : 0) + '%';
    });
    for (const side of ['min', 'max']) {
      root.querySelectorAll(`[data-${side}]`).forEach((el) => {
        const k = el.dataset[side], s = byKey[k], r = st.range[k];
        el.textContent = s && r ? (s.short || s.fmt)(r[side], v) : '--';
      });
    }
    root.querySelectorAll('[data-need]').forEach((el) => { el.hidden = missing(el.dataset.need); });
    root.querySelectorAll('[data-miss]').forEach((el) => { el.hidden = !missing(el.dataset.miss); });
    // Grupo de sensores sem nenhuma linha (a integrada num PC com placa NVIDIA) some junto.
    root.querySelectorAll('.pci-pane.sensors .pci-sec').forEach((sec) => { sec.hidden = ![...sec.querySelectorAll('tbody tr')].some((tr) => !tr.hidden); });
    root.querySelectorAll('[data-since]').forEach((el) => { el.textContent = since(st.info.bootAt); });
    const th = $('pci-threads');
    if (th && st.live) {
      const mhz = st.live.cpu.coreMhz;
      th.innerHTML = st.live.cpu.cores.map((u, n) => `<div class="pci-th"><i style="height:${u}%"></i><span>#${n + 1}</span><b>${u}%</b>${mhz[n] ? `<small>${ghz(mhz[n])}</small>` : ''}</div>`).join('');
    }
  }

  // ── Modo Simples ──
  const card = (ic, kind, name, facts, body, cls) => `<section class="pci-card${cls ? ' ' + cls : ''}">
      <div class="pci-card-hd"><span class="pci-ic">${svg(IC[ic])}</span><div class="pci-card-t"><div class="pci-kind">${kind}</div><div class="pci-name">${esc(name)}</div></div></div>
      ${facts.filter(Boolean).length ? `<div class="pci-facts">${facts.filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      ${body || ''}</section>`;
  const meter = (k, label, bar) => `<div class="pci-meter" data-need="${k}"><div class="pci-meter-top"><span>${label}</span><b data-l="${k}">--</b></div>${bar ? `<div class="pci-bar"><i data-b="${k}"></i></div>` : ''}</div>`;
  const meters = (list) => `<div class="pci-meters">${list.join('')}</div>`;
  const row = (badge, name, meta, tail) => `<div class="pci-row">${badge ? `<span class="pci-badge">${esc(badge)}</span>` : ''}<span class="pci-row-name">${esc(name)}</span><span class="pci-row-meta">${esc(meta)}</span>${tail || ''}</div>`;

  function renderSimple() {
    const i = st.info, c = i.cpu, b = i.board, r = ram(), g = i.gpus[0];
    const same = r.mods.length && r.mods.every((m) => m.bytes === r.mods[0].bytes);
    const cards = [];
    cards.push(card('cpu', 'Processador', cpuName(c.name) || 'Não detectado',
      [c.cores && `${c.cores} núcleos e ${c.threads} threads`, c.maxMhz && `${ghz(c.maxMhz)} de base`, c.socket && `soquete ${c.socket}`],
      meters([meter('cpu.usage', 'Uso', true), meter('cpu.mhz', 'Velocidade agora'), meter('cpu.temp', 'Temperatura')])
        + '<div class="pci-hint" data-miss="cpu.temp" hidden>Temperatura do processador: o Windows só informa em alguns notebooks.</div>'));
    if (g) {
      const others = i.gpus.slice(1).map((x) => `${x.name}${x.integrated ? ' (integrada)' : ''}`);
      cards.push(card('gpu', 'Placa de vídeo', g.name,
        [g.vram && `${vramSize(g.vram)} de memória de vídeo`, g.driver && `driver ${gpuDriver(g)}${g.driverDate ? ' de ' + date(g.driverDate) : ''}`, g.integrated && 'integrada ao processador'],
        meters([meter('gpu0.usage', 'Uso', true), meter('gpu0.memUsed', 'Memória de vídeo', true), meter('gpu0.temp', 'Temperatura'), meter('gpu0.power', 'Consumo'), meter('gpu0.fan', 'Ventoinha')])
          + (others.length ? `<div class="pci-hint">Também neste PC: ${esc(others.join(', '))}.</div>` : '')));
    } else cards.push(card('gpu', 'Placa de vídeo', 'Não detectada', []));
    cards.push(card('ram', 'Memória RAM', r.total ? `${ramSize(r.total)} ${r.type}`.trim() : 'Não detectada',
      [r.mods.length && (same ? `${r.mods.length} ${r.mods.length > 1 ? 'pentes' : 'pente'} de ${ramSize(r.mods[0].bytes)}` : `${r.mods.length} pentes`),
        r.speed && `${nf(r.speed)} MT/s`, r.channels.toLowerCase(), r.slots && `${r.mods.length} de ${r.slots} slots`],
      meters([meter('ram.used', 'Em uso', true)])));

    const disks = i.disks.map((d) => {
      const h = HEALTH[d.health];
      return row(diskType(d), d.name, [diskSize(d.bytes), d.letters.join(' ')].filter(Boolean).join(' · '),
        `<b class="pci-row-val" data-l="disk${d.id}.temp">--</b>${h ? `<span class="pci-health" data-tone="${h[1]}">${h[0]}</span>` : ''}`);
    }).join('');
    const vols = i.vols.map((v) => {
      const used = v.bytes ? (1 - v.free / v.bytes) * 100 : 0;
      return `<div class="pci-vol"><div class="pci-meter-top"><span><b>${esc(v.letter)}</b> ${esc(v.label)}</span><span>${volSize(v.free)} livres de ${volSize(v.bytes)}</span></div>
        <div class="pci-bar" data-tone="${used > 90 ? 'bad' : used > 80 ? 'mid' : ''}"><i style="width:${used.toFixed(1)}%"></i></div></div>`;
    }).join('');
    cards.push(card('disk', 'Armazenamento', `${i.disks.length} ${i.disks.length === 1 ? 'disco' : 'discos'}`, [],
      `<div class="pci-split"><div><div class="pci-sub">Discos</div><div class="pci-rows">${disks}</div></div><div><div class="pci-sub">Espaço livre</div><div class="pci-vols">${vols}</div></div></div>`, 'wide'));

    const laptop = !!i.battery && b.sysModel;
    cards.push(card('board', laptop ? 'Notebook' : 'Placa-mãe', (laptop ? `${b.sysMaker} ${b.sysModel}`.trim() : boardName(b)) || 'Não detectada',
      [b.biosVersion && `BIOS ${b.biosVersion}${b.biosDate ? ' de ' + date(b.biosDate) : ''}`, b.secureBoot === true ? 'Secure Boot ligado' : b.secureBoot === false ? 'Secure Boot desligado' : '', b.tpm && `TPM ${b.tpm}`]));
    cards.push(card('screen', i.displays.length > 1 ? 'Telas' : 'Tela', i.displays.length > 1 ? `${i.displays.length} monitores` : (i.displays[0] || {}).name || 'Não detectada', [],
      `<div class="pci-rows">${i.displays.map((d) => row(d.primary && i.displays.length > 1 ? 'Principal' : '', d.name, [dispRes(d), d.hz && `${d.hz} Hz`, d.inches && `${nf(d.inches, 1)}″`].filter(Boolean).join(' · '))).join('')}</div>`));
    cards.push(card('win', 'Sistema', `${i.win.name} ${i.win.display}`.trim() || 'Windows',
      [i.win.build && `build ${i.win.build}`, i.win.arch, i.win.installed && `instalado em ${date(i.win.installed)}`],
      `<div class="pci-meters"><div class="pci-meter"><div class="pci-meter-top"><span>Ligado há</span><b data-since>${since(i.bootAt)}</b></div></div></div>`));
    if (i.nets.length) {
      cards.push(card('net', 'Rede', `${i.nets[0].name}${i.nets[0].speed ? ' a ' + netSpeed(i.nets[0].speed) : ''}`, [],
        `<div class="pci-rows">${i.nets.map((n) => row('', n.desc, [n.name, n.speed && netSpeed(n.speed)].filter(Boolean).join(' · '))).join('')}</div>`));
    }
    if (i.battery) {
      const bt = i.battery, health = bt.design && bt.full ? Math.min(100, Math.round(bt.full / bt.design * 100)) : 0;
      cards.push(card('bat', 'Bateria', health ? `${health}% da capacidade original` : bt.name || 'Bateria', [bt.cycles && `${nf(bt.cycles)} ciclos`]));
    }
    root.innerHTML = `<div class="pci-grid">${cards.join('')}</div>
      <div class="op-foot">Quer saber se driver, BIOS e memória estão configurados certo? Veja <a href="#" data-go="hardware">Verificar hardware</a>. Para cache, instruções, clock de cada thread e mínimo/máximo dos sensores, mude para <a href="#" data-mode-link="advanced">Avançado</a>.</div>`;
  }

  // ── Modo Avançado ──
  // Um cadastro só para a tela e para o relatório em texto. Valor: texto, { l } sensor ao vivo,
  // { min } / { max } do sensor ou { since } (tempo ligado). Linha sem valor não aparece.
  function tabsData() {
    const i = st.info, c = i.cpu, b = i.board, r = ram();
    const L = (k) => ({ l: k }), n = (v) => (v ? String(v) : '');
    const cache = (kb) => (kb >= 1024 ? `${nf(kb / 1024, kb % 1024 ? 1 : 0)} MB` : kb ? `${nf(kb)} KB` : '');
    const liveRows = (p, keys) => keys.map(([k, label]) => ({ need: p + k, cells: [label, L(p + k)] }));
    const tabs = [];
    tabs.push({ id: 'cpu', name: 'Processador', sections: [
      { title: 'Processador', rows: [
        ['Nome', c.name], ['Fabricante', c.vendor], ['Soquete', c.socket], ['Núcleos', n(c.cores)], ['Threads', n(c.threads)],
        ['Frequência base', c.maxMhz ? ghz(c.maxMhz) : ''],
        ['Família', c.family != null ? `${c.family} (${hex(c.family)}h)` : ''], ['Modelo', c.model != null ? `${c.model} (${hex(c.model)}h)` : ''],
        ['Stepping', c.stepping != null ? String(c.stepping) : ''], ['Microcode', c.microcode ? `0x${hex(c.microcode)}` : ''],
        ['Virtualização', c.virt ? 'Ligada' : 'Desligada na BIOS'],
      ] },
      { title: 'Cache (soma dos núcleos)', rows: [['L1', cache(c.cache.l1)], ['L2', cache(c.cache.l2)], ['L3', cache(c.cache.l3)]] },
      { title: 'Instruções', chips: c.features },
      { title: 'Agora', rows: liveRows('cpu.', [['usage', 'Uso'], ['mhz', 'Velocidade média'], ['maxMhz', 'Núcleo mais rápido'], ['temp', 'Temperatura']]), threads: true },
    ] });
    tabs.push({ id: 'board', name: 'Placa-mãe', sections: [
      { title: 'Placa-mãe', rows: [['Fabricante', b.maker], ['Modelo', b.model], ['Versão', b.version]] },
      { title: 'BIOS', rows: [['Fabricante', b.biosVendor], ['Versão', b.biosVersion], ['Data', date(b.biosDate)], ['Modo de boot', b.uefi ? 'UEFI' : 'Legacy (CSM)'],
        ['Secure Boot', b.secureBoot === null ? '' : b.secureBoot ? 'Ligado' : 'Desligado'], ['TPM', b.tpm]] },
      { title: 'Computador', rows: b.sysModel && b.sysModel !== b.model ? [['Fabricante', b.sysMaker], ['Modelo', b.sysModel]] : [] },
    ] });
    tabs.push({ id: 'mem', name: 'Memória', sections: [
      { title: 'Resumo', rows: [['Total', r.total ? ramSize(r.total) : ''], ['Tipo', r.type], ['Velocidade atual', r.speed ? `${nf(r.speed)} MT/s` : ''], ['Canais', r.channels],
        ['Slots usados', r.slots ? `${r.mods.length} de ${r.slots}` : n(r.mods.length)], { need: 'ram.used', cells: ['Em uso', L('ram.used')] }] },
      { title: 'Pentes', table: { head: ['Slot', 'Tamanho', 'Tipo', 'Velocidade atual', 'De fábrica (JEDEC)', 'Fabricante', 'Modelo'],
        rows: r.mods.map((m) => [[m.bank, m.slot].filter(Boolean).join(' · '), ramSize(m.bytes), [RAM_TYPE[m.type], RAM_FORM[m.form]].filter(Boolean).join(' '),
          m.cfg ? `${nf(m.cfg)} MT/s` : '', m.speed ? `${nf(m.speed)} MT/s` : '', ramMaker(m), m.part]) },
        note: 'Latências (CL) e tensão não aparecem: só dá para ler com driver de kernel, que o L não instala por causa dos anticheats.' },
    ] });
    tabs.push({ id: 'gpu', name: 'Vídeo', sections: [
      ...i.gpus.map((g, k) => ({ title: g.name, rows: [
        ['Fabricante', g.maker], ['Tipo', g.integrated ? 'Integrada ao processador' : 'Dedicada'], ['Memória de vídeo', g.vram ? vramSize(g.vram) : ''],
        ['Driver', gpuDriver(g) !== g.driver ? `${gpuDriver(g)} (${g.driver})` : g.driver], ['Data do driver', date(g.driverDate)],
        ['VBIOS', g.nv ? g.nv.vbios : ''], ['Barramento', g.nv ? g.nv.pcie : ''], ['Limite de consumo', g.nv && g.nv.powerLimit ? `${g.nv.powerLimit} W` : ''],
        ['ID do dispositivo', g.device ? `DEV ${g.device}${g.subsys ? ' · SUBSYS ' + g.subsys : ''}` : ''],
        ...liveRows(`gpu${k}.`, [['usage', 'Uso'], ['temp', 'Temperatura'], ['memUsed', 'Memória em uso'], ['power', 'Consumo'], ['fan', 'Ventoinha'], ['clock', 'Clock da GPU'], ['memClock', 'Clock da memória']]),
      ] })),
      { title: 'Telas', table: { head: ['Tela', 'Resolução', 'Atualização', 'Tamanho', 'Escala', 'Cores', 'Fabricação'],
        rows: i.displays.map((d) => [d.name + (d.primary && i.displays.length > 1 ? ' (principal)' : ''), dispRes(d), d.hz ? `${d.hz} Hz` : '', d.inches ? `${nf(d.inches, 1)}″` : '',
          `${d.scale}%`, d.depth ? `${d.depth} bits` : '', n(d.year)]) } },
    ] });
    tabs.push({ id: 'disk', name: 'Armazenamento', sections: [
      { title: 'Discos', table: { head: ['Disco', 'Tipo', 'Tamanho', 'Temperatura', 'Saúde', 'Desgaste', 'Horas ligado', 'Firmware', 'Unidades'],
        rows: i.disks.map((d) => [d.name, diskType(d), diskSize(d.bytes), L(`disk${d.id}.temp`), (HEALTH[d.health] || [d.health])[0], d.wear != null && d.media === 'SSD' ? `${d.wear}%` : '', // HD responde 0 sempre: não é dado
          d.hours != null ? `${nf(d.hours)} h` : '', d.fw, d.letters.join(' ')]) } },
      { title: 'Unidades', table: { head: ['Unidade', 'Nome', 'Sistema', 'Tamanho', 'Livre', 'Ocupado'],
        rows: i.vols.map((v) => [v.letter, v.label, v.fs, volSize(v.bytes), volSize(v.free), v.bytes ? pct((1 - v.free / v.bytes) * 100) : '']) } },
    ] });
    const bt = i.battery;
    tabs.push({ id: 'sys', name: 'Sistema', sections: [
      { title: 'Windows', rows: [['Edição', i.win.name], ['Versão', i.win.display], ['Build', i.win.build], ['Arquitetura', i.win.arch], ['Instalado em', date(i.win.installed)], ['Ligado há', { since: true }]] },
      { title: 'Rede', table: { head: ['Conexão', 'Adaptador', 'Velocidade', 'Tipo', 'Driver'], rows: i.nets.map((x) => [x.name, x.desc, x.speed ? netSpeed(x.speed) : '', x.media, x.driver]) } },
      { title: 'Bateria', rows: bt ? [['Modelo', bt.name], ['Capacidade de fábrica', bt.design ? `${nf(bt.design)} mWh` : ''], ['Capacidade atual', bt.full ? `${nf(bt.full)} mWh` : ''],
        ['Saúde', bt.design && bt.full ? pct(Math.min(100, bt.full / bt.design * 100)) : ''], ['Ciclos', n(bt.cycles)]] : [] },
    ] });
    const group = (title, g) => ({ title, table: { head: ['Sensor', 'Agora', 'Mínimo', 'Máximo'],
      rows: st.defs.filter((s) => s.g === g).map((s) => ({ need: s.k, cells: [s.label, L(s.k), { min: s.k }, { max: s.k }] })) } });
    tabs.push({ id: 'sensors', name: 'Sensores', sensors: true, sections: [
      group(cpuName(c.name) || 'Processador', 'cpu'), ...i.gpus.map((g, k) => group(g.name, `gpu${k}.`)), group('Memória RAM', 'ram'), group('Temperatura dos discos', 'disk'),
    ] });
    return tabs;
  }
  const cells = (r) => (Array.isArray(r) ? r : r.cells);
  const filled = (v) => (v && typeof v === 'object') || !!v;
  // Seção sem nenhuma linha preenchida (bateria em desktop, rede sem cabo) não aparece.
  const hasContent = (sec) => !!(sec.chips && sec.chips.length) || !!(sec.rows && sec.rows.some((r) => filled(cells(r)[1]))) || !!(sec.table && sec.table.rows.length);

  function cellHtml(v) {
    if (v && typeof v === 'object') {
      if (v.l) return `<span class="pci-live" data-l="${v.l}">--</span>`;
      if (v.min) return `<span data-min="${v.min}">--</span>`;
      if (v.max) return `<span data-max="${v.max}">--</span>`;
      if (v.since) return `<span data-since>${since(st.info.bootAt)}</span>`;
    }
    return esc(v);
  }
  function sectionHtml(sec) {
    let h = `<div class="pci-sec"><div class="pci-sec-t">${esc(sec.title)}</div>`;
    if (sec.rows) {
      h += `<dl class="pci-kv">${sec.rows.filter((r) => filled(cells(r)[1])).map((r) => `<div${r.need ? ` data-need="${r.need}"` : ''}><dt>${esc(cells(r)[0])}</dt><dd>${cellHtml(cells(r)[1])}</dd></div>`).join('')}</dl>`;
    }
    if (sec.chips) h += `<div class="pci-chips">${sec.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
    if (sec.threads) h += '<div class="pci-sub">Uso e velocidade de cada thread</div><div class="pci-threads" id="pci-threads"></div>';
    if (sec.table) {
      h += `<div class="pci-tbl-wrap"><table class="pci-tbl"><thead><tr>${sec.table.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${
        sec.table.rows.map((r) => `<tr${r.need ? ` data-need="${r.need}"` : ''}>${cells(r).map((c) => `<td>${cellHtml(c) || '<span class="pci-nil">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (sec.note) h += `<div class="pci-hint">${esc(sec.note)}</div>`;
    return h + '</div>';
  }

  function renderAdvanced() {
    const tabs = tabsData();
    const tab = tabs.find((t) => t.id === st.tab) || tabs[0];
    st.tab = tab.id;
    root.innerHTML = `<div class="pci-tabs" role="tablist">${tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === tab.id}" class="${t.id === tab.id ? 'on' : ''}">${t.name}</button>`).join('')}</div>
      <div class="pci-pane${tab.sensors ? ' sensors' : ''}">${tab.sensors ? `<div class="pci-sens-bar"><span>Mínimo e máximo valem enquanto esta página esteve aberta. Deixe-a aberta, jogue e volte para ver o pico.</span><button class="ghost-btn" data-reset>Zerar mín. e máx.</button></div>` : ''}
        ${tab.sections.filter(hasContent).map(sectionHtml).join('')}
        ${tab.sensors ? '<div class="pci-hint">O L não instala driver de kernel, porque os anticheats barram. Por isso ficam de fora o que só sai por ele: tensões, RPM das ventoinhas, temperatura do processador em desktop e as latências da memória.</div>' : ''}</div>`;
  }

  // ── Relatório em texto (para colar no Discord ou mandar ao suporte) ──
  function report() {
    const v = values(), byKey = Object.fromEntries(st.defs.map((s) => [s.k, s]));
    const text = (c) => {
      if (c && typeof c === 'object') {
        if (c.since) return since(st.info.bootAt);
        const k = c.l || c.min || c.max, s = byKey[k], x = c.l ? v[k] : (st.range[k] || {})[c.min ? 'min' : 'max'];
        return s && has(x) ? (c.l ? s.fmt(x, v) : (s.short || s.fmt)(x, v)) : '';
      }
      return String(c || '');
    };
    const out = [`VL Optimizer · Informações do PC · ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`];
    for (const tab of tabsData()) {
      const secs = tab.sections.filter(hasContent);
      if (!secs.length) continue;
      out.push('', `== ${tab.name} ==`);
      for (const sec of secs) {
        const lines = [];
        for (const r of sec.rows || []) { const t = text(cells(r)[1]); if (t) lines.push(`${cells(r)[0]}: ${t}`); }
        if (sec.chips) lines.push(sec.chips.join(', '));
        if (sec.table) {
          for (const r of sec.table.rows) {
            const parts = cells(r).map((c, n) => [sec.table.head[n], text(c)]).filter((p) => p[1]);
            if (parts.length > 1) lines.push(parts.map((p, n) => (n ? `${p[0]} ${p[1]}` : p[1])).join(' | '));
          }
        }
        // grupo de sensores que este PC não tem fica sem linha: não entra
        if (lines.length) out.push(`[${sec.title}]`, ...lines);
      }
    }
    return out.join('\n');
  }

  // ── Página ──
  function render() {
    const mode = $('pci-mode');
    if (mode) mode.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === st.mode); b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
    if ($('pci-copy')) $('pci-copy').disabled = !st.info;
    if ($('pci-refresh')) $('pci-refresh').disabled = st.loading;
    if (!st.info) {
      root.innerHTML = st.error ? `<div class="tw-empty">${esc(st.error)}</div>` : '<div class="tw-loading">Lendo as peças deste PC…</div>';
      return;
    }
    if (st.mode === 'advanced') renderAdvanced(); else renderSimple();
    paintLive();
  }
  function setMode(m) {
    st.mode = m === 'advanced' ? 'advanced' : 'simple';
    try { localStorage.setItem('gdz-pcinfo-mode', st.mode); } catch (e) {}
    render();
  }

  async function load(force) {
    if (st.loading) return;
    st.loading = true; st.error = '';
    if (force) st.info = null;
    render();
    let r = null;
    try { r = await ipcRenderer.invoke('pcinfo-get', { force: !!force }); } catch (e) {}
    st.loading = false;
    if (r && r.success && r.info) { st.info = r.info; buildDefs(); } else st.error = (r && r.error) || 'Não foi possível ler as informações deste PC.';
    render();
    poll();
  }
  async function poll() {
    if (!$('pg-pcinfo').classList.contains('active')) { stop(); return; }
    if (!st.info) return;
    try {
      const r = await ipcRenderer.invoke('pcinfo-live');
      if (r && r.success) { st.live = r; st.polls++; paintLive(); }
    } catch (e) {}
  }
  function start() {
    clearInterval(st.timer);
    st.timer = setInterval(poll, POLL_MS);
    if (st.info) { render(); poll(); } else load(false);
  }
  function stop() { clearInterval(st.timer); st.timer = null; }

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; render(); return; }
    if (e.target.closest('[data-reset]')) { st.range = {}; paintLive(); return; }
    const link = e.target.closest('a[data-go], a[data-mode-link]');
    if (!link) return;
    e.preventDefault();
    if (link.dataset.go) goTo(link.dataset.go); else setMode(link.dataset.modeLink);
  });
  if ($('pci-mode')) $('pci-mode').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  if ($('pci-refresh')) $('pci-refresh').addEventListener('click', () => load(true));
  if ($('pci-copy')) {
    $('pci-copy').addEventListener('click', async () => {
      if (!st.info) return;
      try { await navigator.clipboard.writeText(report()); toast('Relatório copiado. É só colar no Discord ou no suporte.'); }
      catch (e) { toast('Não foi possível copiar o relatório.'); }
    });
  }

  const baseGo = window.go;
  window.go = function (pg, el) {
    baseGo(pg, el);
    if (pg === 'pcinfo') start(); else stop();
  };
})();
