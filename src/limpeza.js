// Página Limpeza: limpeza de arquivos (navegadores, apps e Windows) e o que ocupa cada disco.
// O main.js diz quanto dá para limpar ('clean-scan'), limpa ('clean-run') e lê o disco em segundo
// plano ('disk-scan' + 'disk-scan-status'). Os ajustes de espaço do Windows ficam embaixo, em
// #opt-limpeza, desenhados pelo otimizacoes.js. Usa ipcRenderer, toast(), addRecent(), go() e loadRecs() do dashboard.
(function () {
  const $ = (id) => document.getElementById(id);
  const page = $('pg-limpeza');
  if (!page) return;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // nomes de pasta e arquivo: nunca como HTML
    return e;
  };
  const icon = (inner, size = 15) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.9');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = inner;
    return s;
  };
  const IC = {
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  };
  const invoke = async (ch, arg) => { try { return await ipcRenderer.invoke(ch, arg); } catch (e) { return { success: false, error: e.message }; } };
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  function size(b) {
    if (!(b > 0)) return '0 MB';
    for (const [u, v] of [['TB', 1024 ** 4], ['GB', 1024 ** 3], ['MB', 1024 ** 2]]) {
      if (b >= v) return (b / v).toLocaleString('pt-BR', { maximumFractionDigits: b / v >= 100 ? 0 : 1 }) + ' ' + u;
    }
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }

  // ── Limpeza de arquivos ──
  const GROUPS = [
    { id: 'win', name: 'Windows' },
    { id: 'web', name: 'Navegadores', blurb: 'Só o cache. Logins, senhas, histórico e favoritos ficam.' },
    { id: 'apps', name: 'Apps e jogos' },
  ];
  const cl = { cats: null, sel: new Set(), done: new Map(), busy: false, error: null, measure: null, polling: false };
  const list = $('cl-list'), total = $('cl-total'), goBtn = $('cl-go'), rescanBtn = $('cl-rescan');
  const usable = (c) => !c.open && c.bytes > 0;

  async function scan() {
    if (cl.busy) return;
    cl.busy = true;
    paintFoot();
    if (!cl.cats) list.replaceChildren(el('div', 'tw-loading', 'Procurando o que dá para limpar…'));
    else list.classList.add('cl-dim');
    const r = await invoke('clean-scan');
    cl.busy = false;
    list.classList.remove('cl-dim');
    if (!r || !r.success) {
      cl.error = (r && r.error) || 'Não foi possível analisar agora.';
      if (!cl.cats) list.replaceChildren(el('div', 'tw-empty', cl.error));
      else toast(cl.error);
      paintFoot();
      return;
    }
    const first = !cl.cats;
    cl.cats = r.cats;
    cl.done.clear();
    cl.measure = { measuring: !!r.measuring, index: r.index || 0, total: r.total || r.cats.length };
    if (r.measuring) pollMeasure();
    // seleção: a padrão de cada item na primeira vez; depois, a escolha da pessoa (menos o que não dá)
    if (first) cl.sel = new Set(r.cats.filter(c => c.on && usable(c)).map(c => c.id));
    else cl.sel = new Set([...cl.sel].filter(id => { const c = r.cats.find(x => x.id === id); return c && usable(c); }));
    render();
  }

  async function pollMeasure() {
    if (cl.polling) return;
    cl.polling = true;
    while (cl.polling) {
      await new Promise((r) => setTimeout(r, 800));
      const st = await invoke('clean-status');
      if (!st || !st.success) continue;
      cl.cats = st.cats;
      cl.measure = { measuring: !!st.measuring, index: st.index || 0, total: st.total || st.cats.length };
      const usableNow = st.cats.filter((c) => !c.open && c.bytes > 0);
      if (!st.measuring) {
        if (!cl.sel.size) cl.sel = new Set(usableNow.filter((c) => c.on).map((c) => c.id));
        else cl.sel = new Set([...cl.sel].filter((id) => usableNow.some((c) => c.id === id)));
      }
      render();
      if (!st.measuring) { cl.polling = false; break; }
    }
    cl.polling = false;
  }

  function render() {
    const parts = [];
    for (const g of GROUPS) {
      const cats = cl.cats.filter(c => c.group === g.id);
      if (!cats.length) continue;
      const box = el('div', 'cl-group');
      const hdr = el('div', 'cl-group-hdr');
      hdr.append(el('span', 'cl-group-name', g.name));
      if (g.blurb) hdr.append(el('span', 'cl-group-blurb', g.blurb));
      box.append(hdr, ...cats.map(row));
      parts.push(box);
    }
    if (!parts.length) parts.push(el('div', 'tw-empty', 'Nada para limpar agora.'));
    list.replaceChildren(...parts);
    paintFoot();
  }

  function row(c) {
    const done = cl.done.get(c.id);
    const r = el('label', 'cl-row');
    r.dataset.id = c.id;
    const box = el('input', 'cl-check');
    box.type = 'checkbox';
    box.checked = cl.sel.has(c.id);
    box.disabled = !usable(c) || !!done || cl.busy;
    box.onchange = () => { if (box.checked) cl.sel.add(c.id); else cl.sel.delete(c.id); paintFoot(); };
    const main = el('div', 'cl-main');
    main.append(el('div', 'cl-name', c.name), el('div', 'cl-desc', c.desc));
    if (c.open && !done) main.append(el('div', 'cl-why', `Feche ${c.app || 'o programa'} e analise de novo para limpar.`));
    if (c.note && (c.id !== 'edge' || c.open)) main.append(el('div', 'cl-note', c.note));
    const sz = el('div', 'cl-size');
    if (done) {
      sz.classList.add('ok');
      sz.textContent = done.open ? 'Estava aberto' : done.freed > 0 ? `${size(done.freed)} liberados` : 'Nada saiu';
      if (done.failed > 0) main.append(el('div', 'cl-why', `${num(done.failed)} ${done.failed === 1 ? 'arquivo em uso ficou' : 'arquivos em uso ficaram'}.`));
    } else if (!c.measured && cl.measure && cl.measure.measuring) {
      sz.classList.add('none');
      sz.textContent = 'Medindo…';
    } else if (c.bytes > 0) {
      sz.textContent = size(c.bytes);
      sz.title = `${num(c.files)} ${c.files === 1 ? 'arquivo' : 'arquivos'}`;
    } else {
      sz.classList.add('none');
      sz.textContent = 'Nada para limpar';
    }
    r.classList.toggle('is-off', !usable(c) && !done);
    r.append(box, main, sz);
    return r;
  }

  function selected() { return (cl.cats || []).filter(c => cl.sel.has(c.id) && usable(c) && !cl.done.has(c.id)); }
  function paintFoot() {
    const sel = selected();
    const bytes = sel.reduce((t, c) => t + c.bytes, 0);
    const freed = [...cl.done.values()].reduce((t, d) => t + d.freed, 0);
    total.replaceChildren();
    if (cl.done.size) total.append(el('b', 'ok', size(freed)), el('span', null, 'liberados agora'));
    else if (cl.cats) total.append(el('b', null, size(bytes)), el('span', null, sel.length ? `em ${sel.length} ${sel.length === 1 ? 'item' : 'itens'}` : 'nada selecionado'));
    if (cl.measure && cl.measure.measuring) total.append(el('span', 'cl-measuring', ` · medindo ${cl.measure.index}/${cl.measure.total}…`));
    goBtn.disabled = cl.busy || !bytes;
    goBtn.textContent = cl.busy && goBtn.dataset.running ? 'Limpando…' : bytes ? `Limpar ${size(bytes)}` : 'Limpar';
    rescanBtn.disabled = cl.busy;
    rescanBtn.textContent = cl.busy && !goBtn.dataset.running ? 'Analisando…' : 'Analisar de novo';
  }

  async function clean() {
    const sel = selected();
    if (!sel.length || cl.busy) return;
    if (sel.some(c => c.id === 'recycle') && !confirm('Esvaziar a Lixeira?\n\nDepois disso não dá para recuperar os arquivos que estão nela.')) return;
    cl.busy = true;
    goBtn.dataset.running = '1';
    list.querySelectorAll('.cl-check').forEach(b => { b.disabled = true; });
    sel.forEach(c => { const s = list.querySelector(`.cl-row[data-id="${CSS.escape(c.id)}"] .cl-size`); if (s) { s.textContent = 'Limpando…'; s.classList.add('busy'); } });
    paintFoot();
    const r = await invoke('clean-run', { ids: sel.map(c => c.id) });
    cl.busy = false;
    delete goBtn.dataset.running;
    if (!r || !r.success) { toast(`Limpeza: ${(r && r.error) || 'não foi possível concluir.'}`); render(); return; }
    r.results.forEach(x => { cl.done.set(x.id, x); cl.sel.delete(x.id); });
    render();
    const open = r.results.filter(x => x.open).length;
    toast(`Limpeza: ${size(r.freed)} liberados.` + (open ? ` ${open} ${open === 1 ? 'app abriu' : 'apps abriram'} no meio e ${open === 1 ? 'ficou' : 'ficaram'} de fora.` : ''));
    if (typeof addRecent === 'function') addRecent(`Limpeza de arquivos: ${size(r.freed)}`, { page: 'limpeza', el: page.querySelector('.lp-card') });
    if (r.results.some(x => x.id === 'temp') && typeof loadRecs === 'function') loadRecs();
    if (dk.drives) loadDrives(); // o espaço livre dos discos mudou
  }

  goBtn.onclick = clean;
  rescanBtn.onclick = () => scan();
  $('cl-games').onclick = (e) => { e.preventDefault(); if (typeof goTo === 'function') goTo('jogos'); };

  // ── O que ocupa o disco ──
  const dk = { drives: null, system: 'C:', sel: null, st: null, result: null, byId: null, kids: null, cur: 0, tab: 'dirs', poll: null };
  const drivesBox = $('dk-drives'), body = $('dk-body');

  // Explicação dos itens que mais confundem quem olha o disco.
  const HINTS = [
    [/^[a-z]:\\windows\\winsxs$/i, 'Arquivos do próprio Windows. Parece maior do que é: muitos arquivos daqui também aparecem em outras pastas. Para diminuir com segurança, use "Limpar sobras do Windows Update" no fim desta página.'],
    [/^[a-z]:\\windows\\installer$/i, 'Instaladores que o Windows usa para atualizar e desinstalar programas. Não apague à mão.'],
    [/^[a-z]:\\windows\.old$/i, 'A versão anterior do Windows, guardada depois de uma atualização grande. Para apagar: Configurações > Sistema > Armazenamento > Arquivos temporários > Instalações anteriores do Windows.'],
    [/^[a-z]:\\windows\\softwaredistribution$/i, 'Downloads do Windows Update. O próprio Windows apaga o que não precisa mais.'],
    [/^[a-z]:\\hiberfil\.sys$/i, 'Arquivo da hibernação, do tamanho de boa parte da sua RAM. Some se você desligar a hibernação no fim desta página.'],
    [/^[a-z]:\\pagefile\.sys$/i, 'Memória virtual do Windows. Não apague: jogos pesados fecham sem ela.'],
    [/^[a-z]:\\swapfile\.sys$/i, 'Usado pelos apps da Microsoft Store. É do Windows.'],
    [/^[a-z]:\\\$recycle\.bin$/i, 'A Lixeira. Dá para esvaziar na limpeza aqui em cima.'],
    [/\\appdata\\local\\temp$/i, 'Arquivos temporários. A limpeza aqui em cima apaga os que têm mais de 1 dia.'],
    [/\\steamapps\\common$/i, 'Jogos da Steam. Para tirar um, desinstale pela Steam.'],
    [/\\fivem\\fivem\.app\\data\\(server-cache|server-cache-priv|cache)$/i, 'Cache dos servidores do FiveM. Se precisar, limpe em Meus jogos (o FiveM baixa de novo ao entrar).'],
    [/\\appdata\\local\\(nvidia|d3dscache|amd)$/i, 'Cache de shaders da placa de vídeo. Se precisar, limpe em Meus jogos.'],
  ];
  const hintFor = (p) => (HINTS.find(([re]) => re.test(p)) || [])[1] || '';

  async function loadDrives() {
    const r = await invoke('disk-drives');
    if (!r || !r.success) { drivesBox.replaceChildren(el('div', 'tw-empty', (r && r.error) || 'Não foi possível ler os discos.')); return; }
    dk.drives = r.drives;
    dk.system = r.system || 'C:';
    if (!dk.sel || !dk.drives.some(d => d.name === dk.sel)) dk.sel = (dk.drives.find(d => d.name === dk.system) || dk.drives[0] || {}).name || null;
    paintDrives();
  }

  function paintDrives() {
    const running = dk.st && dk.st.state === 'running';
    drivesBox.replaceChildren(...(dk.drives || []).map(d => {
      const used = Math.max(0, d.total - d.free), pct = d.total ? used / d.total * 100 : 0;
      const b = el('button', 'dk-drive' + (d.name === dk.sel ? ' active' : '') + (pct >= 90 ? ' full' : ''));
      b.type = 'button';
      b.disabled = running && d.name !== dk.sel;
      const top = el('div', 'dk-drive-top');
      top.append(el('b', null, d.name), el('span', null, d.label || (d.name === dk.system ? 'Windows' : 'Disco local')));
      const bar = el('div', 'dk-drive-bar');
      const fill = el('i');
      fill.style.width = pct.toFixed(1) + '%';
      bar.append(fill);
      b.append(top, bar, el('div', 'dk-drive-free', `${size(d.free)} livres de ${size(d.total)}`));
      b.onclick = () => { if (dk.sel === d.name) return; dk.sel = d.name; paintDrives(); paintBody(); };
      return b;
    }));
  }

  async function startScan() {
    if (!dk.sel) return;
    const r = await invoke('disk-scan', { drive: dk.sel });
    if (!r || !r.success) { toast((r && r.error) || 'Não foi possível ler o disco.'); return; }
    dk.st = { state: 'running', drive: dk.sel, files: 0, bytes: 0 };
    paintDrives();
    paintBody();
    pollScan();
  }
  function pollScan() {
    clearTimeout(dk.poll);
    dk.poll = setTimeout(async () => {
      const st = await invoke('disk-scan-status');
      if (!st || st.success === false) { pollScan(); return; }
      applyStatus(st);
      if (st.state === 'running') pollScan();
      else {
        paintDrives();
        if (st.state === 'done' && typeof addRecent === 'function') addRecent(`Disco ${st.drive} analisado`, { page: 'limpeza', el: body });
      }
    }, 700);
  }
  function applyStatus(st) {
    dk.st = st;
    if (st.state === 'done' && st.result && (!dk.result || dk.result.at !== st.result.at)) {
      dk.result = st.result;
      dk.byId = new Map(st.result.nodes.map(n => [n[0], n]));
      dk.kids = new Map();
      for (const n of st.result.nodes) {
        if (n[1] < 0) continue;
        if (!dk.kids.has(n[1])) dk.kids.set(n[1], []);
        dk.kids.get(n[1]).push(n);
      }
      dk.kids.forEach(k => k.sort((a, b) => b[2] - a[2]));
      dk.cur = 0;
      if (st.result.drive) dk.sel = st.result.drive;
    }
    paintBody();
  }
  async function cancelScan() {
    clearTimeout(dk.poll);
    await invoke('disk-scan-cancel');
    const st = await invoke('disk-scan-status');
    if (st && st.state) applyStatus(st);
    paintDrives();
  }

  const fullPath = (id) => {
    const parts = [];
    for (let n = dk.byId.get(id); n; n = n[1] >= 0 ? dk.byId.get(n[1]) : null) parts.unshift(n[5]);
    return parts.length ? parts[0].replace(/\\$/, '') + (parts.length > 1 ? '\\' + parts.slice(1).join('\\') : '\\') : '';
  };

  function paintBody() {
    const st = dk.st;
    const running = st && st.state === 'running';
    const sel = (dk.drives || []).find(d => d.name === dk.sel);
    const hasResult = dk.result && dk.result.drive === dk.sel;
    const parts = [];
    if (running) {
      const used = sel ? Math.max(1, sel.total - sel.free) : 0;
      const pct = used ? Math.min(99, st.bytes / used * 100) : 0;
      const box = el('div', 'dk-prog');
      const bar = el('div', 'dk-prog-bar');
      const fill = el('i');
      fill.style.width = pct.toFixed(1) + '%';
      bar.append(fill);
      const txt = el('div', 'dk-prog-txt', st.files ? `Lendo ${st.drive}… ${num(st.files)} arquivos · ${size(st.bytes)}` : `Preparando a leitura de ${st.drive}…`);
      const stop = el('button', 'ghost-btn', 'Cancelar');
      stop.type = 'button';
      stop.onclick = cancelScan;
      const line = el('div', 'dk-prog-line');
      line.append(txt, stop);
      box.append(line, bar, el('div', 'dk-prog-sub', 'Num disco cheio leva de 30 segundos a alguns minutos. Pode continuar usando o PC.'));
      parts.push(box);
    } else {
      const act = el('div', 'dk-act');
      if (st && st.state === 'error') act.append(el('span', 'dk-err', st.error || 'Não foi possível ler o disco.'));
      else if (hasResult) act.append(el('span', 'dk-meta', `${size(dk.result.scanned)} em ${num(dk.result.files)} arquivos · lido às ${new Date(dk.result.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`));
      else act.append(el('span', 'dk-meta', sel ? `Ainda não analisado. ${size(Math.max(0, sel.total - sel.free))} ocupados.` : ''));
      const go = el('button', hasResult ? 'run-btn' : 'qo-btn', hasResult ? 'Analisar de novo' : `Analisar ${dk.sel || ''}`);
      go.type = 'button';
      go.disabled = !dk.sel;
      go.onclick = startScan;
      act.append(go);
      parts.push(act);
    }
    if (hasResult) parts.push(resultView());
    body.replaceChildren(...parts);
  }

  function resultView() {
    const wrap = el('div', 'dk-result');
    const tabs = el('div', 'dk-tabs');
    for (const [id, name] of [['dirs', 'Pastas'], ['files', 'Maiores arquivos']]) {
      const t = el('button', 'dk-tab' + (dk.tab === id ? ' active' : ''), name);
      t.type = 'button';
      t.onclick = () => { dk.tab = id; paintBody(); };
      tabs.append(t);
    }
    wrap.append(tabs, dk.tab === 'files' ? filesView() : dirsView());
    return wrap;
  }

  function dirsView() {
    const box = el('div');
    const cur = dk.byId.get(dk.cur) || dk.byId.get(0);
    // trilha: C: › Users › Diogo
    const crumbs = el('div', 'dk-crumbs');
    const chain = [];
    for (let n = cur; n; n = n[1] >= 0 ? dk.byId.get(n[1]) : null) chain.unshift(n);
    chain.forEach((n, i) => {
      if (i) crumbs.append(icon(IC.chev, 12));
      const c = el('button', 'dk-crumb' + (i === chain.length - 1 ? ' here' : ''), i ? n[5] : n[5].replace(/\\$/, ''));
      c.type = 'button';
      c.onclick = () => { dk.cur = n[0]; paintBody(); };
      crumbs.append(c);
    });
    box.append(crumbs);

    const kids = dk.kids.get(cur[0]) || [];
    const rows = kids.map(n => ({ name: n[5], bytes: n[2], files: n[3], id: n[0], path: fullPath(n[0]) }));
    const shown = kids.reduce((t, n) => t + n[2], 0);
    if (cur[4] > 0) rows.push({ name: 'Arquivos soltos nesta pasta', bytes: cur[4], pseudo: true, path: fullPath(cur[0]),
      hint: cur[0] === 0 && cur[4] > 1024 ** 3 ? 'Na raiz ficam o hiberfil.sys (hibernação) e o pagefile.sys (memória virtual). Veja em Maiores arquivos.' : '' });
    const rest = cur[2] - shown - cur[4];
    if (rest > 0) rows.push({ name: 'Pastas menores', bytes: rest, pseudo: true, other: true });
    if (cur[0] === 0) {
      const used = dk.result.total - dk.result.free;
      if (used - dk.result.scanned > 512 * 1024 ** 2) rows.push({ name: 'Sistema e itens sem acesso', bytes: used - dk.result.scanned, pseudo: true, other: true,
        hint: 'Pontos de restauração, arquivos do sistema que nem administrador lê e espaço reservado pelo Windows.' });
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    const base = Math.max(1, cur[0] === 0 ? Math.max(dk.result.total - dk.result.free, cur[2]) : cur[2]);
    const list = el('div', 'dk-list');
    list.append(...rows.map(x => itemRow(x, base)));
    if (!rows.length) list.append(el('div', 'tw-empty', 'Pasta vazia.'));
    box.append(list);
    return box;
  }

  function itemRow(x, base, isFile) {
    const drill = !x.pseudo && !isFile && dk.kids.has(x.id);
    // div com papel de botão: dentro dela fica o botão de abrir no Explorer (botão dentro de botão não vale)
    const r = el('div', 'dk-row' + (drill ? ' drill' : '') + (x.pseudo ? ' pseudo' : ''));
    if (drill) {
      const enter = () => { dk.cur = x.id; paintBody(); body.scrollIntoView({ block: 'nearest' }); };
      r.setAttribute('role', 'button');
      r.tabIndex = 0;
      r.onclick = (e) => { if (!e.target.closest('.dk-open')) enter(); };
      r.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); enter(); } };
    }
    const ic = el('span', 'dk-ic');
    ic.append(icon(x.other ? IC.other : isFile ? IC.file : IC.folder, 15));
    const main = el('div', 'dk-main');
    const name = el('div', 'dk-name', x.name);
    if (x.dir) name.title = x.path;
    main.append(name);
    if (x.dir) main.append(el('div', 'dk-dir', x.dir));
    const hint = x.hint || (x.path && !x.pseudo ? hintFor(x.path) : '');
    if (hint) main.append(el('div', 'dk-hint', hint));
    const barBox = el('div', 'dk-bar');
    const fill = el('i');
    fill.style.width = Math.max(0.5, Math.min(100, x.bytes / base * 100)).toFixed(1) + '%';
    barBox.append(fill);
    const sz = el('div', 'dk-size', size(x.bytes));
    if (x.files) sz.title = `${num(x.files)} arquivos`;
    r.append(ic, main, barBox, sz);
    if (x.path && !x.other) {
      const o = el('button', 'dk-open');
      o.type = 'button';
      o.title = isFile ? 'Mostrar no Explorer' : 'Abrir no Explorer';
      o.setAttribute('aria-label', o.title);
      o.append(icon(IC.open, 14));
      o.onclick = async (e) => {
        e.stopPropagation();
        const res = await invoke('disk-open', { target: x.path });
        if (!res || !res.success) toast((res && res.error) || 'Não foi possível abrir.');
      };
      r.append(o);
    } else r.append(el('span', 'dk-open-gap'));
    if (drill) r.append(icon(IC.chev, 14));
    else r.append(el('span', 'dk-chev-gap'));
    return r;
  }

  function filesView() {
    const files = dk.result.big;
    const list = el('div', 'dk-list');
    if (!files.length) { list.append(el('div', 'tw-empty', 'Nenhum arquivo grande.')); return list; }
    const base = Math.max(1, files[0][0]);
    list.append(...files.map(([bytes, p]) => {
      const i = p.lastIndexOf('\\');
      const dir = p.slice(0, i);
      return itemRow({ name: p.slice(i + 1), dir: /:$/.test(dir) ? dir + '\\' : dir, bytes, path: p }, base, true);
    }));
    return list;
  }

  // ── Abrir a página ──
  let started = false;
  async function enter() {
    if (!started) {
      started = true;
      scan();
      await loadDrives();
      const st = await invoke('disk-scan-status'); // uma leitura de antes (ou em andamento) continua valendo
      if (st && st.state) { applyStatus(st); if (st.state === 'running') pollScan(); }
      else paintBody();
      paintDrives();
    } else if (!cl.busy && cl.cats && !cl.done.size) scan();
  }
  const baseGo = window.go;
  window.go = function (pg, navEl) {
    baseGo(pg, navEl);
    if (pg === 'limpeza') enter();
  };
})();
