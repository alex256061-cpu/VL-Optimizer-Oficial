/* admin.js — painel administrativo do VL Optimizer
 *
 * Fala com o Supabase pelo supabase-client.js. As funções do banco (admin_resumo,
 * admin_usuarios, admin_pcs, admin_liberar, admin_remover, admin_liberar_pc) só respondem
 * para quem estiver marcado como administrador no perfil — a verificação é feita no banco,
 * não aqui. Esta tela apenas mostra o resultado.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let dados = { resumo: null, usuarios: [], pcs: [] };

  // ── utilidades ──
  function data(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function rpc(nome, corpo) {
    const s = await SUPABASE.sessaoValida();
    if (!s) throw new Error('sem sessao');
    const r = await fetch(SUPABASE.URL + '/rest/v1/rpc/' + nome, {
      method: 'POST',
      headers: {
        apikey: SUPABASE.KEY,
        Authorization: 'Bearer ' + s.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo || {}),
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = { raw: txt }; }
    if (!r.ok) throw new Error((j && (j.message || j.erro)) || 'falha');
    return j;
  }

  // ── abas ──
  document.querySelectorAll('.adm-item').forEach((a) => {
    a.onclick = () => {
      document.querySelectorAll('.adm-item').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.adm-tab').forEach((x) => x.classList.remove('on'));
      a.classList.add('on');
      const tab = $('tab-' + a.dataset.tab);
      if (tab) tab.classList.add('on');
    };
  });

  // ── carregar ──
  async function carregar() {
    dados.resumo = await rpc('admin_resumo');
    dados.usuarios = await rpc('admin_usuarios');
    dados.pcs = await rpc('admin_pcs');

    // resumo
    const r = dados.resumo || {};
    $('c-usuarios').textContent = r.total_usuarios ?? '—';
    $('c-pagos').textContent = r.total_pagos ?? '—';
    $('c-gratis').textContent = r.total_gratis ?? '—';
    $('c-pcs').textContent = r.total_pcs ?? '—';
    $('l-ativas').textContent = r.licencas_ativas ?? '—';
    $('l-vencidas').textContent = r.licencas_vencidas ?? '—';
    $('l-vital').textContent = r.total_vitalicios ?? '—';
    $('l-7d').textContent = r.novos_7d ?? '—';
    $('l-30d').textContent = r.novos_30d ?? '—';

    pintarUsuarios();
    pintarPcs();
  }

  function pintarUsuarios() {
    const busca = ($('busca')?.value || '').toLowerCase().trim();
    const filtro = $('filtro-plano')?.value || '';

    const lista = (dados.usuarios || []).filter((u) => {
      if (busca && !(String(u.email || '').toLowerCase().includes(busca) || String(u.name || '').toLowerCase().includes(busca))) return false;
      if (filtro && u.situacao !== filtro) return false;
      return true;
    });

    const tb = $('tb-usuarios');
    if (!tb) return;

    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:26px;opacity:.6">Nenhum usuário encontrado.</td></tr>';
      return;
    }

    tb.innerHTML = lista.map((u) => `
      <tr>
        <td class="email">${esc(u.email)}${u.is_admin ? ' <span class="tag vitalicio" style="font-size:9px">admin</span>' : ''}</td>
        <td>${esc(u.name || '—')}</td>
        <td><span class="tag ${esc(u.situacao)}">${rotulo(u.situacao)}</span></td>
        <td class="num">${u.situacao === 'vitalicio' ? '—' : data(u.vence_em)}</td>
        <td class="num">${u.pcs || 0}</td>
        <td>
          <button class="adm-acao" data-acao="liberar30" data-email="${esc(u.email)}">+30d</button>
          <button class="adm-acao" data-acao="vitalicio" data-email="${esc(u.email)}">Vitalício</button>
          <button class="adm-acao" data-acao="liberarpc" data-email="${esc(u.email)}">Trocar PC</button>
          <button class="adm-acao perigo" data-acao="remover" data-email="${esc(u.email)}">Remover</button>
        </td>
      </tr>`).join('');

    tb.querySelectorAll('.adm-acao').forEach((b) => {
      b.onclick = () => acao(b.dataset.acao, b.dataset.email, b);
    });
  }

  function rotulo(s) {
    return { ativo: 'Ativo', vitalicio: 'Vitalício', vencido: 'Vencido', gratis: 'Grátis' }[s] || s;
  }

  function pintarPcs() {
    const tb = $('tb-pcs');
    if (!tb) return;
    const lista = dados.pcs || [];
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;opacity:.6">Nenhum computador ligado a uma conta ainda.</td></tr>';
      return;
    }
    tb.innerHTML = lista.map((p) => `
      <tr>
        <td class="email">${esc(p.nome || 'PC sem nome')}</td>
        <td>${esc(p.email || '—')}</td>
        <td class="num">${esc(p.placa || '—')}</td>
        <td class="num">${esc(p.hwid_curto || '—')}…</td>
        <td class="num">${data(p.ultimo)}</td>
      </tr>`).join('');
  }

  async function acao(tipo, email, botao) {
    const mapa = {
      liberar30: ['admin_liberar', { email_alvo: email, dias: 30 }, '30 dias liberados'],
      vitalicio: ['admin_liberar', { email_alvo: email, dias: null }, 'Vitalício liberado'],
      liberarpc: ['admin_liberar_pc', { email_alvo: email }, 'PC liberado'],
      remover: ['admin_remover', { email_alvo: email }, 'Acesso removido'],
    };
    const [fn, corpo, ok] = mapa[tipo] || [];
    if (!fn) return;

    if (tipo === 'remover' && !confirm('Remover o acesso de ' + email + '? A conta volta para o grátis.')) return;

    botao.disabled = true;
    botao.textContent = '...';
    try {
      const r = await rpc(fn, corpo);
      if (r && r.ok === false) throw new Error(r.erro || 'falhou');
      botao.textContent = '✓';
      setTimeout(() => { carregar(); }, 700);
    } catch (e) {
      alert('Não foi possível: ' + e.message);
      botao.textContent = 'erro';
      setTimeout(() => { botao.textContent = ''; }, 1500);
    }
    botao.disabled = false;
  }

  $('busca')?.addEventListener('input', pintarUsuarios);
  $('filtro-plano')?.addEventListener('change', pintarUsuarios);

  // form de liberar
  $('lib-ok')?.addEventListener('click', async () => {
    const email = $('lib-email').value.trim();
    const diasTxt = $('lib-dias').value;
    const aviso = $('lib-aviso');

    if (!email) { aviso.className = 'adm-aviso erro'; aviso.textContent = 'Digite o e-mail da conta.'; return; }

    const b = $('lib-ok');
    b.disabled = true; b.textContent = 'Liberando...';
    try {
      const r = await rpc('admin_liberar', { email_alvo: email, dias: diasTxt === '' ? null : Number(diasTxt) });
      if (r && r.ok === false) throw new Error(r.erro || 'falhou');
      aviso.className = 'adm-aviso ok';
      aviso.textContent = (diasTxt === '' ? 'Vitalício liberado' : diasTxt + ' dias liberados') + ' para ' + email + '.';
      $('lib-email').value = '';
      carregar();
    } catch (e) {
      aviso.className = 'adm-aviso erro';
      aviso.textContent = 'Não foi possível: ' + e.message;
    }
    b.disabled = false; b.textContent = 'Liberar';
  });

  $('sair')?.addEventListener('click', () => { SUPABASE.sair(); location.href = '/entrar'; });

  // ── entrada ──
  (async () => {
    const s = await SUPABASE.sessaoValida();
    if (!s) { location.href = '/entrar?voltar=/admin'; return; }

    const p = await SUPABASE.perfil();
    $('quem').textContent = (p && p.email) || '';

    // a permissão é do banco: se não for admin, admin_resumo devolve erro
    try {
      const r = await rpc('admin_resumo');
      if (!r || r.erro === 'sem permissao') throw new Error('sem permissao');
      await carregar();
      $('carregando').remove();
      $('painel').style.display = '';
    } catch (e) {
      $('carregando').remove();
      $('bloqueio').style.display = '';
      $('bloqueio-txt').textContent = e.message === 'sem permissao'
        ? 'Esta conta não é administradora.'
        : 'Não foi possível carregar: ' + e.message;
    }
  })();
})();
