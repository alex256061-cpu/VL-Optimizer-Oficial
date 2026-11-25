/* admin-extra.js — melhorias do painel que rodam POR CIMA do admin.js (v2).
 *
 * Só mexe no DOM depois que o painel está visível. Nada aqui re-renderiza tabela:
 *   - injeta barra de ferramentas (busca, CSV, atualizar) em cada aba
 *   - busca: esconde linhas que não batem (aplicada quando o usuário digita)
 *   - CSV: exporta a tabela que está na tela, respeitando o filtro
 *   - Atualizar: recarrega a página (o admin.js reabre a aba pelo hash)
 *   - KPIs extras no Resumo, contadores nas pílulas, sugestões de e-mail e
 *     alerta no título do navegador
 *
 * Tudo em try/catch: se alguma parte falhar, o painel continua funcionando normal.
 */
(function () {
  if (!/^\/admin(\.html)?\/?$/.test(location.pathname)) return;

  const porId = (id) => document.getElementById(id);
  const todos = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const reais = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const guardar = (fn) => { try { return fn(); } catch (e) { console.warn('admin-extra:', e && e.message); } };

  async function rpc(nome, corpo) {
    const s = await SUPABASE.sessaoValida();
    if (!s) throw new Error('sem sessao');
    const r = await fetch(SUPABASE.URL + '/rest/v1/rpc/' + nome, {
      method: 'POST',
      headers: { apikey: SUPABASE.KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo || {}),
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && (j.message || j.erro)) || 'falha');
    return j;
  }

  /* ── CSV ── */
  function exportarTabela(tbodyId, nome) {
    const corpo = porId(tbodyId);
    if (!corpo) return;
    const tabela = corpo.closest('table');
    if (!tabela) return;
    const linhas = [];
    const th = todos('thead th', tabela).map((x) => x.textContent.trim());
    if (th.length) linhas.push(th);
    todos('tr', corpo).forEach((tr) => {
      if (tr.style.display === 'none') return;
      const cels = todos('td', tr).map((td) => td.innerText.replace(/\s+/g, ' ').trim());
      if (cels.length) linhas.push(cels);
    });
    if (linhas.length < 2) { alert('Nada para exportar nesta tabela.'); return; }
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + linhas.map((l) => l.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'vl-' + nome + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ── filtro por texto (linhas da tabela) ── */
  function filtrar(tbodyId, termo) {
    const corpo = porId(tbodyId);
    if (!corpo) return;
    const t = String(termo || '').toLowerCase().trim();
    todos('tr', corpo).forEach((tr) => {
      tr.style.display = (!t || tr.innerText.toLowerCase().includes(t)) ? '' : 'none';
    });
  }

  /* ── barra de ferramentas ── */
  const ABAS = [
    { tab: 'vendas', tbody: 'tb-vendas', csv: 'vendas', busca: 'Buscar cliente...' },
    { tab: 'licencas', tbody: 'tb-licencas', csv: 'licencas', busca: 'Buscar cliente...' },
    { tab: 'usuarios', tbody: 'tb-usuarios', csv: 'usuarios', busca: null },
    { tab: 'pcs', tbody: 'tb-pcs', csv: 'computadores', busca: 'Buscar PC ou conta...' },
    { tab: 'chaves', tbody: 'tb-chaves', csv: 'chaves', busca: 'Buscar código ou e-mail...' },
  ];

  function montarBarra(aba) {
    const secao = porId('tab-' + aba.tab);
    if (!secao || secao.querySelector('.adm-tools')) return;
    const barra = document.createElement('div');
    barra.className = 'adm-tools';
    barra.innerHTML =
      (aba.busca ? '<input type="search" placeholder="' + aba.busca + '" data-busca="' + aba.tbody + '">' : '') +
      '<button class="adm-btn pequeno" data-csv="' + aba.csv + '" data-tbody="' + aba.tbody + '">Exportar CSV</button>' +
      '<button class="adm-btn pequeno ghost" data-recarregar title="Recarrega a página com os dados mais novos">Atualizar</button>' +
      '<span class="adm-atualizado">atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '</span>';
    const cabeca = secao.querySelector('.adm-cabeca');
    if (cabeca) cabeca.appendChild(barra);
    else secao.insertBefore(barra, secao.firstChild);

    const busca = barra.querySelector('[data-busca]');
    if (busca) busca.addEventListener('input', () => filtrar(aba.tbody, busca.value));
    barra.querySelector('[data-csv]').addEventListener('click', (e) => exportarTabela(e.currentTarget.dataset.tbody, e.currentTarget.dataset.csv));
    barra.querySelector('[data-recarregar]').addEventListener('click', () => location.reload());
  }

  /* ── KPIs, contadores, sugestões e título ── */
  function injetarKpis() {
    const secao = porId('tab-resumo');
    if (!secao || secao.querySelector('#k-receita')) return;
    const cards = secao.querySelector('.adm-cards');
    if (!cards) return;
    const linha = document.createElement('div');
    linha.className = 'adm-cards adm-cards-kpi';
    linha.innerHTML =
      '<div class="adm-card"><div class="adm-card-n" id="k-receita">—</div><div class="adm-card-r">Receita (30 dias)</div><div class="adm-card-d">pagamentos aprovados</div></div>' +
      '<div class="adm-card"><div class="adm-card-n" id="k-ticket">—</div><div class="adm-card-r">Ticket médio</div><div class="adm-card-d">por venda aprovada</div></div>' +
      '<div class="adm-card"><div class="adm-card-n" id="k-chaves">—</div><div class="adm-card-r">Chaves disponíveis</div><div class="adm-card-d" id="k-chaves-d">para vender fora do site</div></div>' +
      '<div class="adm-card"><div class="adm-card-n" id="k-melhor">—</div><div class="adm-card-r">Melhor dia</div><div class="adm-card-d" id="k-melhor-d">faturamento em 30 dias</div></div>';
    cards.insertAdjacentElement('afterend', linha);
  }

  function contarPilulas(usuarios, licencas) {
    todos('#user-pilulas .adm-pilula').forEach((b) => {
      if (b.querySelector('.adm-count')) return;
      const p = b.dataset.plano;
      const n = p === '' ? usuarios.length : usuarios.filter((u) => u.situacao === p).length;
      const s = document.createElement('span');
      s.className = 'adm-count';
      s.textContent = String(n);
      b.appendChild(s);
    });
    const mapa = {
      '': licencas.length,
      ativas: licencas.filter((l) => l.situacao === 'ativa').length,
      vencendo: licencas.filter((l) => String(l.situacao || '').includes('venc')).length,
      vencidas: licencas.filter((l) => l.situacao === 'vencida').length,
      vitalicias: licencas.filter((l) => l.lifetime || l.situacao === 'vitalicio').length,
    };
    todos('#lic-pilulas .adm-pilula').forEach((b) => {
      if (b.querySelector('.adm-count')) return;
      const n = mapa[String(b.dataset.filtro || '')];
      if (n == null) return;
      const s = document.createElement('span');
      s.className = 'adm-count';
      s.textContent = String(n);
      b.appendChild(s);
    });
  }

  async function carregarExtras() {
    const [resumo, vendas, chaves, licencas, usuarios] = await Promise.all([
      rpc('admin_resumo').catch(() => null),
      rpc('admin_vendas', { p_dias: 30 }).catch(() => null),
      rpc('admin_chaves', {}).catch(() => null),
      rpc('admin_licencas', { p_filtro: '' }).catch(() => null),
      rpc('admin_usuarios').catch(() => null),
    ]);
    const set = (id, v) => { const el = porId(id); if (el) el.textContent = v; };
    if (vendas) {
      set('k-receita', reais(vendas.total));
      set('k-ticket', reais(vendas.ticket));
      const porDia = Array.isArray(vendas.por_dia) ? vendas.por_dia : [];
      if (porDia.length) {
        const melhor = porDia.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a));
        set('k-melhor', reais(melhor.total));
        const d = porId('k-melhor-d');
        if (d) d.textContent = String(melhor.dia).slice(8, 10) + '/' + String(melhor.dia).slice(5, 7) + ' · ' + melhor.qtd + ' venda(s)';
      }
    }
    if (chaves) {
      set('k-chaves', chaves.livres == null ? '—' : String(chaves.livres));
      const d = porId('k-chaves-d');
      if (d) d.textContent = (chaves.usadas || 0) + ' usadas · ' + (chaves.canceladas || 0) + ' canceladas';
    }
    guardar(() => contarPilulas(Array.isArray(usuarios) ? usuarios : [], Array.isArray(licencas) ? licencas : []));
    if (resumo) {
      const alerta = (resumo.licencas_vencendo || 0) + (resumo.licencas_vencidas || 0);
      if (alerta > 0) document.title = '(' + alerta + ') ' + document.title.replace(/^\(\d+\)\s*/, '');
    }
    guardar(() => {
      if (!Array.isArray(usuarios)) return;
      const input = porId('lib-email');
      if (!input || porId('lib-emails')) return;
      input.setAttribute('list', 'lib-emails');
      const dl = document.createElement('datalist');
      dl.id = 'lib-emails';
      usuarios.slice(0, 300).forEach((u) => { const o = document.createElement('option'); o.value = u.email; dl.appendChild(o); });
      input.insertAdjacentElement('afterend', dl);
    });
  }

  function iniciar() {
    ABAS.forEach((a) => guardar(() => montarBarra(a)));
    guardar(injetarKpis);
    carregarExtras().catch((e) => console.warn('admin-extra:', e && e.message));
  }

  const espera = setInterval(() => {
    const painel = porId('painel');
    if (painel && painel.style.display !== 'none') {
      clearInterval(espera);
      setTimeout(iniciar, 300);
    }
  }, 300);
  setTimeout(() => clearInterval(espera), 30000);
})();
