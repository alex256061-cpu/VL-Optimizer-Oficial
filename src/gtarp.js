// ── GTA RP (FiveM) ──
// Painel dentro de Meus jogos, aberto pelo botão do card do FiveM. O GTA V Legacy não tem DLSS/FSR,
// então aqui ficam as opções que dão FPS de verdade no FiveM sem risco de ban: gráficos do próprio
// GTA (main.js, 'fivem-gfx-*'), o recurso do driver da placa e o FiveM Enhanced.
(function () {
  const SCALES = [['Nativo', 'Desligado'], ['83%', '×0,833'], ['75%', '×0,750'], ['67%', '×0,667'], ['50%', '×0,500']];
  const SAMPLING_TO_IDX = { 0: 0, 5: 0, 4: 1, 3: 2, 2: 3, 1: 4 };
  const st = { data: null, loading: false, preset: null, scale: 0, borderless: true, dirty: false };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? '' : s));

  function driverHtml(d) {
    if (d.gpu === 'amd') return `
      <div class="gta-step"><div class="gta-step-t">AMD Fluid Motion Frames (AFMF)</div>
        <div class="gta-step-d">Geração de quadros no driver: funciona no GTA V (DX11) e pode dobrar o FPS mostrado. Placas RX 6000 ou mais novas. Não mexe no jogo: sem risco de ban.</div>
        <ol class="gta-ol"><li>Abra o AMD Software</li><li>Vá em <b>Jogos → Gráficos</b></li><li>Ligue <b>AMD Fluid Motion Frames</b></li></ol>
        <button class="fpm-btn ghost" data-gta="panel" data-vendor="amd">Abrir AMD Software</button></div>`;
    if (d.gpu === 'nvidia') return `
      <div class="gta-step"><div class="gta-step-t">NVIDIA Image Scaling (NIS)</div>
        <div class="gta-step-d">Upscale com nitidez feito pelo driver. O jogo roda numa resolução menor e o driver amplia para a tela, mais nítido que o Frame Scaling do GTA. Precisa do jogo em <b>tela cheia</b> (não sem bordas).</div>
        <ol class="gta-ol"><li>Painel de Controle NVIDIA → <b>Gerenciar as configurações 3D</b></li><li>Ligue <b>Escala de imagem</b></li><li>No GTA, escolha uma resolução menor que a do monitor (ex.: 85%)</li></ol>
        <button class="fpm-btn ghost" data-gta="panel" data-vendor="nvidia">Abrir Painel NVIDIA</button></div>`;
    return '';
  }

  function html(d) {
    const v = d.values || {};
    const cur = SAMPLING_TO_IDX[Number(v.SamplingMode)] ?? 0;
    const lock = d.running ? '<div class="opx-warn" style="margin-top:0">O FiveM está aberto. Feche o jogo para mudar os gráficos: ele regrava as configurações quando fecha.</div>' : '';
    const now = d.file ? `Agora: MSAA ${v.MSAA === '0' ? 'desligado' : 'x' + esc(v.MSAA)} · Grama ${['Normal', 'Alta', 'Muito alta', 'Ultra'][Number(v.GrassQuality)] || '?'} · Distância estendida ${Number(v.MaxLodScale) > 0 ? 'ligada' : 'desligada'} · Frame Scaling ${SCALES[cur][0]} · ${v.Windowed === '2' ? 'sem bordas' : v.Windowed === '1' ? 'janela' : 'tela cheia'}` : '';
    return `<div class="fpm-card gta-card" id="gta-card-inner">
      <div class="fpm-card-hdr"><div>
        <div class="fpm-title">GTA RP (FiveM): como ganhar FPS</div>
        <div class="fpm-sub">O GTA V que o FiveM usa (Legacy) não tem DLSS nem FSR, então o OptiScaler não serve nele. Estas opções dão FPS de verdade e nenhuma mexe dentro do jogo: sem risco de ban.</div></div>
        <span class="opx-chip yes">FiveM instalado</span></div>

      <div class="gta-grid">
        <div class="gta-step">
          <div class="gta-step-t">1. Gráficos do GTA</div>
          ${lock}
          ${d.file ? `
          <div class="gta-step-d">Os vilões do FPS no GTA V são MSAA, grama Ultra, sombras longas e a distância estendida. O L ajusta direto no arquivo do FiveM, com backup.</div>
          <div class="gta-seg" role="radiogroup" aria-label="Preset">
            <button data-gta="preset" data-v="fps" class="${st.preset === 'fps' ? 'on' : ''}"${d.running ? ' disabled' : ''}>FPS máximo<small>PC fraco</small></button>
            <button data-gta="preset" data-v="balanced" class="${st.preset === 'balanced' ? 'on' : ''}"${d.running ? ' disabled' : ''}>Equilibrado<small>bonito e leve</small></button>
            <button data-gta="preset" data-v="" class="${st.preset === null ? 'on' : ''}"${d.running ? ' disabled' : ''}>Manter<small>não mexer</small></button>
          </div>
          <div class="opx-opt-t" style="margin-top:14px">Frame Scaling (resolução interna)</div>
          <div class="opx-opt-d">O "upscaling" do próprio GTA: renderiza menos pixels e amplia para a tela. Quanto menor, mais FPS e menos nitidez.</div>
          <div class="gta-seg gta-seg-5">${SCALES.map(([t], i) => `<button data-gta="scale" data-v="${i}" class="${st.scale === i ? 'on' : ''}"${d.running ? ' disabled' : ''}>${t}</button>`).join('')}</div>
          <div class="opx-opt" style="margin-top:14px"><div class="opx-opt-l"><div class="opx-opt-t">Tela cheia sem bordas</div>
            <div class="opx-opt-d">Necessário para o contador de FPS do VL e para a geração de quadros por captura aparecerem por cima do jogo.</div></div>
            <div class="toggle${st.borderless ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${st.borderless}" aria-label="Tela cheia sem bordas" data-gta="borderless"></div></div>
          <div class="gta-now">${now}</div>
          <div class="opx-actions">
            <button class="fpm-btn" data-gta="apply"${d.running ? ' disabled' : ''}>Aplicar no FiveM</button>
            ${d.backup ? `<button class="fpm-btn ghost" data-gta="restore"${d.running ? ' disabled' : ''}>Restaurar o original</button>` : ''}
            <button class="fpm-btn ghost" data-gta="measure">Medir antes/depois</button>
          </div>` : '<div class="gta-step-d">Abra o FiveM uma vez e feche: é aí que ele cria o arquivo de configurações que o L ajusta.</div>'}
        </div>

        <div class="gta-side">
          ${driverHtml(d)}
          <div class="gta-step"><div class="gta-step-t">Servidor no FiveM Enhanced?</div>
            <div class="gta-step-d">Se o servidor já migrou para o <b>FiveM Enhanced</b> (lançado em julho de 2026), o próprio jogo tem <b>DLSS</b> (NVIDIA RTX), <b>DLSS Frame Generation</b> (RTX 40/50) e <b>FSR 3 com Frame Generation</b> (qualquer placa). Ligue no menu de gráficos do jogo: é nativo, sem risco. O cliente Enhanced só entra em servidores Enhanced.</div></div>
        </div>
      </div>
    </div>`;
  }

  async function load() {
    if (st.loading) return;
    st.loading = true;
    try { st.data = await ipcRenderer.invoke('fivem-gfx-status'); } catch (e) { st.data = null; }
    st.loading = false;
    if (st.data && st.data.success) {
      if (!st.dirty) {
        const v = st.data.values || {};
        st.preset = st.data.preset || null;
        st.scale = SAMPLING_TO_IDX[Number(v.SamplingMode)] ?? 0;
        st.borderless = v.Windowed ? v.Windowed === '2' : true;
      }
    }
    draw();
  }

  function draw() {
    const box = $('gta-card');
    if (!box) return;
    const d = st.data;
    box.innerHTML = d && d.success && (d.installed || d.file) ? html(d) : '';
  }

  async function apply(btn) {
    btn.disabled = true;
    btn.textContent = 'Aplicando…';
    const r = await ipcRenderer.invoke('fivem-gfx-apply', { preset: st.preset || null, scaling: st.scale, borderless: st.borderless });
    if (!r || !r.success) toast((r && r.error) || 'Não foi possível aplicar.');
    else { toast('Gráficos do FiveM ajustados. Abra o jogo para ver a diferença.'); addRecent('GTA RP: gráficos do FiveM ajustados', { page: 'jogos', el: $('gta-card') }); st.dirty = false; }
    load();
  }

  async function restore() {
    if (!confirm('Voltar os gráficos do FiveM para como estavam antes do L?')) return;
    const r = await ipcRenderer.invoke('fivem-gfx-restore');
    toast(r && r.success ? 'Gráficos do FiveM restaurados.' : (r && r.error) || 'Não foi possível restaurar.');
    st.dirty = false;
    load();
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-gta]');
    if (!t || !$('gta-card') || !$('gta-card').contains(t)) return;
    switch (t.dataset.gta) {
      case 'preset': st.preset = t.dataset.v || null; st.dirty = true; draw(); break;
      case 'scale': st.scale = Number(t.dataset.v); st.dirty = true; draw(); break;
      case 'borderless': st.borderless = !st.borderless; st.dirty = true; draw(); break;
      case 'apply': apply(t); break;
      case 'restore': restore(); break;
      case 'measure': goTo('fps'); break;
      case 'panel': {
        const r = await ipcRenderer.invoke('open-gpu-panel', { vendor: t.dataset.vendor });
        if (r && !r.success) toast(r.error);
        break;
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.key === ' ' || e.key === 'Enter') && t.dataset && t.dataset.gta === 'borderless') { e.preventDefault(); t.click(); }
  });

  function focus() {
    const el = $('gta-card-inner');
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash-target'); void el.offsetWidth; el.classList.add('flash-target');
    return true;
  }

  // Botão "Gráficos do GTA RP" do card do FiveM (e quem mais precisar levar o jogador até aqui).
  window.gtaOpen = async () => {
    const pg = $('pg-jogos');
    if (pg && !pg.classList.contains('active')) goTo('jogos');
    if (!focus()) { await load(); if (!focus()) toast('Abra o FiveM uma vez neste PC para liberar os ajustes do GTA RP.'); }
  };

  // Recarrega ao abrir Meus jogos: o arquivo do FiveM muda quando o jogo fecha.
  const baseGo = window.go;
  window.go = function (pg, el) {
    baseGo(pg, el);
    if (pg === 'jogos') load();
  };
  load();
})();
