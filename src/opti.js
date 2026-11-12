// ── DLSS / FSR (OptiScaler) ──
// O main.js baixa o OptiScaler oficial, instala com backup e grava o OptiScaler.ini ('opti-*').
// Aqui só desenhamos: adicionar jogo, opções e remover. Usa ipcRenderer, toast(), escapeHtml()
// e goTo() do script do dashboard; os estilos base (.fpm-*) vêm do fps.css.
(function () {
  const REPO = 'https://github.com/optiscaler/OptiScaler';
  const st = { data: null, draft: null, draftOpts: null, dll: 'dxgi.dll', acOk: false, timer: null, busy: false, live: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const gameName = (exe) => String(exe || '').split('\\').pop().replace(/\.exe$/i, '').replace(/-(Win64|WinGDK)-Shipping$/i, '');
  const isFiveM = (r) => !!r && /\\FiveM\\/i.test(r.exe || '');
  const DEFAULT = { upscaler: 'auto', fg: 'off', spoof: true, fps: false, menu: true, menuKey: 'home' };
  const KEY_NAME = { home: 'Home', insert: 'Insert', end: 'End' };
  const DLL_HINT = { 'dxgi.dll': 'padrão, funciona na maioria', 'winmm.dll': 'jogos Vulkan e Game Pass', 'version.dll': 'Game Pass / MS Store', 'dbghelp.dll': '', 'd3d12.dll': '', 'wininet.dll': '', 'winhttp.dll': '' };

  function optsHtml(o, key, nvidia) {
    const sel = (k, opts) => `<select class="fpm-select" data-opt="${k}" data-key="${esc(key)}">${opts.map(([v, t, dis]) =>
      `<option value="${v}"${o[k] === v ? ' selected' : ''}${dis ? ' disabled' : ''}>${t}</option>`).join('')}</select>`;
    const tog = (k, label) => `<div class="toggle${o[k] ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${o[k] ? 'true' : 'false'}" aria-label="${label}" data-opt="${k}" data-key="${esc(key)}"></div>`;
    const row = (t, d, ctl) => `<div class="opx-opt"><div class="opx-opt-l"><div class="opx-opt-t">${t}</div><div class="opx-opt-d">${d}</div></div>${ctl}</div>`;
    return `<div class="opx-opts">
      ${row('Upscaler', 'Qual tecnologia roda no lugar do upscaler que você escolher no menu do jogo.', sel('upscaler', [
        ['auto', 'Automático'], ['fsr', 'FSR 3.1 / FSR 4'], ['xess', 'XeSS'], ['dlss', 'DLSS' + (nvidia ? '' : ' (só NVIDIA RTX)'), !nvidia]]))}
      ${row('Frame Generation', 'Gera quadros extras. Aumenta o FPS mostrado, mas não diminui o input lag.', sel('fg', [
        ['off', 'Desligado'], ['dlssg', 'Trocar o DLSS-FG do jogo por FSR FG'], ['optifg', 'OptiFG (experimental, só DX12)']]))}
      ${nvidia ? '' : row('Liberar a opção DLSS no jogo', 'O jogo passa a ver uma placa NVIDIA e mostra o DLSS no menu. O OptiScaler troca por FSR/XeSS.', tog('spoof', 'Liberar a opção DLSS'))}
      ${row('FPS dentro do jogo', 'Contador do OptiScaler. Funciona até em tela cheia exclusiva. Page Up liga e desliga.', tog('fps', 'FPS dentro do jogo'))}
      ${row(`Menu no jogo (tecla ${KEY_NAME[o.menuKey] || 'Home'})`, 'Ajuste fino com o jogo aberto: nitidez, qualidade, presets.', tog('menu', 'Menu no jogo'))}
      ${row('Tecla do menu', 'Use Home ou End se o seu teclado não tiver Insert.', sel('menuKey', [['home', 'Home'], ['insert', 'Insert'], ['end', 'End']]))}
    </div>`;
  }

  function chips(up) {
    const c = (k, t) => `<span class="opx-chip ${up[k] ? 'yes' : 'no'}">${t}</span>`;
    return `<div class="opx-chips">${c('dlss', 'DLSS')}${c('fsr', 'FSR')}${c('xess', 'XeSS')}</div>`;
  }

  function draftHtml(d) {
    const nv = st.data && st.data.nvidia;
    const none = !d.upscalers.dlss && !d.upscalers.fsr && !d.upscalers.xess;
    const notes = d.notes.slice();
    if (none) notes.push('Não achamos DLSS, FSR nem XeSS nos arquivos deste jogo. O OptiScaler só funciona em jogos que já têm um deles. Alguns jogos embutem o upscaler no próprio .exe: nesse caso vale testar.');
    else notes.push('Depois de instalar, abra o jogo e escolha ' + (d.upscalers.dlss ? 'DLSS' : d.upscalers.fsr ? 'FSR' : 'XeSS') + ' no menu de gráficos: é essa opção que o OptiScaler troca.');
    let stop = d.block || (d.foreign ? 'Já existe um OptiScaler instalado à mão nesta pasta. Remova-o antes (Remove_OptiScaler.bat, na pasta do jogo).' : null);
    if (d.installed) stop = 'O OptiScaler já está instalado neste jogo. Veja em "Jogos com OptiScaler", abaixo.';
    const pkg = st.data && st.data.pkg;
    return `<div class="fpm-card opx-game" id="opx-draft">
      <div class="opx-game-hdr"><div style="min-width:0"><div class="opx-game-name">${esc(gameName(d.exe))}</div><div class="opx-path">${esc(d.exe)}</div></div>
        <button class="fpm-btn ghost" data-act="draft-cancel">Cancelar</button></div>
      ${chips(d.upscalers)}
      <div class="opx-notes">${notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>
      ${stop ? `<div class="opx-err">${esc(stop)}</div>` : `
        ${d.antiCheat ? `<div class="opx-warn"><b>Este jogo tem anti-cheat</b> (${esc(d.antiCheat.join(', '))}). Usar o OptiScaler no modo online pode dar <b>ban na conta</b>.</div>
          <label class="opx-ac"><input type="checkbox" id="opx-ac"${st.acOk ? ' checked' : ''}> Vou jogar só offline / no modo campanha e entendo o risco.</label>` : ''}
        ${optsHtml(st.draftOpts, '__draft', nv)}
        <div class="opx-opt" style="margin-top:12px"><div class="opx-opt-l"><div class="opx-opt-t">Nome do arquivo</div><div class="opx-opt-d">Se o jogo não carregar o OptiScaler, remova e instale com outro nome.</div></div>
          <select class="fpm-select" id="opx-dll">${(st.data ? st.data.dlls : ['dxgi.dll']).map(n => `<option value="${n}"${n === st.dll ? ' selected' : ''}>${n}${DLL_HINT[n] ? ' · ' + DLL_HINT[n] : ''}</option>`).join('')}</select></div>
        <div class="opx-actions"><button class="fpm-btn" data-act="install" id="opx-install"${d.antiCheat && !st.acOk ? ' disabled' : ''}>${pkg ? 'Instalar' : 'Baixar e instalar'}</button></div>`}
    </div>`;
  }

  function gameHtml(g) {
    const pkg = st.data.pkg;
    const upd = pkg && pkg.tag !== g.tag;
    const when = new Date(g.at).toLocaleDateString('pt-BR');
    return `<div class="fpm-card opx-game" data-dir="${esc(g.dir)}">
      <div class="opx-game-hdr"><div style="min-width:0"><div class="opx-game-name">${esc(gameName(g.exe))}</div><div class="opx-path">${esc(g.dir)}</div></div>
        <div class="opx-chips" style="margin-top:0"><span class="opx-chip yes">OptiScaler ${esc(g.tag)}</span><span class="opx-chip">${esc(g.dll)}</span><span class="opx-chip">desde ${when}</span></div></div>
      ${optsHtml(Object.assign({}, DEFAULT, g.opts), g.dir, st.data.nvidia)}
      <div class="opx-actions">
        <button class="fpm-btn" data-act="measure">Medir o ganho de FPS</button>
        ${upd ? `<button class="fpm-btn ghost" data-act="update">Atualizar para ${esc(pkg.tag)}</button>` : ''}
        <button class="fpm-btn ghost" data-act="folder">Abrir pasta</button>
        <button class="fpm-btn ghost" data-act="remove">Remover</button>
        <span class="opx-saved" data-saved hidden></span>
      </div></div>`;
  }

  // Aviso do jogo aberto agora (detectado sozinho ao abrir a página).
  function liveHtml() {
    const l = st.live;
    if (!l || !l.success) return '';
    const name = gameName(l.exe);
    let right, sub;
    if (isFiveM(l)) { sub = 'GTA RP: o OptiScaler não funciona no FiveM. O que dá FPS de verdade nele fica em Meus jogos, no card do FiveM.'; right = '<button class="fpm-btn" data-act="gta">Ver opções do GTA RP</button>'; }
    else if (l.installed) { sub = 'Já está com o OptiScaler: as opções dele estão abaixo.'; right = ''; }
    else if (l.block) { sub = 'Jogo online com anti-cheat: o OptiScaler não pode ser usado nele.'; right = ''; }
    else {
      const up = ['dlss', 'fsr', 'xess'].filter(k => l.upscalers[k]).map(k => k === 'dlss' ? 'DLSS' : k === 'fsr' ? 'FSR' : 'XeSS');
      sub = up.length ? `Tem ${up.join(', ')}: dá para usar o OptiScaler.` : 'Não achamos DLSS, FSR nem XeSS nos arquivos dele.';
      right = '<button class="fpm-btn" data-act="use-live">Usar este jogo</button>';
    }
    return `<div class="fpm-card opx-game opx-live"><div class="opx-game-hdr" style="align-items:center">
      <div style="min-width:0;display:flex;gap:12px;align-items:center"><span class="fpm-dot on"></span><div style="min-width:0">
        <div class="opx-opt-t">Aberto agora: ${esc(name)}</div><div class="opx-opt-d">${esc(sub)}</div></div></div>${right}</div></div>`;
  }

  async function detect(manual) {
    let r;
    try { r = await ipcRenderer.invoke('opti-detect'); } catch (e) { r = null; }
    if (!manual) { st.live = r; if (!st.draft) render(); return; }
    if (!r || !r.success) { toast((r && r.error) || 'Nenhum jogo aberto agora.'); return; }
    st.live = r;
    useDraft(r);
  }

  // FiveM não tem o que o OptiScaler trocar: em vez do erro, leva ao card do GTA RP.
  function gotoGta() {
    render();
    if (window.gtaOpen) window.gtaOpen();
  }

  function useDraft(r) {
    if (isFiveM(r)) { st.draft = null; toast('FiveM detectado: os ajustes que dão FPS no GTA RP ficam em Meus jogos.'); gotoGta(); return; }
    st.draft = r; st.acOk = false; st.dll = 'dxgi.dll';
    st.draftOpts = Object.assign({}, DEFAULT);
    render();
    const el = $('opx-draft'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function render() {
    const d = st.data;
    if (!d) return;
    const dl = d.dl;
    const pkgHtml = dl.running
      ? `<div class="opx-pkg-v">Baixando o OptiScaler… ${dl.pct}%</div><div class="opx-bar"><i style="width:${dl.pct}%"></i></div>`
      : d.pkg ? `<div class="opx-pkg-v">OptiScaler <b>${esc(d.pkg.tag)}</b> pronto</div>`
      : `<button class="fpm-btn" data-act="download">Baixar OptiScaler (~55 MB)</button>`;
    $('opx-root').innerHTML = `
      <div class="fpm-card">
        <div class="opx-hero">
          <div class="opx-hero-txt">
            <div class="fpm-title">Troque o upscaler de qualquer jogo</div>
            <div class="fpm-sub">O OptiScaler fica entre o jogo e o upscaler e troca um pelo outro. O jogo acha que está usando o DLSS (ou FSR/XeSS), e por baixo roda o que você escolher aqui.</div>
            <ul class="opx-list">
              <li><b>Placa AMD ou Intel</b> em jogo que só tem DLSS: use FSR 3.1/FSR 4 ou XeSS no lugar.</li>
              <li><b>Placa NVIDIA</b>: use em jogos com FSR antigo, ou ligue o frame generation por FSR.</li>
              <li>Só funciona em jogos que <b>já têm</b> DLSS, FSR 2+ ou XeSS.</li>
            </ul>
          </div>
          <div class="opx-pkg">${pkgHtml}</div>
        </div>
        ${dl.error ? `<div class="opx-err">${esc(dl.error)}</div>` : ''}
        <div class="opx-warn"><b>Nunca use em jogo online</b> (Valorant, CS2, Fortnite, FiveM, Warzone…): é uma DLL dentro do jogo e o anti-cheat pode banir a conta. O L bloqueia os jogos online que conhece.</div>
        <div class="opx-credit">OptiScaler é um projeto gratuito e open-source (GPL-3) da equipe OptiScaler, sem ligação com o L. O download vem do <a data-act="repo">GitHub oficial</a>.</div>
      </div>

      <div class="opx-sec"><span class="opx-sec-t">Adicionar jogo</span><div class="opx-actions" style="margin:0">
        <button class="fpm-btn ghost" data-act="detect">Detectar jogo aberto</button>
        <button class="fpm-btn" data-act="browse">Escolher o .exe do jogo</button></div></div>
      ${!st.draft ? liveHtml() : ''}
      ${st.draft ? draftHtml(st.draft) : ''}

      <div class="opx-sec"><span class="opx-sec-t">Jogos com OptiScaler</span></div>
      ${d.installs.length ? d.installs.map(gameHtml).join('') : '<div class="opx-empty">Nenhum jogo ainda. Escolha o .exe de um jogo acima.</div>'}`;
  }

  async function load() {
    try { st.data = await ipcRenderer.invoke('opti-status'); } catch (e) { return; }
    if (!st.data || st.data.success === false) { $('opx-root').innerHTML = `<div class="opx-err">${esc((st.data && st.data.error) || 'Não foi possível carregar.')}</div>`; return; }
    render();
    // Download em andamento: acompanha até terminar.
    clearTimeout(st.timer);
    if (st.data.dl.running) st.timer = setTimeout(load, 700);
  }

  async function browse() {
    const r = await ipcRenderer.invoke('opti-browse');
    if (!r || r.canceled) return;
    if (!r.success) { toast(r.error || 'Não foi possível ler este jogo.'); return; }
    useDraft(r);
  }

  async function install(btn) {
    if (st.busy) return;
    st.busy = true;
    btn.disabled = true;
    btn.textContent = st.data.pkg ? 'Instalando…' : 'Baixando e instalando…';
    if (!st.data.pkg) { clearTimeout(st.timer); st.timer = setTimeout(load, 700); }
    const r = await ipcRenderer.invoke('opti-install', { exe: st.draft.exe, dll: st.dll, opts: st.draftOpts, acceptAntiCheat: st.acOk });
    st.busy = false;
    if (!r || !r.success) { toast((r && r.error) || 'A instalação falhou.'); btn.disabled = false; btn.textContent = 'Instalar'; return; }
    const name = gameName(st.draft.exe);
    st.draft = null;
    addRecent('OptiScaler instalado: ' + name, { page: 'opti', el: null });
    toast(`OptiScaler instalado em ${name}. Abra o jogo e escolha o upscaler no menu de gráficos.`);
    load();
  }

  async function saveOpt(dir, k, v, card) {
    const g = st.data.installs.find(x => x.dir === dir);
    if (!g) return;
    const r = await ipcRenderer.invoke('opti-config', { dir, opts: { [k]: v } });
    if (!r || !r.success) { toast((r && r.error) || 'Não foi possível salvar.'); load(); return; }
    g.opts = r.opts;
    const s = card.querySelector('[data-saved]');
    s.hidden = false;
    s.textContent = r.running ? 'Salvo. Feche e abra o jogo para aplicar.' : 'Salvo. Vale na próxima vez que abrir o jogo.';
  }

  async function remove(dir, silent) {
    const g = st.data.installs.find(x => x.dir === dir);
    if (!silent && !confirm(`Remover o OptiScaler de ${gameName(g && g.exe)}?\n\nOs arquivos originais do jogo voltam para o lugar.`)) return false;
    const r = await ipcRenderer.invoke('opti-uninstall', { dir });
    if (!r || !r.success) { toast((r && r.error) || 'Não foi possível remover.'); return false; }
    if (!silent) { toast('OptiScaler removido. A pasta do jogo voltou como estava.'); load(); }
    return true;
  }

  async function update(dir) {
    const g = st.data.installs.find(x => x.dir === dir);
    if (!g) return;
    const a = await ipcRenderer.invoke('opti-analyze', { exe: g.exe });
    if (a && a.antiCheat && !confirm('Este jogo tem anti-cheat. Continue só se for jogar offline.')) return;
    if (!(await remove(dir, true))) return;
    const r = await ipcRenderer.invoke('opti-install', { exe: g.exe, dll: g.dll, opts: g.opts, acceptAntiCheat: true });
    toast(r && r.success ? `OptiScaler atualizado para ${st.data.pkg.tag}.` : (r && r.error) || 'A atualização falhou.');
    load();
  }

  document.addEventListener('click', async (e) => {
    const root = $('opx-root');
    if (!root || !root.contains(e.target)) return;
    const t = e.target.closest('[data-act], .toggle[data-opt]');
    if (!t) return;
    if (t.classList.contains('toggle')) {
      const on = !t.classList.contains('on');
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', on ? 'true' : 'false');
      if (t.dataset.key === '__draft') st.draftOpts[t.dataset.opt] = on;
      else saveOpt(t.dataset.key, t.dataset.opt, on, t.closest('.opx-game'));
      return;
    }
    const card = t.closest('.opx-game');
    const dir = card && card.dataset.dir;
    switch (t.dataset.act) {
      case 'download': ipcRenderer.invoke('opti-download').then(() => setTimeout(load, 300)); break;
      case 'browse': browse(); break;
      case 'detect': t.disabled = true; t.textContent = 'Procurando…'; await detect(true); if (t.isConnected) { t.disabled = false; t.textContent = 'Detectar jogo aberto'; } break;
      case 'use-live': if (st.live && st.live.success) useDraft(st.live); break;
      case 'gta': gotoGta(); break;
      case 'draft-cancel': st.draft = null; render(); break;
      case 'install': install(t); break;
      case 'measure': goTo('fps'); break;
      case 'folder': ipcRenderer.invoke('opti-open-folder', { dir }); break;
      case 'remove': t.disabled = true; if (!(await remove(dir))) t.disabled = false; break;
      case 'update': t.disabled = true; t.textContent = 'Atualizando…'; update(dir); break;
      case 'repo': shell.openExternal(REPO); break;
    }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.key === ' ' || e.key === 'Enter') && t.classList && t.classList.contains('toggle') && t.dataset.opt && $('opx-root') && $('opx-root').contains(t)) { e.preventDefault(); t.click(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    const root = $('opx-root');
    if (!root || !root.contains(t)) return;
    if (t.id === 'opx-ac') { st.acOk = t.checked; const b = $('opx-install'); if (b) b.disabled = !t.checked; return; }
    if (t.id === 'opx-dll') { st.dll = t.value; return; }
    if (t.dataset.opt) {
      if (t.dataset.key === '__draft') st.draftOpts[t.dataset.opt] = t.value;
      else saveOpt(t.dataset.key, t.dataset.opt, t.value, t.closest('.opx-game'));
    }
  });

  const baseGo = window.go;
  window.go = function (pg, el) {
    baseGo(pg, el);
    if (pg === 'opti') { st.live = null; load().then(() => detect(false)); } else clearTimeout(st.timer);
  };
})();
