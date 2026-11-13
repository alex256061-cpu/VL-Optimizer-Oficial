/* admin.js — painel administrativo do VL Optimizer
 *
 * Fala com o Supabase pelo supabase-client.js. As funções do banco (admin_*) só respondem
 * para quem tem is_admin no perfil. Esta tela apenas mostra o resultado.
 *
 * Gráficos em SVG puro, sem biblioteca externa: o site continua leve no Cloudflare.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const dados = { resumo: null, usuarios: [], pcs: [], vendas: null, licencas: [], chaves: null, hardware: null, atividade: null };
  let filtroUsuarios = '';

  // ── utilidades ───────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function data(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch (e) { return '—'; }
  }

  function quando(iso) {
    if (!iso) return '';
    try {
      const ms = Date.now() - new Date(iso).getTime();
      const min = Math.floor(ms / 60000);
      if (min < 1) return 'agora';
      if (min < 60) return min + ' min';
      const h = Math.floor(min / 60);
      if (h < 24) return h + ' h';
      const d = Math.floor(h / 24);
      if (d < 30) return d + ' d';
      return data(iso);
    } catch (e) { return ''; }
  }

  function reais(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }

  function inicial(txt) { return String(txt || 'V').trim().charAt(0).toUpperCase(); }

  function avatar(nome, cor) {
    const cores = ['', ' blue', ' green'];
    const c = cores[Math.abs(String(nome).length) % 3];
    return '<span class="adm-avatar' + c + '">' + esc(inicial(nome)) + '</span>';
  }

  function vazio(icone, titulo, texto) {
    return '<div class="adm-vazio">' + icone + '<b>' + titulo + '</b>' + texto + '</div>';
  }

  const ICONE_USUARIOS = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 8.5a3 3 0 0 1 0 6"/></svg>';
  const ICONE_PC = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>';
  const ICONE_CHAVE = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M14 7a4 4 0 1 1-5.6 3.6L4 15v3h3l1.4-1.4"/></svg>';
  const ICONE_GRAFICO = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20V8"/></svg>';

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

  // ── navegação ────────────────────────────────────────────────────────────
  document.querySelectorAll('.adm-item').forEach((a) => {
    a.onclick = () => {
      document.querySelectorAll('.adm-item').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.adm-tab').forEach((x) => x.classList.remove('on'));
      a.classList.add('on');
      const tab = $('tab-' + a.dataset.tab);
      if (tab) tab.classList.add('on');
      location.hash = a.dataset.tab;
      carregarAba(a.dataset.tab);
    };
  });

  function carregarAba(qual) {
    if (qual === 'vendas' && !dados.vendas) carregarVendas(30).catch(() => { });
    if (qual === 'licencas' && !dados.licencas.length) carregarLicencas('').catch(() => { });
    if (qual === 'chaves' && !dados.chaves) carregarChaves().catch(() => { });
    if (qual === 'graficos' && !dados.hardware) carregarHardware().catch(() => { });
  }

  // ── RESUMO ───────────────────────────────────────────────────────────────
  async function carregarResumo() {
    const r = await rpc('admin_resumo');
    dados.resumo = r || {};

    const n = (x) => (x == null ? '—' : x);
    $('c-usuarios').textContent = n(r.total_usuarios);
    $('c-pagos').textContent = n(r.total_pagos);
    $('c-gratis').textContent = n(r.total_gratis);
    $('c-pcs').textContent = n(r.total_pcs);

    const pct = r.total_usuarios ? Math.round((r.total_pagos / r.total_usuarios) * 100) : 0;
    $('c-pagos-d').textContent = pct + '% das contas';
    $('c-usuarios-d').textContent = '+' + (r.novos_7d || 0) + ' nos últimos 7 dias';

    $('l-ativas').textContent = n(r.licencas_ativas);
    $('l-vencendo').textContent = n(r.licencas_vencendo);
    $('l-vencidas').textContent = n(r.licencas_vencidas);
    $('l-vital').textContent = n(r.total_vitalicios);
    $('lic-total').textContent = (r.licencas_ativas || 0) + (r.licencas_vencidas || 0) + ' no total';

    $('l-hoje').textContent = n(r.novos_hoje);
    $('l-7d').textContent = n(r.novos_7d);
    $('l-30d').textContent = n(r.novos_30d);
    $('l-total').textContent = n(r.total_usuarios);

    // alertas
    const alertas = [];
    if (r.licencas_vencendo > 0) alertas.push({ tipo: '', txt: r.licencas_vencendo + ' licença(s) vencem nos próximos 7 dias.' });
    if (r.licencas_vencidas > 0) alertas.push({ tipo: 'vermelho', txt: r.licencas_vencidas + ' licença(s) vencida(s) sem renovação.' });
    $('alertas').innerHTML = alertas.map((a) =>
      '<div class="adm-alerta ' + a.tipo + '"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' + a.txt + '</div>'
    ).join('');

    pintarAtividade();
  }

  function pintarAtividade() {
    const itens = [];

    // últimas contas criadas
    const us = (dados.usuarios || []).slice().sort((a, b) => new Date(b.criado) - new Date(a.criado)).slice(0, 4);
    us.forEach((u) => {
      itens.push({
        ordem: new Date(u.criado).getTime(),
        ic: 'azul',
        svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
        txt: '<b>' + esc(u.email) + '</b> criou a conta',
        qd: quando(u.criado),
      });
    });

    // PCs acessados
    const pcs = (Array.isArray(dados.pcs) ? dados.pcs : []).slice().sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo)).slice(0, 3);
    pcs.forEach((p) => {
      itens.push({
        ordem: new Date(p.ultimo).getTime(),
        ic: 'verde',
        svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/></svg>',
        txt: '<b>' + esc(p.nome || 'Um PC') + '</b> acessou a conta',
        qd: quando(p.ultimo),
      });
    });

    itens.sort((a, b) => b.ordem - a.ordem);

    const el = $('atividade');
    if (!itens.length) {
      el.innerHTML = vazio(ICONE_USUARIOS, 'Nada por aqui ainda', 'Quando alguém criar conta ou abrir o aplicativo, aparece aqui.');
      return;
    }
    el.innerHTML = itens.slice(0, 6).map((i) =>
      '<div class="adm-atv"><div class="adm-atv-ic ' + i.ic + '">' + i.svg + '</div>' +
      '<div class="adm-atv-txt">' + i.txt + '</div>' +
      '<div class="adm-atv-qd">' + i.qd + '</div></div>'
    ).join('');
  }

  // ── VENDAS ───────────────────────────────────────────────────────────────
  async function carregarVendas(dias) {
    const v = await rpc('admin_vendas', { p_dias: Number(dias) || 30 });
    dados.vendas = v || {};

    $('v-total').textContent = reais(v.total);
    $('v-qtd').textContent = v.quantidade ?? '0';
    $('v-ticket').textContent = reais(v.ticket);
    $('v-vital').textContent = v.vitalicios ?? '0';
    $('v-total-d').textContent = 'em ' + (dias || 30) + ' dias';
    $('v-qtd-d').textContent = (v.mensais || 0) + ' mensais';
    $('v-vital-d').textContent = 'pagamento único';

    desenharGrafico(v.por_dia || []);

    const tb = $('tb-vendas');
    const ult = v.ultimas || [];
    if (!ult.length) {
      tb.innerHTML = '<tr><td colspan="5">' + vazio(ICONE_GRAFICO, 'Nenhuma venda registrada', 'Os pagamentos aprovados aparecem aqui automaticamente.') + '</td></tr>';
    } else {
      tb.innerHTML = ult.map((x) => '<tr>' +
        '<td class="num">' + data(x.criado_em) + '</td>' +
        '<td><div class="adm-celula">' + avatar(x.email) + '<span class="email">' + esc(x.email) + '</span></div></td>' +
        '<td><span class="tag ' + (String(x.plano).includes('vital') ? 'vitalicio' : 'gratis') + '">' + esc(x.plano || '—') + '</span></td>' +
        '<td class="num" style="color:var(--adm-txt);font-weight:700">' + reais(x.valor) + '</td>' +
        '<td>' + esc(x.metodo || 'pix') + '</td>' +
        '</tr>').join('');
    }
  }

  function desenharGrafico(porDia) {
    const el = $('grafico-vendas');
    if (!porDia.length) {
      el.innerHTML = vazio(ICONE_GRAFICO, 'Nenhuma venda no período', 'Quando alguém pagar pelo site, o faturamento aparece aqui.');
      return;
    }

    const W = 900, H = 190, PADL = 8, PADR = 8, PADT = 16, PADB = 26;
    const valores = porDia.map((d) => Number(d.total) || 0);
    const max = Math.max(...valores, 1);
    const n = porDia.length;

    const passo = n > 1 ? (W - PADL - PADR) / (n - 1) : 0;
    const larguraBarra = n > 1 ? Math.max(3, Math.min(22, passo * 0.5)) : 30;

    const x = (i) => PADL + i * passo;
    const y = (v) => PADT + (H - PADT - PADB) * (1 - v / max);

    // área + linha
    const pontos = porDia.map((d, i) => x(i) + ',' + y(Number(d.total) || 0)).join(' ');
    const area = 'M' + x(0) + ',' + (H - PADB) + ' L' + porDia.map((d, i) => x(i) + ',' + y(Number(d.total) || 0)).join(' L') +
      ' L' + x(n - 1) + ',' + (H - PADB) + ' Z';

    // linhas de grade
    let grade = '';
    for (let g = 0; g <= 3; g++) {
      const gy = PADT + ((H - PADT - PADB) / 3) * g;
      grade += '<line class="grid" x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" />';
    }

    // barras + rótulos
    let barras = '';
    porDia.forEach((d, i) => {
      const valor = Number(d.total) || 0;
      const alt = Math.max(2, (H - PADT - PADB) * (valor / max));
      const bx = x(i) - larguraBarra / 2;
      const by = H - PADB - alt;
      const dt = String(d.dia).slice(8, 10) + '/' + String(d.dia).slice(5, 7);
      const mostrarRotulo = n <= 12 || i % Math.ceil(n / 10) === 0;
      barras += '<g class="barrinha">' +
        '<rect class="barra" x="' + bx + '" y="' + by + '" width="' + larguraBarra + '" height="' + alt + '" rx="3">' +
        '<title>' + dt + ': ' + reais(valor) + ' · ' + d.qtd + ' venda(s)</title></rect>' +
        '<circle class="ponto" cx="' + x(i) + '" cy="' + y(valor) + '" r="3.5" />' +
        (mostrarRotulo ? '<text class="rot" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + dt + '</text>' : '') +
        '</g>';
    });

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Faturamento por dia">' +
      '<defs><linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(255,31,46,.34)"/>' +
      '<stop offset="100%" stop-color="rgba(255,31,46,0)"/>' +
      '</linearGradient></defs>' +
      grade +
      '<path class="area" d="' + area + '" />' +
      '<polyline class="linha" points="' + pontos + '" />' +
      barras +
      '</svg>';
  }

  // ── LICENÇAS ─────────────────────────────────────────────────────────────
  async function carregarLicencas(filtro) {
    const l = await rpc('admin_licencas', { p_filtro: filtro || null });
    dados.licencas = Array.isArray(l) ? l : [];

    const tb = $('tb-licencas');
    if (!dados.licencas.length) {
      tb.innerHTML = '<tr><td colspan="5">' + vazio(ICONE_USUARIOS, 'Nenhuma licença aqui', filtro ? 'Nada com este filtro.' : 'Quando alguém pagar, a licença aparece nesta lista.') + '</td></tr>';
      return;
    }

    const mapa = {
      ativa: ['ativo', 'Ativa'], vencida: ['vencido', 'Vencida'], vencida_7d: ['vencido', 'Vencida'],
      vitalicio: ['vitalicio', 'Vitalícia'], sem_prazo: ['vitalicio', 'Sem prazo'],
    };

    tb.innerHTML = dados.licencas.map((x) => {
      const [cls, rot] = mapa[x.situacao] || ['gratis', x.situacao];
      const dias = (x.lifetime || x.vence_em === null) ? '∞' : (x.dias_restantes == null ? '—' : x.dias_restantes + 'd');
      return '<tr>' +
        '<td><div class="adm-celula">' + avatar(x.email) + '<span class="email">' + esc(x.email) + '</span></div></td>' +
        '<td><span class="tag ' + cls + '">' + rot + '</span></td>' +
        '<td class="num">' + (x.lifetime ? '—' : data(x.vence_em)) + '</td>' +
        '<td class="num" style="color:var(--adm-txt);font-weight:700">' + dias + '</td>' +
        '<td><button class="adm-acao" data-acao="liberar30" data-email="' + esc(x.email) + '">+30d</button></td>' +
        '</tr>';
    }).join('');

    tb.querySelectorAll('.adm-acao').forEach((b) => { b.onclick = () => acao(b.dataset.acao, b.dataset.email, b); });
  }

  // ── USUÁRIOS ─────────────────────────────────────────────────────────────
  function pintarUsuarios() {
    const busca = ($('busca')?.value || '').toLowerCase().trim();
    const lista = (dados.usuarios || []).filter((u) => {
      if (busca && !(String(u.email || '').toLowerCase().includes(busca) || String(u.name || '').toLowerCase().includes(busca))) return false;
      if (filtroUsuarios && u.situacao !== filtroUsuarios) return false;
      return true;
    });

    const tb = $('tb-usuarios');
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="5">' + vazio(ICONE_USUARIOS, 'Nenhum usuário encontrado', busca || filtroUsuarios ? 'Tente outro filtro ou outra busca.' : 'Ninguém criou conta ainda.') + '</td></tr>';
      return;
    }

    const rot = { ativo: 'Ativo', vitalicio: 'Vitalício', vencido: 'Vencido', gratis: 'Grátis' };
    const cls = { ativo: 'ativo', vitalicio: 'vitalicio', vencido: 'vencido', gratis: 'gratis' };

    tb.innerHTML = lista.map((u) => `
      <tr>
        <td>
          <div class="adm-celula">${avatar(u.email)}
            <div>
              <span class="email">${esc(u.email)}</span>
              ${u.is_admin ? ' <span class="tag admin">admin</span>' : ''}
              <div style="font-size:11px;color:var(--adm-dim2);margin-top:2px">${esc(u.name || 'sem nome')}</div>
            </div>
          </div>
        </td>
        <td><span class="tag ${cls[u.situacao] || 'gratis'}">${rot[u.situacao] || u.situacao}</span></td>
        <td class="num">${u.situacao === 'vitalicio' ? '—' : data(u.vence_em)}</td>
        <td class="num">${u.pcs || 0}</td>
        <td>
          <button class="adm-acao" data-acao="liberar30" data-email="${esc(u.email)}">+30d</button>
          <button class="adm-acao" data-acao="vitalicio" data-email="${esc(u.email)}">Vitalício</button>
          <button class="adm-acao" data-acao="liberarpc" data-email="${esc(u.email)}">Trocar PC</button>
          <button class="adm-acao perigo" data-acao="remover" data-email="${esc(u.email)}">Remover</button>
        </td>
      </tr>`).join('');

    tb.querySelectorAll('.adm-acao').forEach((b) => { b.onclick = () => acao(b.dataset.acao, b.dataset.email, b); });
  }

  async function acao(tipo, email, botao) {
    const mapa = {
      liberar30: ['admin_liberar', { email_alvo: email, dias: 30 }, '30d'],
      vitalicio: ['admin_liberar', { email_alvo: email, dias: null }, 'Vitalício'],
      liberarpc: ['admin_liberar_pc', { email_alvo: email }, 'PC'],
      remover: ['admin_remover', { email_alvo: email }, 'remover'],
    };
    const [fn, corpo] = mapa[tipo] || [];
    if (!fn) return;
    if (tipo === 'remover' && !confirm('Remover o acesso de ' + email + '? A conta volta para grátis.')) return;

    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = '...';
    try {
      const r = await rpc(fn, corpo);
      if (r && r.ok === false) throw new Error(r.erro || 'falhou');
      botao.textContent = '✓';
      botao.classList.add('ok');
      dados.licencas = [];
      dados.resumo = null;
      setTimeout(() => { recarregarTudo(); }, 600);
    } catch (e) {
      alert('Não foi possível: ' + e.message);
      botao.textContent = textoOriginal;
      botao.disabled = false;
    }
  }

  async function recarregarTudo() {
    try {
      dados.usuarios = await rpc('admin_usuarios');
      dados.pcs = await rpc('admin_pcs');
      if (!Array.isArray(dados.pcs)) dados.pcs = [];
      await carregarResumo();
      pintarUsuarios();
      if ($('tab-licencas').classList.contains('on')) carregarLicencas('').catch(() => { });
      if ($('tab-graficos').classList.contains('on')) { dados.hardware = null; carregarHardware().catch(() => { }); }
      if ($('tab-chaves').classList.contains('on')) { dados.chaves = null; carregarChaves().catch(() => { }); }
    } catch (e) { }
  }

  // ── COMPUTADORES ─────────────────────────────────────────────────────────
  async function carregarPcs() {
    dados.pcs = await rpc('admin_pcs');
    if (!Array.isArray(dados.pcs)) dados.pcs = [];

    const tb = $('tb-pcs');
    if (!dados.pcs.length) {
      tb.innerHTML = '<tr><td colspan="5">' + vazio(ICONE_PC, 'Nenhum computador vinculado', 'Quando um cliente abrir o aplicativo, a máquina dele aparece aqui.') + '</td></tr>';
      return;
    }
    tb.innerHTML = dados.pcs.map((p) => '<tr>' +
      '<td><div class="adm-celula"><span class="adm-avatar green">' + esc(inicial(p.nome)) + '</span><span class="email">' + esc(p.nome || 'PC sem nome') + '</span></div></td>' +
      '<td>' + esc(p.email || '—') + '</td>' +
      '<td class="num">' + esc(p.placa || '—') + '</td>' +
      '<td class="num">' + esc(p.hwid_curto || '—') + '…</td>' +
      '<td class="num">' + quando(p.ultimo) + '</td></tr>').join('');
  }

  // ── CHAVES ───────────────────────────────────────────────────────────────
  async function carregarChaves() {
    const c = await rpc('admin_chaves', {});
    dados.chaves = c || {};

    $('ck-total').textContent = c.total ?? '—';
    $('ck-livres').textContent = c.livres ?? '—';
    $('ck-usadas').textContent = c.usadas ?? '—';
    $('ck-cancel').textContent = c.canceladas ?? '—';

    const lista = c.lista || [];
    const tb = $('tb-chaves');
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="6">' + vazio(ICONE_CHAVE, 'Nenhuma chave gerada', 'Use o formulário acima para criar chaves e vender fora do site.') + '</td></tr>';
      return;
    }

    tb.innerHTML = lista.map((k) => {
      const sit = k.cancelada ? 'vencido' : (k.usado_em ? 'gratis' : 'ativo');
      const rot = k.cancelada ? 'Cancelada' : (k.usado_em ? 'Usada' : 'Disponível');
      return '<tr>' +
        '<td class="num" style="color:var(--adm-txt);font-weight:700;letter-spacing:.04em">' + esc(k.codigo) + '</td>' +
        '<td>' + esc(k.plano) + (k.dias ? ' · ' + k.dias + 'd' : ' · ∞') + '</td>' +
        '<td><span class="tag ' + sit + '">' + rot + '</span></td>' +
        '<td>' + esc(k.usado_por_email || '—') + '</td>' +
        '<td class="num">' + (k.usado_em ? data(k.usado_em) : '—') + '</td>' +
        '<td>' + (!k.cancelada && !k.usado_em ? '<button class="adm-acao perigo" data-cancelar="' + esc(k.codigo) + '">Cancelar</button>' : '—') + '</td>' +
        '</tr>';
    }).join('');

    tb.querySelectorAll('[data-cancelar]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Cancelar a chave ' + b.dataset.cancelar + '?')) return;
        try { await rpc('admin_cancelar_chave', { p_codigo: b.dataset.cancelar }); dados.chaves = null; carregarChaves(); }
        catch (e) { alert('Não foi possível: ' + e.message); }
      };
    });
  }

  // ── HARDWARE ─────────────────────────────────────────────────────────────
  async function carregarHardware() {
    const hw = await rpc('admin_hardware', {});
    dados.hardware = hw || {};
    $('hw-total').textContent = hw.total ?? '—';

    const pintar = (id, lista) => {
      const el = $(id);
      const arr = Array.isArray(lista) ? lista : [];
      if (!arr.length) {
        el.innerHTML = vazio(ICONE_PC, 'Nenhum dado ainda', 'O aplicativo envia quando o cliente entra com a conta.');
        return;
      }
      const max = Math.max(...arr.map((x) => Number(x.qtd) || 0), 1);
      el.innerHTML = arr.map((x) => {
        const pct = Math.max(3, Math.round((Number(x.qtd) / max) * 100));
        const nome = x.nome || x.faixa || '?';
        return '<div class="adm-barra-linha" title="' + esc(nome) + ' — ' + x.qtd + '">' +
          '<div class="adm-barra-nome">' + esc(nome) + '</div>' +
          '<div class="adm-barra-trilha"><div class="adm-barra-fill" data-pct="' + pct + '"></div></div>' +
          '<div class="adm-barra-qtd">' + x.qtd + '</div></div>';
      }).join('');

      // anima a largura depois de inserir: dois frames garantem que o navegador
      // ja pintou a barra com largura 0 antes de receber o valor final
      const aplicar = () => {
        el.querySelectorAll('.adm-barra-fill').forEach((f) => {
          f.style.width = f.dataset.pct + '%';
        });
      };
      requestAnimationFrame(() => requestAnimationFrame(aplicar));
      setTimeout(aplicar, 120);
    };

    pintar('graf-gpu', hw.gpus);
    pintar('graf-cpu', hw.cpus);
    pintar('graf-ram', hw.ramos);
    pintar('graf-sis', hw.sistemas);
  }

  // ── filtros e pílulas ────────────────────────────────────────────────────
  $('busca')?.addEventListener('input', pintarUsuarios);

  document.querySelectorAll('#user-pilulas .adm-pilula').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#user-pilulas .adm-pilula').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      filtroUsuarios = b.dataset.plano || '';
      pintarUsuarios();
    };
  });

  document.querySelectorAll('#vend-pilulas .adm-pilula').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#vend-pilulas .adm-pilula').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      carregarVendas(Number(b.dataset.dias)).catch(() => { });
    };
  });

  document.querySelectorAll('#lic-pilulas .adm-pilula').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#lic-pilulas .adm-pilula').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      carregarLicencas(b.dataset.filtro || '').catch(() => { });
    };
  });

  // ── gerar chaves ─────────────────────────────────────────────────────────
  $('ch-plano')?.addEventListener('change', () => {
    const v = $('ch-plano').value === 'vitalicio';
    $('ch-dias').disabled = v;
    if (v) $('ch-dias').value = '';
    else if (!$('ch-dias').value) $('ch-dias').value = '30';
  });

  $('ch-criar')?.addEventListener('click', async () => {
    const aviso = $('ch-aviso');
    const b = $('ch-criar');
    b.disabled = true; b.textContent = 'Gerando...';
    try {
      const r = await rpc('admin_criar_chaves', {
        qtd: Number($('ch-qtd').value || 1),
        p_plano: $('ch-plano').value,
        p_dias: Number($('ch-dias').value || 30),
      });
      if (r && r.erro) throw new Error(r.erro);
      const codigos = (r.chaves || []).map((c) => c.codigo);
      aviso.className = 'adm-aviso ok';
      aviso.textContent = codigos.length + ' chave(s) criada(s).';
      $('ch-novas').innerHTML = '<div class="adm-codigos">' +
        codigos.map((c) => '<div class="adm-codigo"><span>' + esc(c) + '</span><button data-copiar="' + esc(c) + '">copiar</button></div>').join('') +
        '</div>';
      $('ch-novas').querySelectorAll('[data-copiar]').forEach((cb) => {
        cb.onclick = async () => {
          try { await navigator.clipboard.writeText(cb.dataset.copiar); cb.textContent = 'copiado'; }
          catch (e) { cb.textContent = 'falhou'; }
          setTimeout(() => { cb.textContent = 'copiar'; }, 1800);
        };
      });
      dados.chaves = null;
      carregarChaves();
    } catch (e) {
      aviso.className = 'adm-aviso erro';
      aviso.textContent = 'Não foi possível: ' + e.message;
    }
    b.disabled = false; b.textContent = 'Gerar chaves';
  });

  // ── liberar acesso ───────────────────────────────────────────────────────
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
      recarregarTudo();
    } catch (e) {
      aviso.className = 'adm-aviso erro';
      aviso.textContent = 'Não foi possível: ' + e.message;
    }
    b.disabled = false; b.textContent = 'Liberar acesso';
  });

  $('sair')?.addEventListener('click', () => { SUPABASE.sair(); location.href = '/entrar'; });

  // ── entrada ──────────────────────────────────────────────────────────────
  (async () => {
    const s = await SUPABASE.sessaoValida();
    if (!s) { location.href = '/entrar?voltar=/admin'; return; }

    const p = await SUPABASE.perfil();
    $('quem').textContent = (p && p.email) || '';

    try {
      // a ordem importa: a atividade do resumo usa usuários e PCs
      dados.usuarios = await rpc('admin_usuarios');
      await carregarPcs();
      await carregarResumo();
      pintarUsuarios();

      $('carregando').remove();
      $('painel').style.display = '';

      // abre a aba do endereço (#vendas, #chaves...)
      const hash = (location.hash || '').replace('#', '');
      const alvo = hash && document.querySelector('.adm-item[data-tab="' + hash + '"]');
      if (alvo) alvo.click();
      else document.querySelector('.adm-item[data-tab="resumo"]').classList.add('on');
    } catch (e) {
      $('carregando').remove();
      $('bloqueio').style.display = '';
      $('bloqueio-txt').textContent = /sem permissao/.test(e.message)
        ? 'Esta conta não é administradora.'
        : 'Não foi possível carregar o painel.';
    }
  })();
})();
