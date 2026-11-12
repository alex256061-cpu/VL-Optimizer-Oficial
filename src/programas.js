// Página Programas: lista dos programas instalados e desinstalação com limpeza das sobras.
// O main.js abre o desinstalador do próprio programa ('apps-uninstall'); a tela pergunta se ele
// ainda está instalado ('apps-exists') e, quando sai, procura as sobras ('apps-leftovers') e mostra
// a lista antes de apagar ('apps-remove-leftovers'). Usa ipcRenderer, toast(), addRecent() e go() do dashboard.
(function () {
  const $ = (id) => document.getElementById(id);
  const page = $('pg-programas');
  if (!page) return;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // nomes vêm do registro dos programas: nunca como HTML
    return e;
  };
  const invoke = async (ch, arg) => { try { return await ipcRenderer.invoke(ch, arg); } catch (e) { return { success: false, error: e.message }; } };
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function size(b) {
    if (!(b > 0)) return '';
    for (const [u, v] of [['TB', 1024 ** 4], ['GB', 1024 ** 3], ['MB', 1024 ** 2]]) {
      if (b >= v) return (b / v).toLocaleString('pt-BR', { maximumFractionDigits: b / v >= 100 ? 0 : 1 }) + ' ' + u;
    }
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  const dateBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

  const st = { apps: null, icons: {}, sizes: {}, loading: false, flow: null };
  const listBox = $('pr-list'), q = $('pr-q'), sort = $('pr-sort'), count = $('pr-count');

  async function load() {
    if (st.loading) return;
    st.loading = true;
    if (!st.apps) listBox.replaceChildren(el('div', 'tw-loading', 'Lendo os programas instalados…'));
    const r = await invoke('apps-list');
    st.loading = false;
    if (!r || !r.success) { listBox.replaceChildren(el('div', 'tw-empty', (r && r.error) || 'Não foi possível ler os programas.')); return; }
    st.apps = r.apps;
    render();
    // tamanho real das pastas e ícones: chegam depois, para a lista abrir na hora
    const x = await invoke('apps-extra');
    if (x && x.success) { st.sizes = x.sizes || {}; st.icons = { ...st.icons, ...(x.icons || {}) }; render(); }
  }
  const bytesOf = (a) => st.sizes[a.key] || a.bytes || 0;

  function render() {
    if (!st.apps) return;
    const term = norm(q.value).trim();
    let apps = st.apps.filter(a => !term || norm(a.name + ' ' + a.pub).includes(term));
    const by = sort.value;
    apps = apps.slice().sort((a, b) => by === 'name' ? a.name.localeCompare(b.name, 'pt-BR')
      : by === 'date' ? String(b.date || '').localeCompare(String(a.date || '')) || a.name.localeCompare(b.name, 'pt-BR')
      : bytesOf(b) - bytesOf(a) || a.name.localeCompare(b.name, 'pt-BR'));
    const totalBytes = st.apps.reduce((t, a) => t + bytesOf(a), 0);
    count.textContent = `${num(st.apps.length)} programas${totalBytes ? ' · ' + size(totalBytes) : ''}`;
    listBox.replaceChildren(...(apps.length ? apps.map(row) : [el('div', 'tw-empty', 'Nenhum programa encontrado para essa busca.')]));
  }

  function row(a) {
    const r = el('div', 'pr-row');
    const ic = el('div', 'pr-ic');
    if (st.icons[a.key]) { const img = el('img'); img.src = st.icons[a.key]; img.alt = ''; img.draggable = false; ic.append(img); }
    else { ic.classList.add('letter'); ic.textContent = (a.name.match(/[A-Za-z0-9À-ÿ]/) || ['?'])[0].toUpperCase(); }
    const main = el('div', 'pr-main');
    main.append(el('div', 'pr-name', a.name));
    const sub = [a.pub, a.ver && !a.name.includes(a.ver) ? `versão ${a.ver}` : '', a.date ? `instalado em ${dateBR(a.date)}` : ''].filter(Boolean).join(' · ');
    if (sub) main.append(el('div', 'pr-sub', sub));
    const sz = el('div', 'pr-size', size(bytesOf(a)) || '—');
    if (!bytesOf(a)) sz.title = 'O programa não informa o tamanho';
    const b = el('button', 'run-btn pr-btn', 'Desinstalar');
    b.type = 'button';
    b.disabled = a.noRemove || !!st.flow;
    if (a.noRemove) b.title = 'Este programa não permite ser desinstalado.';
    b.onclick = () => uninstall(a);
    r.append(ic, main, sz, b);
    return r;
  }

  q.addEventListener('input', render);
  sort.addEventListener('change', render);

  // ── Desinstalar ──
  // Janela por cima da página com os passos: desinstalador aberto → procurando sobras → lista → pronto.
  function modal() {
    let m = $('pr-flow');
    if (!m) {
      m = el('div', 'pr-flow');
      m.id = 'pr-flow';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.append(el('div', 'pr-flow-card'));
      document.body.append(m);
    }
    return m.firstChild;
  }
  function closeFlow(reload) {
    if (st.flow) clearTimeout(st.flow.poll);
    st.flow = null;
    const m = $('pr-flow');
    if (m) m.remove();
    if (reload) load(); else render();
  }
  function step({ title, text, body, buttons, wait }) {
    const card = modal();
    const parts = [el('div', 'pr-flow-title', title)];
    if (text) parts.push(el('div', 'pr-flow-text', text));
    if (wait) { const w = el('div', 'pr-flow-wait'); w.append(el('span', 'pr-spin'), el('span', null, wait)); parts.push(w); }
    if (body) parts.push(body);
    const btns = el('div', 'pr-flow-btns');
    for (const bt of buttons || []) {
      const b = el('button', bt.primary ? 'qo-btn' : 'ghost-btn', bt.label);
      b.type = 'button';
      if (bt.id) b.id = bt.id;
      b.disabled = !!bt.disabled;
      b.onclick = bt.onclick;
      btns.append(b);
    }
    parts.push(btns);
    card.replaceChildren(...parts);
    const first = card.querySelector('.qo-btn:not(:disabled)') || card.querySelector('button');
    if (first) first.focus();
  }

  async function uninstall(a) {
    if (st.flow) return;
    st.flow = { app: a, poll: null, since: Date.now() };
    render();
    step({ title: `Desinstalar ${a.name}`, wait: 'Abrindo o desinstalador…', buttons: [] });
    const r = await invoke('apps-uninstall', { key: a.key });
    if (!st.flow) return;
    if (r && r.broken) {
      step({ title: `Desinstalar ${a.name}`,
        text: 'O desinstalador deste programa não existe mais: os arquivos dele já foram apagados. O L pode procurar o que sobrou e tirar o programa da lista.',
        buttons: [{ label: 'Procurar sobras', primary: true, onclick: () => leftovers() }, { label: 'Cancelar', onclick: () => closeFlow() }] });
      return;
    }
    if (!r || !r.success) { toast(`${a.name}: ${(r && r.error) || 'não foi possível abrir o desinstalador.'}`); closeFlow(); return; }
    waiting();
  }

  function waiting() {
    const a = st.flow.app;
    step({ title: `Desinstalar ${a.name}`,
      text: 'A janela de desinstalação do programa abriu (pode estar atrás do L). Siga os passos dela. Quando terminar, o L procura o que sobrou.',
      wait: 'Esperando o desinstalador terminar…',
      buttons: [{ label: 'Já terminei', primary: true, onclick: () => leftovers() }, { label: 'Cancelar', onclick: () => closeFlow(true) }] });
    const tick = async () => {
      if (!st.flow || st.flow.app !== a) return;
      const r = await invoke('apps-exists', { key: a.key });
      if (!st.flow || st.flow.app !== a || st.flow.scanning) return;
      if (r && r.exists === false) { leftovers(); return; }
      if (Date.now() - st.flow.since < 30 * 60000) st.flow.poll = setTimeout(tick, 2500);
    };
    st.flow.poll = setTimeout(tick, 2500);
  }

  async function leftovers() {
    const f = st.flow;
    if (!f || f.scanning) return;
    clearTimeout(f.poll);
    f.scanning = true;
    const a = f.app;
    step({ title: `Sobras de ${a.name}`, wait: 'Procurando pastas e chaves do registro que ficaram…', buttons: [] });
    const r = await invoke('apps-leftovers', { key: a.key });
    f.scanning = false;
    if (st.flow !== f) return;
    if (!r || !r.success) { toast(`${a.name}: ${(r && r.error) || 'não foi possível procurar as sobras.'}`); closeFlow(true); return; }
    if (r.stillInstalled) {
      step({ title: `${a.name} ainda está instalado`,
        text: 'O programa continua na lista do Windows. Se a janela de desinstalação ainda está aberta, termine nela; se você cancelou, é só fechar.',
        buttons: [{ label: 'Procurar de novo', primary: true, onclick: () => leftovers() }, { label: 'Fechar', onclick: () => closeFlow(true) }] });
      return;
    }
    if (!r.items.length) {
      step({ title: `${a.name} desinstalado`, text: 'Nenhuma sobra encontrada: o desinstalador levou tudo.',
        buttons: [{ label: 'Fechar', primary: true, onclick: () => closeFlow(true) }] });
      if (typeof addRecent === 'function') addRecent(`${a.name} desinstalado`, { page: 'programas' });
      return;
    }
    pickLeftovers(a, r.items);
  }

  function pickLeftovers(a, items) {
    const sel = new Set(items.map(i => i.id));
    const list = el('div', 'pr-left');
    const paint = () => {
      const bytes = items.filter(i => sel.has(i.id)).reduce((t, i) => t + (i.bytes || 0), 0);
      const b = $('pr-left-go');
      if (b) { b.disabled = !sel.size; b.textContent = sel.size ? `Apagar ${sel.size} ${sel.size === 1 ? 'item' : 'itens'}${bytes ? ' (' + size(bytes) + ')' : ''}` : 'Apagar'; }
    };
    for (const it of items) {
      const r = el('label', 'pr-left-row');
      const box = el('input', 'cl-check');
      box.type = 'checkbox';
      box.checked = true;
      box.onchange = () => { if (box.checked) sel.add(it.id); else sel.delete(it.id); paint(); };
      const main = el('div', 'pr-left-main');
      const p = el('div', 'pr-left-path', it.path);
      p.title = it.path;
      main.append(el('div', 'pr-left-kind', it.label), p);
      r.append(box, main, el('div', 'pr-left-size', it.kind === 'dir' ? (size(it.bytes) || 'vazia') : ''));
      list.append(r);
    }
    step({ title: `Sobras de ${a.name}`,
      text: 'O desinstalador deixou isto para trás. Pastas vão para a Lixeira e chaves do registro saem com backup. Vai reinstalar e quer manter as configurações? Desmarque as de "Dados e configurações".',
      body: list,
      buttons: [{ label: 'Apagar', id: 'pr-left-go', primary: true, onclick: () => removeLeftovers(a, items.filter(i => sel.has(i.id))) },
        { label: 'Deixar como está', onclick: () => closeFlow(true) }] });
    paint();
  }

  async function removeLeftovers(a, pick) {
    if (!pick.length || !st.flow) return;
    step({ title: `Sobras de ${a.name}`, wait: 'Apagando…', buttons: [] });
    const r = await invoke('apps-remove-leftovers', { key: a.key, ids: pick.map(i => i.id) });
    if (!r || !r.success) { toast(`${a.name}: ${(r && r.error) || 'não foi possível apagar as sobras.'}`); closeFlow(true); return; }
    const done = [];
    if (r.trashed) done.push(`${r.trashed} ${r.trashed === 1 ? 'pasta foi' : 'pastas foram'} para a Lixeira${r.bytes ? ' (' + size(r.bytes) + ')' : ''}`);
    if (r.regs) done.push(`${r.regs} ${r.regs === 1 ? 'chave do registro saiu' : 'chaves do registro saíram'} (o backup fica na pasta de dados do VL, em "desinstalacoes")`);
    const body = el('div');
    if (r.failed && r.failed.length) {
      body.append(el('div', 'cl-why', `Não deu para apagar ${r.failed.length === 1 ? 'este item (pode estar em uso)' : 'estes itens (podem estar em uso)'}:`));
      const ul = el('ul', 'pr-fail');
      r.failed.forEach(p => ul.append(el('li', null, p)));
      body.append(ul);
    }
    step({ title: `${a.name} desinstalado`, text: done.length ? done.join('. ') + '.' : 'Nada foi apagado.', body,
      buttons: [{ label: 'Fechar', primary: true, onclick: () => closeFlow(true) }] });
    if (typeof addRecent === 'function') addRecent(`${a.name} desinstalado e sobras removidas`, { page: 'programas' });
  }

  // Esc fecha só quando não tem nada rodando (no meio da desinstalação a pessoa usa os botões).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !st.flow || !$('pr-flow')) return;
    if ($('pr-flow').querySelector('.pr-flow-wait')) return;
    closeFlow(true);
  });

  let started = false;
  const baseGo = window.go;
  window.go = function (pg, navEl) {
    baseGo(pg, navEl);
    if (pg !== 'programas') return;
    if (!started) { started = true; load(); }
    else if (!st.flow) load();
  };
})();
