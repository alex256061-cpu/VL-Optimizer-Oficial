// ── Busca do topo ──
// Caixa no topo do Painel (e Ctrl+K em qualquer página) que acha qualquer ajuste do catálogo
// de otimizações e as páginas do app, pelo título, descrição, etiquetas e sinônimos. Escolher
// leva até a opção e a destaca: nada é ligado daqui, porque vários ajustes têm aviso que
// precisa ser lido antes (o LSO derruba a internet, o MPO pede reinício...).
// Usa window.gdzOpt (otimizacoes.js), goTo() do dashboard e o evento 'gdz-opt-change'.
(function () {
  const home = document.getElementById('gs-home');
  if (!home) return;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const icon = (inner, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const SEARCH_IC = '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>';
  const MAX = 8;

  // Páginas do app fora do catálogo de otimizações.
  const APP_PAGES = [
    { page: 'jogos', where: 'Jogos', title: 'Meus jogos', desc: 'Seus jogos instalados, com ajustes e limpeza de cache para cada um.', syn: 'fivem gta cache limpar steam epic' },
    { page: 'jogos', open: 'gta', where: 'Jogos', title: 'GTA RP (FiveM): gráficos e FPS', desc: 'Gráficos do GTA, Frame Scaling e tela sem bordas, direto no arquivo do FiveM e com backup.', syn: 'fivem gta rp gta v gta5 frame scaling msaa grama sombras sem bordas' },
    { page: 'opti', where: 'Jogos', title: 'DLSS / FSR', desc: 'Troque o upscaler dos jogos com o OptiScaler. Instala com backup e remove com um clique.', syn: 'optiscaler upscaler xess fsr dlss fivem' },
    { page: 'scaling', where: 'Jogos', title: 'VL Scaling', desc: 'Frame Generation e upscaling em qualquer jogo, numa janela própria.', syn: 'frame generation fg lossless scaling upscaling' },
    { page: 'fps', where: 'Diagnóstico', title: 'Medidor de FPS', desc: 'FPS real do jogo, contador na tela e comparação de antes e depois.', syn: 'contador overlay benchmark' },
    { page: 'gargalo', where: 'Diagnóstico', title: 'Gargalo do PC', desc: 'Descubra, com o jogo aberto, o que está limitando o seu FPS.', syn: 'bottleneck processador placa de video limitando' },
    { page: 'pcinfo', where: 'Diagnóstico', title: 'Informações do PC', desc: 'As peças deste PC e os sensores ao vivo: processador, placa de vídeo, memória, discos e temperaturas.', syn: 'cpu-z cpuz hwmonitor hwinfo specs configuracao temperatura sensores placa mae bios ssd monitor hz relatorio' },
    { page: 'inicializacao', where: 'Otimizar', title: 'Inicialização', desc: 'Programas que abrem junto com o Windows: veja e desligue.', syn: 'startup iniciar boot ligar pc lento' },
    { page: 'limpeza', where: 'Otimizar', title: 'Limpeza de arquivos', desc: 'Cache de navegadores, Discord e Steam, temporários, Lixeira, relatórios de erro e instaladores de driver.', syn: 'ccleaner limpar cache chrome edge opera discord steam epic lixeira temporarios temp espaco lixo dump' },
    { page: 'limpeza', where: 'Otimizar', title: 'O que ocupa o disco', desc: 'As pastas e os arquivos que mais ocupam espaço em cada disco.', syn: 'disco cheio espaco armazenamento wiztree treesize windirstat pasta grande arquivo grande ssd hd' },
    { page: 'programas', where: 'Otimizar', title: 'Programas', desc: 'Desinstale programas e apague as sobras que o desinstalador deixa.', syn: 'desinstalar remover apagar programa revo uninstaller sobras registro aplicativos instalados' },
    { page: 'sobre', where: 'VL', title: 'Sobre', desc: 'Versão do VL Optimizer, preferências e efeitos visuais.', syn: 'versao preferencias efeitos app' },
  ];
  // O título dos ajustes já descreve o estado otimizado ("Game Bar desligada"), então o estado
  // diz se ele está aplicado, e não "ligado/desligado".
  const STATE = {
    on: ['Aplicado', 'on'], rec: ['Recomendado', 'rec'], off: ['Não aplicado', ''], blocked: ['Não serve para este PC', 'blocked'],
    once: ['Uma vez', ''], check: ['Só verifica', ''], tip: ['Dica', ''], page: ['Página', ''],
  };

  // ── Montagem ──
  const box = el('div', 'gs');
  const field = el('label', 'gs-box');
  field.innerHTML = icon(SEARCH_IC, 16);
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Buscar ajuste, página ou problema…';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Buscar nas otimizações');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'gs-list');
  input.setAttribute('aria-expanded', 'false');
  field.append(input, el('span', 'gs-kbd', 'Ctrl K'));
  const drop = el('div', 'gs-drop');
  drop.id = 'gs-list';
  drop.setAttribute('role', 'listbox');
  drop.hidden = true;
  box.append(field, drop);

  // Janela estreita: no lugar da caixa fica só a lupa, que abre a busca flutuante.
  const iconBtn = el('button', 'icon-btn gs-icon');
  iconBtn.type = 'button';
  iconBtn.title = 'Buscar (Ctrl+K)';
  iconBtn.setAttribute('aria-label', 'Buscar nas otimizações');
  iconBtn.innerHTML = icon(SEARCH_IC, 16);
  iconBtn.onclick = () => openFloating();
  home.append(box, iconBtn);

  const overlay = el('div', 'gs-overlay');
  overlay.hidden = true;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);

  // ── Dados ──
  function entries() {
    const opt = window.gdzOpt;
    const optPages = opt ? opt.pages() : [];
    const pageIcon = (id) => (optPages.find(p => p.id === id) || {}).icon;
    return [
      ...optPages.map(p => ({ kind: 'page', page: p.id, title: p.name, desc: p.blurb, icon: p.icon, where: 'Otimizações', syn: '', state: 'page' })),
      ...APP_PAGES.map(p => ({ kind: 'page', ...p, state: 'page', icon: pageIcon(p.page) || null, nav: true })),
      ...(opt ? opt.searchIndex() : []).map(x => ({ kind: 'item', ...x, where: x.pageName })),
    ].map(x => ({ ...x,
      _t: norm(x.title),
      _k: norm([...(x.tags || []), x.syn, x.where, x.group].join(' ')),
      _d: norm(x.desc) }));
  }

  // Todas as palavras precisam aparecer em algum lugar; título vale mais que etiqueta, que vale
  // mais que descrição, e começo de palavra vale mais que meio.
  function score(x, words) {
    let s = 0;
    for (const w of words) {
      const titleWords = x._t.split(/[^a-z0-9]+/);
      if (titleWords.some(t => t.startsWith(w))) s += 30;
      else if (x._t.includes(w)) s += 18;
      else if (x._k.includes(w)) s += 12;
      else if (x._d.includes(w)) s += 5;
      else return 0;
    }
    if (x.kind === 'page') s += 3;
    return s;
  }

  // Marca as palavras achadas no texto original (com acento), mapeando cada letra normalizada
  // de volta para a letra de origem.
  function highlight(text, words) {
    const chars = [...String(text || '')];
    let flat = '';
    const at = [];
    chars.forEach((c, i) => { const n = norm(c); for (let j = 0; j < n.length; j++) at.push(i); flat += n; });
    const hit = new Array(chars.length).fill(false);
    for (const w of words) {
      let k = flat.indexOf(w);
      while (k >= 0) { for (let j = k; j < k + w.length; j++) hit[at[j]] = true; k = flat.indexOf(w, k + w.length); }
    }
    const frag = document.createDocumentFragment();
    let buf = '', on = false;
    const flush = () => { if (buf) frag.append(on ? el('mark', null, buf) : document.createTextNode(buf)); buf = ''; };
    chars.forEach((c, i) => { if (hit[i] !== on) { flush(); on = hit[i]; } buf += c; });
    flush();
    return frag;
  }

  // ── Desenho ──
  let results = [];
  let active = 0;

  function render() {
    const q = norm(input.value).trim();
    const words = q.split(/\s+/).filter(Boolean);
    const loaded = !!(window.gdzOpt && window.gdzOpt.loaded());
    const all = entries();
    const parts = [];
    let extra = 0;
    if (!words.length) {
      const pend = all.filter(x => x.state === 'rec').slice(0, 5);
      results = pend.length ? pend : all.filter(x => x.nav);
      parts.push(el('div', 'gs-sec', pend.length ? 'Recomendados que faltam' : 'Atalhos'));
    } else {
      const found = all.map(x => ({ x, s: score(x, words) })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).map(r => r.x);
      results = found.slice(0, MAX);
      extra = found.length - results.length;
    }
    active = Math.min(active, Math.max(results.length - 1, 0));
    results.forEach((x, i) => parts.push(itemRow(x, i, words)));
    if (words.length && !results.length) {
      const none = el('div', 'gs-empty');
      none.append(el('b', null, `Nada encontrado para "${input.value.trim()}".`),
        el('span', null, loaded ? 'Tente outra palavra, como "ping", "mouse", "tela" ou "upload".' : 'Ainda estou lendo as otimizações do Windows…'));
      parts.push(none);
    }
    const foot = el('div', 'gs-foot');
    foot.append(el('span', null, extra > 0 ? `+${extra} resultado${extra > 1 ? 's' : ''}: escreva mais para filtrar` : (loaded ? '' : 'Lendo as otimizações…')),
      el('span', null, '↑↓ navegar · Enter abrir · Esc fechar'));
    parts.push(foot);
    drop.replaceChildren(...parts);
    paintActive();
  }

  function itemRow(x, i, words) {
    const r = el('div', 'gs-item');
    r.id = 'gs-opt-' + i;
    r.setAttribute('role', 'option');
    const ic = el('div', 'gs-ic');
    const nav = x.nav && navIcon(x.page);
    if (nav) ic.append(nav);
    else ic.innerHTML = icon(x.icon || SEARCH_IC, 15);
    const txt = el('div', 'gs-txt');
    const t = el('div', 'gs-title'); t.append(highlight(x.title, words));
    const d = el('div', 'gs-desc'); d.append(highlight(x.desc, words));
    txt.append(t, d);
    const meta = el('div', 'gs-meta');
    const [label, cls] = STATE[x.state] || STATE.page;
    meta.append(el('span', 'gs-where', x.where), el('span', 'gs-st' + (cls ? ' ' + cls : ''), label));
    r.append(ic, txt, meta);
    r.onmousemove = () => { if (active !== i) { active = i; paintActive(); } };
    r.onmousedown = (e) => e.preventDefault();
    r.onclick = () => choose(x);
    return r;
  }

  // Ícone da página na barra lateral, para os atalhos que não são do catálogo.
  function navIcon(page) {
    const key = page === 'scaling' ? 'openScalingWindow' : `'${page}'`;
    const n = [...document.querySelectorAll('.sidebar .nav-item')].find(a => (a.getAttribute('onclick') || '').includes(key));
    const s = n && n.querySelector('svg');
    if (!s) return null;
    const c = s.cloneNode(true);
    c.setAttribute('width', '15'); c.setAttribute('height', '15');
    c.querySelectorAll('[stroke]').forEach(p => p.setAttribute('stroke', 'currentColor'));
    if (c.getAttribute('stroke')) c.setAttribute('stroke', 'currentColor');
    return c;
  }

  function paintActive() {
    drop.querySelectorAll('.gs-item').forEach((r, i) => {
      const on = i === active;
      r.classList.toggle('active', on);
      r.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
    if (results.length) input.setAttribute('aria-activedescendant', 'gs-opt-' + active);
    else input.removeAttribute('aria-activedescendant');
  }

  // ── Abrir, fechar, escolher ──
  const floating = () => box.parentElement === overlay;
  function open() {
    if (!drop.hidden) return;
    drop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = 0;
    render();
  }
  function close() {
    drop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    if (floating()) {
      overlay.hidden = true;
      home.prepend(box);
      input.blur();
    }
  }
  function openFloating() {
    if (!floating()) overlay.append(box);
    overlay.hidden = false;
    drop.hidden = true;
    input.focus();
    input.select();
    open();
  }
  function choose(x) {
    close();
    input.value = '';
    input.blur();
    if (x.kind === 'page' && x.open === 'gta' && window.gtaOpen) window.gtaOpen();
    else if (x.kind === 'page') goTo(x.page);
    else window.gdzOpt.reveal(x.page, x.key);
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { active = 0; if (drop.hidden) open(); else render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (drop.hidden) { open(); return; }
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value && !floating()) { input.value = ''; render(); return; }
      close();
      input.blur();
    }
  });
  document.addEventListener('mousedown', (e) => { if (!drop.hidden && !floating() && !box.contains(e.target)) close(); });
  // Ctrl+K: no Painel com espaço, foca a caixa do topo; nas outras páginas, abre a flutuante.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    const inline = home.closest('.page.active') && getComputedStyle(box).display !== 'none' && !floating();
    if (inline) { input.focus(); input.select(); open(); } else openFloating();
  });
  // O estado dos ajustes mudou (ligou, desligou, terminou de ler): redesenha o que está aberto.
  window.addEventListener('gdz-opt-change', () => { if (!drop.hidden) render(); });
})();
