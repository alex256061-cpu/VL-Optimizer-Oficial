/* ═══════════════════════════════════════════════════════════════════════
   admin-extra3.js — lote 2 do painel:
     · suspender / reativar conta (Auth Admin) no drawer do histórico
     · avisos de vencimento por e-mail (status, prévia, teste, enviar)
     · registro de ações (auditoria) com captura automática dos RPCs admin_*
     · aviso de venda nova em tempo real (polling)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!/^\/admin(\.html)?\/?$/.test(location.pathname)) return;

  const porId = (id) => document.getElementById(id);
  const todos = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const dataHora = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
  const dataBR = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return '—'; } };
  const guardar = (fn) => { try { return fn(); } catch (e) { console.warn('admin-extra3:', e && e.message); } };

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
    if (!r.ok) {
      const e = new Error(j.erro || ('falha ' + r.status));
      e.precisa = j.precisa || null;
      throw e;
    }
    return j;
  }

  function aviso(msg, tipo) {
    let el = porId('adm-toast');
    if (!el) { el = document.createElement('div'); el.id = 'adm-toast'; el.className = 'adm-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'adm-toast on' + (tipo === 'erro' ? ' erro' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'adm-toast' + (tipo === 'erro' ? ' erro' : ''); }, 3600);
  }

  /* ── modal genérico ── */
  function modal(titulo, corpoHtml, opcoes) {
    let m = porId('adm-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'adm-modal';
      m.className = 'adm-modal';
      m.innerHTML = '<div class="adm-modal-overlay" data-modal-close></div>' +
        '<div class="adm-modal-caixa" role="dialog" aria-modal="true">' +
        '<header><b id="adm-modal-titulo">—</b><button class="adm-drawer-x" data-modal-close aria-label="Fechar">×</button></header>' +
        '<div class="adm-modal-corpo" id="adm-modal-corpo"></div></div>';
      document.body.appendChild(m);
      m.querySelectorAll('[data-modal-close]').forEach((b) => b.onclick = () => m.classList.remove('on'));
    }
    porId('adm-modal-titulo').textContent = titulo;
    porId('adm-modal-corpo').innerHTML = corpoHtml;
    m.classList.add('on');
    if (opcoes && typeof opcoes.onMount === 'function') opcoes.onMount(porId('adm-modal-corpo'));
    return porId('adm-modal-corpo');
  }

  /* ══════════════════ 1) suspender / reativar conta (no drawer) ══════════ */

  let emailDrawer = null;
  let fichaDrawer = null;

  function injetarExtraDrawer() {
    const corpo = porId('hist-corpo');
    const ident = porId('hist-ident');
    if (!corpo || !ident || !emailDrawer) return;
    if (porId('hist-extra')) return;
    const div = document.createElement('div');
    div.id = 'hist-extra';
    div.className = 'adm-drawer-extra';
    const auth = (fichaDrawer && fichaDrawer.auth) || {};
    div.innerHTML =
      '<div class="adm-drawer-status">' +
      (auth.suspenso
        ? '<span class="adm-badge-suspenso">CONTA SUSPENSA</span><small>motivo: ' + esc(auth.ban_reason || '—') + '</small>'
        : '<span class="adm-badge-ok">CONTA ATIVA</span>') +
      '<small>último acesso: ' + dataHora(auth.last_sign_in_at) + '</small>' +
      '</div>' +
      '<div class="adm-drawer-acoes">' +
      (auth.suspenso
        ? '<button class="adm-btn pequeno" data-l2="reativar">Reativar conta</button>'
        : '<button class="adm-btn pequeno perigo" data-l2="suspender">Suspender conta</button>') +
      '<button class="adm-btn pequeno ghost" data-l2="lembrete">Enviar lembrete por e-mail</button>' +
      '<button class="adm-btn pequeno ghost" data-l2="email">Alterar e-mail</button>' +
      '</div>';
    const acoes = corpo.querySelector('.adm-drawer-acoes');
    if (acoes) acoes.insertAdjacentElement('afterend', div);
    else corpo.insertBefore(div, corpo.firstChild);

    div.querySelector('[data-l2="suspender"]')?.addEventListener('click', () => suspender(emailDrawer, true));
    div.querySelector('[data-l2="reativar"]')?.addEventListener('click', () => suspender(emailDrawer, false));
    div.querySelector('[data-l2="lembrete"]')?.addEventListener('click', () => enviarLembrete(emailDrawer));
    div.querySelector('[data-l2="email"]')?.addEventListener('click', () => alterarEmail(emailDrawer));
  }

  async function carregarFichaDrawer(email) {
    try {
      fichaDrawer = await apiGet('/api/admin-cliente?email=' + encodeURIComponent(email));
    } catch (e) { fichaDrawer = null; }
    injetarExtraDrawer();
  }

  async function suspender(email, banir) {
    const motivo = banir ? prompt('Motivo da suspensão (aparece no histórico):', '') : null;
    if (banir && (motivo === null)) return;
    if (banir && !String(motivo).trim()) { aviso('Informe o motivo.', 'erro'); return; }
    if (!confirm(banir ? 'Suspender a conta ' + email + '? O login fica bloqueado no site e no app.' : 'Reativar a conta ' + email + '?')) return;
    try {
      await apiPost('/api/admin-ban', { email, acao: banir ? 'banir' : 'desbanir', motivo: banir ? String(motivo).trim() : '' });
      aviso(banir ? 'Conta suspensa.' : 'Conta reativada.');
      // 1) atualiza na hora com o que acabou de acontecer (não espera o servidor)
      const authAtual = Object.assign({}, (fichaDrawer && fichaDrawer.auth) || {});
      authAtual.suspenso = banir;
      authAtual.ban_reason = banir ? String(motivo).trim() : null;
      authAtual.banned_until = banir ? 'suspenso' : null;
      fichaDrawer = Object.assign({}, fichaDrawer || {}, { auth: authAtual });
      const antigoEl = porId('hist-extra');
      if (antigoEl) antigoEl.remove();
      injetarExtraDrawer();
      // 2) busca os dados completos do servidor em segundo plano
      apiGet('/api/admin-cliente?email=' + encodeURIComponent(email)).then((d) => {
        if (!d || !d.auth) return;
        fichaDrawer = d;
        const velho = porId('hist-extra');
        if (velho) velho.remove();
        injetarExtraDrawer();
      }).catch(() => {});
    } catch (e) {
      aviso('Não foi possível: ' + e.message, 'erro');
    }
  }


  async function alterarEmail(emailAtual) {
    const novo = prompt('Novo e-mail de login para ' + emailAtual + ':', '');
    if (!novo) return;
    const limpo = String(novo).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(limpo)) { aviso('E-mail inválido.', 'erro'); return; }
    if (!confirm('Trocar o login de ' + emailAtual + ' para ' + limpo + '?\n\nO cliente passa a entrar com o e-mail novo; a senha continua a mesma.')) return;
    try {
      await apiPost('/api/admin-alterar-email', { email_atual: emailAtual, email_novo: limpo });
      aviso('E-mail alterado para ' + limpo);
      emailDrawer = limpo;
      const ident = porId('hist-ident');
      if (ident) {
        ident.innerHTML = ident.innerHTML.split(emailAtual).join(limpo);
      }
      fichaDrawer = null;
      const antigo = porId('hist-extra');
      if (antigo) antigo.remove();
      carregarFichaDrawer(limpo);
    } catch (e) { aviso('Não foi possível: ' + e.message, 'erro'); }
  }
  async function enviarLembrete(email) {
    try {
      const r = await apiPost('/api/admin-email', { acao: 'enviar', email });
      aviso('E-mail enviado para ' + email + ' (' + (r.provedor || 'provedor') + ')');
    } catch (e) {
      if (e.precisa) aviso('E-mail não configurado. Falta: ' + e.precisa.join(', '), 'erro');
      else aviso('Não foi possível: ' + e.message, 'erro');
    }
  }

  // observa o drawer do histórico: quando abrir, busca os dados do l2
  function observarDrawer() {
    const alvo = document.body;
    new MutationObserver(() => {
      const drawer = porId('adm-drawer');
      const ident = porId('hist-ident');
      if (!drawer || !drawer.classList.contains('on') || !ident) return;
      const txt = ident.innerText || '';
      const m = /[\w.+-]+@[\w.-]+\.\w+/.exec(txt);
      const email = m ? m[0] : null;
      if (email && email !== emailDrawer) {
        emailDrawer = email;
        const antigo = porId('hist-extra');
        if (antigo) antigo.remove();
        carregarFichaDrawer(email);
      }
      if (porId('hist-extra') && fichaDrawer && emailDrawer === email) injetarExtraDrawer();
    }).observe(alvo, { childList: true, subtree: true, characterData: true });
  }

  /* ══════════════════ 2) avisos de vencimento (Resumo) ══════════════════ */

  function blocoAvisos() {
    const secao = porId('tab-resumo');
    if (!secao || porId('adm-avisos')) return;
    const bloco = document.createElement('div');
    bloco.className = 'adm-bloco';
    bloco.id = 'adm-avisos';
    bloco.innerHTML =
      '<h2>Avisos de vencimento <span>e-mail para quem está perto de vencer</span></h2>' +
      '<div id="avisos-status" class="adm-avisos-status">carregando…</div>' +
      '<div class="adm-avisos-acoes">' +
      '<button class="adm-btn pequeno ghost" id="avisos-ver">Ver e-mail</button>' +
      '<button class="adm-btn pequeno ghost" id="avisos-testar">Enviar teste</button>' +
      '<button class="adm-btn pequeno" id="avisos-enviar">Enviar lembretes</button>' +
      '<button class="adm-btn pequeno ghost" id="avisos-atualizar">Atualizar</button>' +
      '</div>' +
      '<div id="avisos-lista"></div>';
    const cabeca = secao.querySelector('.adm-cabeca');
    const cards = secao.querySelector('.adm-cards');
    if (cards) cards.insertAdjacentElement('afterend', bloco);
    else secao.appendChild(bloco);

    porId('avisos-ver').onclick = () => verEmail();
    porId('avisos-testar').onclick = () => testarEmail();
    porId('avisos-enviar').onclick = () => enviarTodos();
    porId('avisos-atualizar').onclick = () => carregarAvisos();
    carregarAvisos();
  }

  async function carregarAvisos() {
    const statusEl = porId('avisos-status');
    const lista = porId('avisos-lista');
    if (!statusEl) return;
    statusEl.textContent = 'consultando…';
    try {
      const d = await apiGet('/api/admin-email');
      if (d.configurado) {
        statusEl.innerHTML = '<span class="adm-badge-ok">ATIVO</span> provedor <b>' + esc(d.provedor) + '</b> · remetente <b>' + esc(d.remetente) + '</b> · <b>' + (d.vencendo || []).length + '</b> licença(s) vencendo em 7 dias · <b>' + (d.avisos || []).length + '</b> aviso(s) enviados recentemente';
      } else {
        statusEl.innerHTML = '<span class="adm-badge-suspenso">NÃO CONFIGURADO</span> falta configurar: <b>' + esc((d.precisa || []).join(', ')) + '</b> · <span class="adm-avisos-dica">o e-mail sai por SMTP2GO, Elastic Email, SendGrid, Mailjet, Brevo ou Resend. A prévia já funciona.</span>';
      }
      const venc = (d.vencendo || []).slice(0, 10);
      lista.innerHTML = venc.length
        ? '<div class="adm-avisos-titulo">Vencendo:</div>' + venc.map((v) =>
            '<div class="adm-aviso-linha"><div><b>' + esc(v.email) + '</b><small>vence ' + dataBR(v.expira) + ' · ' + v.dias + ' dia(s)</small></div><button class="adm-acao" data-enviar-aviso="' + esc(v.email) + '">Enviar</button></div>').join('')
        : '<div class="adm-vazio">Nenhuma licença vencendo nos próximos 7 dias.</div>';
      lista.querySelectorAll('[data-enviar-aviso]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true; b.textContent = '...';
          try { await apiPost('/api/admin-email', { acao: 'enviar', email: b.dataset.enviarAviso }); aviso('E-mail enviado.'); b.textContent = '✓'; }
          catch (e) { aviso(e.precisa ? 'Não configurado: ' + e.precisa.join(', ') : e.message, 'erro'); b.textContent = 'Enviar'; b.disabled = false; }
        };
      });
    } catch (e) {
      statusEl.innerHTML = '<span class="adm-badge-suspenso">ERRO</span> ' + esc(e.message);
      lista.innerHTML = '';
    }
  }

  async function verEmail() {
    try {
      const d = await apiPost('/api/admin-email', { acao: 'preview', modelo: 'vence7' });
      modal('Prévia do e-mail · ' + d.assunto, '<div class="adm-email-previa"><div class="adm-email-assunto"><b>Assunto:</b> ' + esc(d.assunto) + '</div><iframe class="adm-email-frame" sandbox srcdoc="' + esc(d.html).replace(/"/g, '&quot;') + '"></iframe></div>');
    } catch (e) { aviso('Não foi possível montar a prévia: ' + e.message, 'erro'); }
  }

  async function testarEmail() {
    const email = prompt('Enviar e-mail de teste para qual endereço?', 'mluccas218@gmail.com');
    if (!email) return;
    try {
      const r = await apiPost('/api/admin-email', { acao: 'teste', email: String(email).trim(), modelo: 'vence7' });
      aviso('Teste enviado para ' + r.para + ' (' + r.provedor + ')');
    } catch (e) {
      if (e.precisa) {
        modal('E-mail não configurado', '<p>Para ativar o envio, configure na Cloudflare Pages:</p><ul class="adm-lista-config"><li><b>' + esc(e.precisa.join('</b></li><li><b>')) + '</b></li></ul><p>Depois basta recarregar o painel. A prévia já mostra exatamente o texto que será enviado.</p>');
      } else aviso('Não foi possível: ' + e.message, 'erro');
    }
  }

  async function enviarTodos() {
    if (!confirm('Enviar lembrete de vencimento para todas as licenças que vencem nos próximos 7 dias?\n\nCada pessoa recebe no máximo 1 e-mail por dia.')) return;
    try {
      const r = await apiPost('/api/admin-email', { acao: 'lembretes' });
      aviso('Lembretes: ' + (r.enviados || 0) + ' enviado(s), ' + (r.pulados || 0) + ' já tinham recebido hoje.');
      carregarAvisos();
    } catch (e) {
      aviso(e.precisa ? 'Não configurado: ' + e.precisa.join(', ') : ('Não foi possível: ' + e.message), 'erro');
    }
  }

  /* ══════════════════ 3) registro de ações (auditoria) ══════════════════ */

  function criarLogDrawer() {
    if (porId('adm-log-drawer')) return;
    const d = document.createElement('div');
    d.id = 'adm-log-drawer';
    d.className = 'adm-drawer';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML =
      '<div class="adm-drawer-overlay" data-log-close></div>' +
      '<aside class="adm-drawer-painel" role="dialog" aria-modal="true" aria-label="Registro de ações">' +
      '<header class="adm-drawer-topo"><div><b>Registro de ações</b><small>quem fez o quê no painel</small></div><button class="adm-drawer-x" data-log-close aria-label="Fechar">×</button></header>' +
      '<div class="adm-drawer-corpo"><div class="adm-tools" style="margin-bottom:12px"><button class="adm-btn pequeno ghost" id="adm-log-atualizar">Atualizar</button></div><div id="adm-log-lista"><div class="adm-vazio">Carregando…</div></div></div>' +
      '</aside>';
    document.body.appendChild(d);
    d.querySelectorAll('[data-log-close]').forEach((b) => b.onclick = () => d.classList.remove('on'));
    porId('adm-log-atualizar').onclick = () => carregarLog();
  }

  async function abrirLog() {
    criarLogDrawer();
    porId('adm-log-drawer').classList.add('on');
    await carregarLog();
  }

  async function carregarLog() {
    const lista = porId('adm-log-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="adm-vazio">Carregando…</div>';
    try {
      const d = await apiGet('/api/admin-log?limite=60');
      const itens = d.itens || [];
      if (!itens.length) { lista.innerHTML = '<div class="adm-vazio">Nenhuma ação registrada ainda.</div>'; return; }
      lista.innerHTML = itens.map((x) =>
        '<div class="adm-log-linha">' +
        '<div class="adm-log-quando">' + esc(dataHora(x.quando)) + '</div>' +
        '<div class="adm-log-conteudo"><b>' + esc(x.acao) + '</b>' + (x.alvo ? ' · <span>' + esc(x.alvo) + '</span>' : '') + (x.detalhe ? '<small>' + esc(String(x.detalhe).slice(0, 160)) + '</small>' : '') + '<small class="adm-log-admin">por ' + esc(x.admin) + '</small></div>' +
        '</div>').join('');
    } catch (e) {
      lista.innerHTML = '<div class="adm-vazio">Não foi possível carregar: ' + esc(e.message) + '</div>';
    }
  }

  /* captura automática de ações feitas no admin.js (RPCs admin_*) */
  function espionarRpc() {
    const original = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const resposta = await original(input, init);
      try {
        if (url.includes('/rest/v1/rpc/admin_') && resposta.ok) {
          const nome = url.split('/rpc/')[1].split('?')[0];
          let corpo = {};
          try { corpo = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { }
          let token = '';
          try {
            const h = init && init.headers;
            token = (h && (h.Authorization || h.authorization)) || '';
            if (token && !String(token).startsWith('Bearer ')) token = 'Bearer ' + token;
          } catch (e) { }
          const alvo = corpo.email_alvo || corpo.p_email || corpo.email || null;
          original('/api/admin-log', {
            method: 'POST',
            headers: { Authorization: token || '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: nome, alvo: alvo, detalhe: JSON.stringify(corpo).slice(0, 300) }),
          }).catch(() => { });
        }
      } catch (e) { }
      return resposta;
    };
  }

  /* ══════════════════ 4) aviso de venda nova (polling) ══════════════════ */

  function criarPillVendas() {
    const marca = document.querySelector('.adm-marca');
    if (!marca || porId('adm-vendas-novas')) return;
    const a = document.createElement('button');
    a.id = 'adm-vendas-novas';
    a.className = 'adm-vendas-novas';
    a.title = 'Vendas novas desde que o painel abriu';
    a.innerHTML = '<i></i><b>0</b>';
    a.onclick = () => { const item = document.querySelector('.adm-item[data-tab="vendas"]'); if (item) item.click(); };
    marca.appendChild(a);
  }

  function vigiarVendas() {
    const CHAVE = 'vlAdmUltimaVenda';
    let desde = localStorage.getItem(CHAVE) || new Date(Date.now() - 5 * 60000).toISOString();
    let pendentes = 0;
    const pill = () => porId('adm-vendas-novas');
    const pintar = () => { const p = pill(); if (p) { p.querySelector('b').textContent = String(pendentes); p.classList.toggle('on', pendentes > 0); } };
    criarPillVendas();
    pintar();
    const tick = async () => {
      try {
        const d = await apiGet('/api/admin-vendas-recentes?desde=' + encodeURIComponent(desde));
        const itens = d.itens || [];
        if (itens.length) {
          pendentes += itens.length;
          desde = d.agora || new Date().toISOString();
          localStorage.setItem(CHAVE, desde);
          const primeira = itens[0];
          aviso('Nova venda: ' + reais(primeira.valor) + ' · ' + primeira.email + (itens.length > 1 ? ' (+' + (itens.length - 1) + ')' : ''));
          pintar();
        } else {
          desde = d.agora || desde;
          localStorage.setItem(CHAVE, desde);
        }
      } catch (e) { }
    };
    setTimeout(tick, 1500);
    setInterval(tick, 20000);
  }

  /* ══════════════════ ganchos ══════════════════ */

  window.__vlAlterarEmail = alterarEmail;

  function iniciar() {
    guardar(observarDrawer);
    guardar(blocoAvisos);
    guardar(() => {
      const secao = porId('tab-resumo');
      const cab = secao && secao.querySelector('.adm-cabeca');
      if (cab && !porId('adm-log-btn')) {
        const tools = document.createElement('div');
        tools.className = 'adm-tools';
        tools.innerHTML = '<button class="adm-btn pequeno ghost" id="adm-log-btn">Registro de ações</button>';
        cab.appendChild(tools);
        porId('adm-log-btn').onclick = () => abrirLog();
      }
    });
    guardar(espionarRpc);
    guardar(vigiarVendas);
  }

  const espera = setInterval(() => {
    const painel = porId('painel');
    if (painel && painel.style.display !== 'none') {
      clearInterval(espera);
      setTimeout(() => guardar(iniciar), 700);
    }
  }, 300);
  setTimeout(() => clearInterval(espera), 30000);
})();
