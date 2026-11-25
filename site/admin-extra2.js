
/* ═══════════════════════════════════════════════════════════════════════
   admin-v4 — histórico do cliente, reset de PC por máquina e PIX pendentes
   (roda por cima do admin.js; usa as Functions protegidas /api/admin-*)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!/^\/admin(\.html)?\/?$/.test(location.pathname)) return;

  const porId = (id) => document.getElementById(id);
  const todos = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const reais = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBR = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return '—'; } };
  const dataHoraBR = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
  const quando = (iso) => {
    if (!iso) return '—';
    try {
      const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (min < 1) return 'agora';
      if (min < 60) return min + ' min';
      const h = Math.floor(min / 60);
      if (h < 24) return h + ' h';
      const d = Math.floor(h / 24);
      return d < 30 ? d + ' d' : dataBR(iso);
    } catch (e) { return '—'; }
  };
  const guardar = (fn) => { try { return fn(); } catch (e) { console.warn('admin-v4:', e && e.message); } };

  async function tokenSessao() {
    const s = await SUPABASE.sessaoValida();
    if (!s || !s.access_token) throw new Error('Sessão expirada. Entre de novo.');
    return s.access_token;
  }

  async function apiGet(caminho) {
    const token = await tokenSessao();
    const r = await fetch(caminho, { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({ ok: false, erro: 'resposta inválida' }));
    if (!r.ok) throw new Error(j.erro || ('falha ' + r.status));
    return j;
  }

  async function apiPost(caminho, corpo) {
    const token = await tokenSessao();
    const r = await fetch(caminho, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo || {}),
    });
    const j = await r.json().catch(() => ({ ok: false, erro: 'resposta inválida' }));
    if (!r.ok) throw new Error(j.erro || ('falha ' + r.status));
    return j;
  }

  async function rpc(nome, corpo) {
    const token = await tokenSessao();
    const r = await fetch(SUPABASE.URL + '/rest/v1/rpc/' + nome, {
      method: 'POST',
      headers: { apikey: SUPABASE.KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo || {}),
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && (j.message || j.erro)) || 'falha');
    return j;
  }

  /* ── aviso rápido (toast) ── */
  function aviso(msg, tipo) {
    let el = porId('adm-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adm-toast';
      el.className = 'adm-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'adm-toast on' + (tipo === 'erro' ? ' erro' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'adm-toast' + (tipo === 'erro' ? ' erro' : ''); }, 3200);
  }

  /* ══════════════════ HISTÓRICO DO CLIENTE (drawer) ══════════════════ */

  function criarDrawer() {
    if (porId('adm-drawer')) return;
    const wrap = document.createElement('div');
    wrap.id = 'adm-drawer';
    wrap.className = 'adm-drawer';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="adm-drawer-overlay" data-hist-close></div>' +
      '<aside class="adm-drawer-painel" role="dialog" aria-modal="true" aria-label="Histórico do cliente">' +
      '<header class="adm-drawer-topo">' +
      '<div id="hist-ident"><b>—</b><small>carregando…</small></div>' +
      '<button class="adm-drawer-x" data-hist-close aria-label="Fechar">×</button>' +
      '</header>' +
      '<div class="adm-drawer-corpo" id="hist-corpo"><div class="adm-vazio">Carregando o cliente…</div></div>' +
      '</aside>';
    document.body.appendChild(wrap);
  }

  function fecharDrawer() {
    const d = porId('adm-drawer');
    if (d) { d.classList.remove('on'); d.setAttribute('aria-hidden', 'true'); document.body.classList.remove('adm-com-drawer'); }
  }

  async function abrirHistorico(email) {
    criarDrawer();
    const drawer = porId('adm-drawer');
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('adm-com-drawer');
    const ident = porId('hist-ident');
    const corpo = porId('hist-corpo');
    ident.innerHTML = '<b>' + esc(email) + '</b><small>carregando…</small>';
    corpo.innerHTML = '<div class="adm-vazio">Buscando compras, PCs e chaves…</div>';

    try {
      const d = await apiGet('/api/admin-cliente?email=' + encodeURIComponent(email));
      const c = d.cliente || {};
      const plano = c.lifetime ? 'Vitalício' : (c.plan === 'pro' ? 'Pago' : 'Grátis');
      const vence = c.lifetime ? 'sem prazo' : (c.license_expires_at ? dataBR(c.license_expires_at) : '—');
      ident.innerHTML =
        '<b>' + esc(c.name || c.email || email) + '</b><small>' + esc(c.email || email) + ' · desde ' + dataBR(c.created_at) + '</small>' +
        '<div class="adm-drawer-tags"><span class="tag ' + (c.plan === 'pro' || c.lifetime ? 'ativo' : 'gratis') + '">' + esc(plano) + '</span>' +
        '<span class="tag gratis">vence: ' + esc(vence) + '</span>' +
        '<span class="tag gratis">' + (d.resumo ? d.resumo.pcs : 0) + '/' + (c.max_devices || 1) + ' PCs</span>' +
        (c.is_admin ? '<span class="tag admin">admin</span>' : '') + '</div>';

      const pcs = Array.isArray(d.devices) ? d.devices : [];
      const vendas = Array.isArray(d.vendas) ? d.vendas : [];
      const chaves = Array.isArray(d.chaves) ? d.chaves : [];
      const hw = d.hardware;

      corpo.innerHTML =
        '<div class="adm-drawer-kpis">' +
        '<div><b>' + reais(d.resumo ? d.resumo.total_pago : 0) + '</b><small>total pago</small></div>' +
        '<div><b>' + (d.resumo ? d.resumo.compras : 0) + '</b><small>compras</small></div>' +
        '<div><b>' + (d.resumo ? d.resumo.chaves : 0) + '</b><small>chaves usadas</small></div>' +
        '</div>' +

        '<div class="adm-drawer-acoes">' +
        '<button class="adm-btn pequeno" data-hist-acao="liberar30">+30 dias</button>' +
        '<button class="adm-btn pequeno" data-hist-acao="vitalicio">Vitalício</button>' +
        '<button class="adm-btn pequeno ghost" data-hist-acao="liberarpc">Trocar PC (todos)</button>' +
        '<button class="adm-btn pequeno perigo" data-hist-acao="remover">Remover acesso</button>' +
        '</div>' +

        '<section class="adm-drawer-secao"><h3>Computadores <span>' + pcs.length + '</span></h3>' +
        (pcs.length ? pcs.map((p) =>
          '<div class="adm-pc-linha">' +
          '<div class="adm-pc-id"><b>' + esc(p.device_name || 'PC sem nome') + '</b><small>' + esc(p.hwid ? String(p.hwid).slice(0, 22) + '…' : '—') + ' · ' + esc(quando(p.last_seen)) + '</small></div>' +
          '<button class="adm-acao perigo" data-remover-pc="' + esc(p.id) + '" data-email="' + esc(c.email || email) + '">Desvincular</button>' +
          '</div>').join('') : '<p class="adm-drawer-vazio">Nenhum PC vinculado.</p>') +
        '</section>' +

        '<section class="adm-drawer-secao"><h3>Compras <span>' + vendas.length + '</span></h3>' +
        (vendas.length ? vendas.map((v) =>
          '<div class="adm-hist-linha"><div><b>' + esc(v.plano || '—') + ' · ' + reais(v.valor) + '</b><small>' + dataHoraBR(v.criado_em) + ' · ' + esc(v.metodo || 'pix') + ' · ' + esc(v.status || '') + '</small></div><span class="tag ' + (String(v.status) === 'approved' ? 'ativo' : 'vencido') + '">' + esc(v.status || '') + '</span></div>').join('') : '<p class="adm-drawer-vazio">Nenhuma compra registrada.</p>') +
        '</section>' +

        '<section class="adm-drawer-secao"><h3>Chaves resgatadas <span>' + chaves.length + '</span></h3>' +
        (chaves.length ? chaves.map((k) =>
          '<div class="adm-hist-linha"><div><b>' + esc(k.codigo) + '</b><small>' + esc(k.plano || '') + (k.dias ? ' · ' + k.dias + 'd' : ' · ∞') + ' · ' + dataHoraBR(k.usado_em) + '</small></div>' + (k.cancelada ? '<span class="tag vencido">cancelada</span>' : '') + '</div>').join('') : '<p class="adm-drawer-vazio">Nenhuma chave resgatada.</p>') +
        '</section>' +

        '<section class="adm-drawer-secao"><h3>Hardware <span>' + (hw ? '' : '—') + '</span></h3>' +
        (hw ? '<div class="adm-drawer-hw"><span>' + esc(hw.gpu || 'GPU?') + '</span><span>' + esc(hw.cpu || 'CPU?') + '</span><span>' + (hw.ram_gb || '?') + ' GB</span><span>' + esc(hw.sistema || '') + '</span></div><small class="adm-drawer-vazio">atualizado ' + quando(hw.atualizado_em) + '</small>' : '<p class="adm-drawer-vazio">O app ainda não enviou o hardware.</p>') +
        '</section>';

      // ações do drawer
      corpo.querySelectorAll('[data-hist-acao]').forEach((b) => {
        b.onclick = () => acaoNoCliente(b.dataset.histAcao, c.email || email, b);
      });
      corpo.querySelectorAll('[data-remover-pc]').forEach((b) => {
        b.onclick = () => removerPc(b.dataset.removerPc, b.dataset.email, b);
      });
    } catch (e) {
      corpo.innerHTML = '<div class="adm-vazio">Não foi possível carregar: ' + esc(e.message) + '</div>';
    }
  }

  async function acaoNoCliente(tipo, email, botao) {
    const mapa = {
      liberar30: ['admin_liberar', { email_alvo: email, dias: 30 }, '+30 dias'],
      vitalicio: ['admin_liberar', { email_alvo: email, dias: null }, 'Vitalício'],
      liberarpc: ['admin_liberar_pc', { email_alvo: email }, 'PC'],
      remover: ['admin_remover', { email_alvo: email }, 'remover'],
    };
    const [fn, corpo, rotulo] = mapa[tipo] || [];
    if (!fn) return;
    if (tipo === 'remover' && !confirm('Remover o acesso de ' + email + '? A conta volta para grátis.')) return;
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = '...';
    try {
      const r = await rpc(fn, corpo);
      if (r && r.ok === false) throw new Error(r.erro || 'falhou');
      aviso(rotulo + ' aplicado a ' + email);
      botao.textContent = '✓';
      setTimeout(() => abrirHistorico(email), 500);
    } catch (e) {
      aviso('Não foi possível: ' + e.message, 'erro');
      botao.textContent = texto;
      botao.disabled = false;
    }
  }

  async function removerPc(id, email, botao) {
    if (!confirm('Desvincular este computador da conta ' + email + '?\n\nA licença continua ativa; o cliente poderá entrar de novo em outro PC (ou neste, se for o mesmo).')) return;
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = '...';
    try {
      const r = await apiPost('/api/admin-pc-remove', { deviceId: Number(id), email });
      if (!r.ok) throw new Error(r.erro || 'falhou');
      aviso('PC desvinculado: ' + ((r.removido && r.removido.device_name) || ('#' + id)));
      setTimeout(() => abrirHistorico(email), 500);
    } catch (e) {
      aviso('Não foi possível: ' + e.message, 'erro');
      botao.textContent = texto;
      botao.disabled = false;
    }
  }

  // exposto para o admin-extra4 (busca pela chave abrir o histórico)
  window.__vlAbrirHistorico = abrirHistorico;

  /* ══════════════════ PIX PENDENTES (aba Vendas) ══════════════════ */

  function montarBlocoPix() {
    const secao = porId('tab-vendas');
    if (!secao || porId('adm-pix')) return;
    const bloco = document.createElement('div');
    bloco.className = 'adm-bloco';
    bloco.id = 'adm-pix';
    bloco.innerHTML =
      '<h2>PIX pendentes <span>gerados e ainda não pagos</span></h2>' +
      '<div class="adm-pix-topo"><span id="pix-resumo">carregando…</span><button class="adm-btn pequeno ghost" id="pix-atualizar">Atualizar</button></div>' +
      '<div id="pix-lista"><div class="adm-vazio">Consultando o Mercado Pago…</div></div>';
    const cards = secao.querySelector('.adm-cards');
    if (cards) cards.insertAdjacentElement('afterend', bloco);
    else secao.appendChild(bloco);
    const b = porId('pix-atualizar');
    if (b) b.onclick = () => carregarPix();
  }

  async function carregarPix() {
    const lista = porId('pix-lista');
    const resumo = porId('pix-resumo');
    if (!lista) return;
    if (resumo) resumo.textContent = 'consultando…';
    lista.innerHTML = '<div class="adm-vazio">Consultando o Mercado Pago…</div>';
    try {
      const d = await apiGet('/api/admin-pix-pendentes?dias=7');
      const arr = Array.isArray(d.lista) ? d.lista : [];
      if (resumo) resumo.innerHTML = '<b>' + arr.length + '</b> pendente(s) · ' + reais(d.total) + ' em aberto';
      if (!arr.length) {
        lista.innerHTML = '<div class="adm-vazio">Nenhum PIX pendente nos últimos 7 dias.</div>';
        return;
      }
      lista.innerHTML = arr.map((p) =>
        '<div class="adm-pix-linha">' +
        '<div class="adm-pix-id"><b>' + esc(p.email) + '</b><small>' + esc(p.plano || '') + ' · ' + esc(p.status) + ' · ' + esc(quando(p.criado)) + ' · id ' + esc(p.id) + '</small></div>' +
        '<b class="adm-pix-valor">' + reais(p.valor) + '</b>' +
        '</div>').join('');
    } catch (e) {
      if (resumo) resumo.textContent = 'falhou';
      lista.innerHTML = '<div class="adm-vazio">Não foi possível consultar: ' + esc(e.message) + '</div>';
    }
  }

  /* ══════════════════ ganchos ══════════════════ */

  function ganchos() {
    criarDrawer();
    montarBlocoPix();
    carregarPix().catch(() => {});

    // Usuários: clicar na linha abre o histórico (menos nos botões de ação)
    const tbU = porId('tb-usuarios');
    if (tbU) tbU.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const tr = ev.target.closest('tr');
      if (!tr) return;
      const email = tr.querySelector('.email');
      if (email && /@/.test(email.textContent)) abrirHistorico(email.textContent.trim());
    });

    // Computadores: clicar na linha abre o histórico da conta do PC
    const tbP = porId('tb-pcs');
    if (tbP) tbP.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr');
      if (!tr) return;
      const cels = tr.querySelectorAll('td');
      const email = cels && cels[1] ? cels[1].textContent.trim() : '';
      if (/@/.test(email)) abrirHistorico(email);
    });

    // Vendas: ao abrir a aba, atualiza os PIX pendentes
    const itemVendas = document.querySelector('.adm-item[data-tab="vendas"]');
    if (itemVendas) itemVendas.addEventListener('click', () => setTimeout(() => carregarPix().catch(() => {}), 400));

    // fechar drawer
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-hist-close]')) fecharDrawer();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharDrawer(); });
  }

  const espera = setInterval(() => {
    const painel = porId('painel');
    if (painel && painel.style.display !== 'none') {
      clearInterval(espera);
      setTimeout(() => guardar(ganchos), 400);
    }
  }, 300);
  setTimeout(() => clearInterval(espera), 30000);
})();
