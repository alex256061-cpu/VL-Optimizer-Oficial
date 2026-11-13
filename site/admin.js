/* admin.js — painel administrativo do VL Optimizer
 *
 * Fala com o Supabase pelo supabase-client.js. As funções do banco (admin_resumo,
 * admin_usuarios, admin_pcs, admin_liberar, admin_remover, admin_liberar_pc) só respondem
 * para quem estiver marcado como administrador no perfil — a verificação é feita no banco,
 * não aqui. Esta tela apenas mostra o resultado.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let dados = { resumo: null, usuarios: [], pcs: [], vendas: null, licencas: [], chaves: null, hardware: null };

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

      // carrega a aba sob demanda (evita consultar tudo ao abrir)
      const qual = a.dataset.tab;
      if (qual === 'vendas' && !dados.vendas) carregarVendas($('vend-periodo')?.value || 30).catch((e) => console.warn(e));
      if (qual === 'licencas' && !dados.licencas.length) carregarLicencas($('lic-filtro')?.value).catch((e) => console.warn(e));
      if (qual === 'chaves' && !dados.chaves) carregarChaves().catch((e) => console.warn(e));
      if (qual === 'graficos' && !dados.hardware) carregarHardware().catch((e) => console.warn(e));
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


  // ── VENDAS ──
  async function carregarVendas(periodo) {
    const dias = Number(periodo || 30);
    const v = await rpc('admin_vendas', { p_dias: dias });
    dados.vendas = v || {};

    const n = (x) => (x == null ? '—' : x);
    $('v-total').textContent = 'R$ ' + Number(v.total || 0).toFixed(2).replace('.', ',');
    $('v-qtd').textContent = n(v.quantidade);
    $('v-ticket').textContent = 'R$ ' + Number(v.ticket || 0).toFixed(2).replace('.', ',');
    $('v-vital').textContent = n(v.vitalicios);

    // gráfico de barras por dia
    const g = $('grafico-vendas');
    const pordia = v.por_dia || [];
    if (!pordia.length) {
      g.innerHTML = '<div class="adm-vazio">Sem vendas no período.</div>';
    } else {
      const max = Math.max(...pordia.map((d) => Number(d.total) || 0), 1);
      g.innerHTML = pordia.map((d) => {
        const h = Math.max(4, Math.round((Number(d.total) / max) * 100));
        const dt = String(d.dia).slice(8, 10) + '/' + String(d.dia).slice(5, 7);
        return '<div class="adm-barra" title="R$ ' + Number(d.total).toFixed(2) + '">' +
          '<div class="adm-barra-valor">' + d.qtd + '</div>' +
          '<div class="adm-barra-preenchida" style="height:' + h + '%"></div>' +
          '<div class="adm-barra-dia">' + dt + '</div></div>';
      }).join('');
    }

    // tabela
    const tb = $('tb-vendas');
    const ult = v.ultimas || [];
    if (!ult.length) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;opacity:.6">Nenhuma venda registrada ainda.</td></tr>';
    } else {
      tb.innerHTML = ult.map((x) => '<tr>' +
        '<td class="num">' + data(x.criado_em) + '</td>' +
        '<td class="email">' + esc(x.email) + '</td>' +
        '<td>' + esc(x.plano || '—') + '</td>' +
        '<td class="num">R$ ' + Number(x.valor || 0).toFixed(2).replace('.', ',') + '</td>' +
        '<td>' + esc(x.metodo || '—') + '</td></tr>').join('');
    }
  }

  // ── LICENÇAS ──
  async function carregarLicencas(filtro) {
    const l = await rpc('admin_licencas', { p_filtro: filtro || null });
    dados.licencas = Array.isArray(l) ? l : [];

    const tb = $('tb-licencas');
    if (!dados.licencas.length) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;opacity:.6">Nenhuma licença encontrada.</td></tr>';
      return;
    }
    tb.innerHTML = dados.licencas.map((x) => {
      const sit = { ativa: 'ativa', vencida: 'vencido', vencida_7d: 'vencido', vitalicio: 'vitalicio', sem_prazo: 'vitalicio' }[x.situacao] || 'gratis';
      const rot = { ativa: 'Ativa', vencida: 'Vencida', vencida_7d: 'Vencida', vitalicio: 'Vitalícia', sem_prazo: 'Sem prazo' }[x.situacao] || x.situacao;
      const dias = x.lifetime || x.vence_em === null ? '∞' : (x.dias_restantes == null ? '—' : x.dias_restantes + 'd');
      return '<tr>' +
        '<td class="email">' + esc(x.email) + '</td>' +
        '<td>' + esc(x.name || '—') + '</td>' +
        '<td><span class="tag ' + sit + '">' + rot + '</span></td>' +
        '<td class="num">' + (x.lifetime ? '—' : data(x.vence_em)) + '</td>' +
        '<td class="num">' + dias + '</td></tr>';
    }).join('');
  }

  // ── CHAVES ──
  async function carregarChaves() {
    const c = await rpc('admin_chaves', {});
    dados.chaves = c || {};

    $('ck-total').textContent = c.total ?? '—';
    $('ck-livres').textContent = c.livres ?? '—';
    $('ck-usadas').textContent = c.usadas ?? '—';
    $('ck-cancel').textContent = c.canceladas ?? '—';

    const tb = $('tb-chaves');
    const lista = c.lista || [];
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:26px;opacity:.6">Nenhuma chave gerada ainda.</td></tr>';
      return;
    }
    tb.innerHTML = lista.map((k) => {
      const sit = k.cancelada ? 'cancelada' : (k.usado_em ? 'usada' : 'livre');
      const rot = { cancelada: 'Cancelada', usada: 'Usada', livre: 'Disponível' }[sit];
      const cls = { cancelada: 'vencido', usada: 'gratis', livre: 'ativo' }[sit];
      return '<tr>' +
        '<td class="num" style="color:var(--text);font-weight:700">' + esc(k.codigo) + '</td>' +
        '<td>' + esc(k.plano) + (k.dias ? ' · ' + k.dias + 'd' : ' · vitalício') + '</td>' +
        '<td><span class="tag ' + cls + '">' + rot + '</span></td>' +
        '<td>' + esc(k.usado_por_email || '—') + '</td>' +
        '<td class="num">' + (k.usado_em ? data(k.usado_em) : '—') + '</td>' +
        '<td>' + (!k.cancelada && !k.usado_em ? '<button class="adm-acao perigo" data-cancelar="' + esc(k.codigo) + '">Cancelar</button>' : '—') + '</td></tr>';
    }).join('');

    tb.querySelectorAll('[data-cancelar]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Cancelar a chave ' + b.dataset.cancelar + '?')) return;
        try { await rpc('admin_cancelar_chave', { p_codigo: b.dataset.cancelar }); carregarChaves(); }
        catch (e) { alert('Não foi possível: ' + e.message); }
      };
    });
  }

  // ── HARDWARE ──
  async function carregarHardware() {
    const hw = await rpc('admin_hardware', {});
    dados.hardware = hw || {};

    const pintar = (id, lista) => {
      const el = $(id);
      const arr = Array.isArray(lista) ? lista : [];
      if (!arr.length) { el.innerHTML = '<div class="adm-vazio">Nenhum dado ainda. O aplicativo envia quando o cliente entra.</div>'; return; }
      const max = Math.max(...arr.map((x) => Number(x.qtd) || 0), 1);
      el.innerHTML = arr.map((x) => {
        const pct = Math.round((Number(x.qtd) / max) * 100);
        const nome = x.nome || x.faixa || '?';
        return '<div class="adm-barra-linha">' +
          '<div class="adm-barra-nome" title="' + esc(nome) + '">' + esc(nome) + '</div>' +
          '<div class="adm-barra-trilha"><div class="adm-barra-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="adm-barra-qtd">' + x.qtd + '</div></div>';
      }).join('');
    };

    pintar('graf-gpu', hw.gpus);
    pintar('graf-cpu', hw.cpus);
    pintar('graf-ram', hw.ramos);
    pintar('graf-sis', hw.sistemas);
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
  $('vend-periodo')?.addEventListener('change', () => carregarVendas($('vend-periodo').value).catch(() => { }));
  $('lic-filtro')?.addEventListener('change', () => carregarLicencas($('lic-filtro').value).catch(() => { }));

  // gerar chaves
  $('ch-plano')?.addEventListener('change', () => {
    const vitalicio = $('ch-plano').value === 'vitalicio';
    $('ch-dias').disabled = vitalicio;
    $('ch-dias').value = vitalicio ? '' : '30';
  });

  $('ch-criar')?.addEventListener('click', async () => {
    const aviso = $('ch-aviso');
    const b = $('ch-criar');
    const qtd = Number($('ch-qtd').value || 1);
    const plano = $('ch-plano').value;
    const dias = Number($('ch-dias').value || 30);

    b.disabled = true; b.textContent = 'Gerando...';
    try {
      const r = await rpc('admin_criar_chaves', { qtd, p_plano: plano, p_dias: dias });
      if (r && r.erro) throw new Error(r.erro);
      const codigos = (r.chaves || []).map((c) => c.codigo);
      aviso.className = 'adm-aviso ok';
      aviso.textContent = codigos.length + ' chave(s) criada(s).';
      $('ch-novas').innerHTML = '<div style="font-family:monospace;font-size:13px;color:var(--text);line-height:1.9;background:rgba(255,255,255,.04);padding:14px;border-radius:9px">' +
        codigos.map((c) => esc(c)).join('<br>') + '</div>';
      carregarChaves();
    } catch (e) {
      aviso.className = 'adm-aviso erro';
      aviso.textContent = 'Não foi possível: ' + e.message;
    }
    b.disabled = false; b.textContent = 'Gerar';
  });
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
