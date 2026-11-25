/* ═══════════════════════════════════════════════════════════════════════
   admin-extra4.js — busca de cliente pelo código da chave (suporte)
   Fica na aba Chaves. Mostra o dono e abre o histórico ou troca o e-mail.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  if (!/^\/admin(\.html)?\/?$/.test(location.pathname)) return;

  const porId = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBR = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return '—'; } };
  const guardar = (fn) => { try { return fn(); } catch (e) { console.warn('admin-extra4:', e && e.message); } };

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
  function aviso(msg, tipo) {
    let el = porId('adm-toast');
    if (!el) { el = document.createElement('div'); el.id = 'adm-toast'; el.className = 'adm-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'adm-toast on' + (tipo === 'erro' ? ' erro' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'adm-toast' + (tipo === 'erro' ? ' erro' : ''); }, 3600);
  }

  function montar() {
    const secao = porId('tab-chaves');
    if (!secao || porId('adm-chave-busca')) return;
    const bloco = document.createElement('div');
    bloco.className = 'adm-bloco';
    bloco.id = 'adm-chave-busca';
    bloco.innerHTML =
      '<h2>Buscar cliente pela chave <span>suporte: quem é o dono deste código</span></h2>' +
      '<div class="adm-busca-chave">' +
      '<input id="busca-chave" type="text" placeholder="VL-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false">' +
      '<button class="adm-btn pequeno" id="busca-chave-btn">Buscar</button>' +
      '</div>' +
      '<div id="busca-chave-resultado"></div>';
    const cab = secao.querySelector('.adm-cabeca');
    if (cab) cab.insertAdjacentElement('afterend', bloco);
    else secao.insertBefore(bloco, secao.firstChild);

    const input = porId('busca-chave');
    const botao = porId('busca-chave-btn');
    const executar = () => buscar(input.value, botao);
    botao.onclick = executar;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); executar(); } });
  }

  async function buscar(codigoBruto, botao) {
    const res = porId('busca-chave-resultado');
    if (!res) return;
    const codigo = String(codigoBruto || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').trim();
    if (!/^VL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) {
      res.innerHTML = '<div class="adm-vazio">Código inválido. Formato: VL-XXXX-XXXX-XXXX.</div>';
      return;
    }
    const texto = botao.textContent;
    botao.disabled = true; botao.textContent = '...';
    res.innerHTML = '<div class="adm-vazio">Consultando…</div>';
    try {
      const d = await apiGet('/api/admin-buscar-chave?codigo=' + encodeURIComponent(codigo));
      const ch = d.chave || {};
      const c = d.cliente;
      if (!c) {
        res.innerHTML = '<div class="adm-chave-card"><div class="adm-chave-topo"><b>' + esc(codigo) + '</b>' +
          '<span class="tag ' + (ch.cancelada ? 'vencido' : 'gratis') + '">' + (ch.cancelada ? 'cancelada' : 'não resgatada') + '</span></div>' +
          '<small class="adm-drawer-vazio">Esta chave ainda não foi usada por ninguém.</small></div>';
        return;
      }
      res.innerHTML =
        '<div class="adm-chave-card">' +
        '<div class="adm-chave-topo"><b>' + esc(codigo) + '</b>' +
        '<span class="tag ' + (ch.cancelada ? 'vencido' : 'ativo') + '">' + (ch.cancelada ? 'cancelada' : 'usada') + '</span>' +
        '<span class="tag gratis">' + esc(c.plano) + (ch.dias ? ' · ' + ch.dias + 'd' : ' · ∞') + '</span></div>' +
        '<div class="adm-chave-dono"><b>' + esc(c.email) + '</b><small>' + esc(c.nome || 'sem nome') + ' · conta desde ' + dataBR(c.criado_em) + '</small></div>' +
        '<div class="adm-chave-dados">' +
        '<span>vence: ' + (c.vence_em ? dataBR(c.vence_em) : 'sem prazo') + '</span>' +
        '<span>PCs: ' + (d.resumo ? d.resumo.pcs : 0) + '/' + (c.max_devices || 1) + '</span>' +
        '<span>compras: ' + (d.resumo ? d.resumo.compras : 0) + '</span>' +
        '<span>resgatada: ' + dataBR(ch.usado_em) + '</span>' +
        '</div>' +
        '<div class="adm-chave-acoes">' +
        '<button class="adm-btn pequeno" id="chave-abrir-hist">Abrir histórico</button>' +
        '<button class="adm-btn pequeno ghost" id="chave-trocar-email">Alterar e-mail</button>' +
        '</div>' +
        '</div>';
      porId('chave-abrir-hist').onclick = () => {
        if (typeof window.__vlAbrirHistorico === 'function') window.__vlAbrirHistorico(c.email);
        else aviso('Não consegui abrir o histórico.', 'erro');
      };
      porId('chave-trocar-email').onclick = () => {
        if (typeof window.__vlAlterarEmail === 'function') window.__vlAlterarEmail(c.email);
        else aviso('Função de troca de e-mail não carregou.', 'erro');
      };
    } catch (e) {
      res.innerHTML = '<div class="adm-vazio">' + esc(e.message) + '</div>';
    } finally {
      botao.disabled = false; botao.textContent = texto || 'Buscar';
    }
  }

  const espera = setInterval(() => {
    const painel = porId('painel');
    if (painel && painel.style.display !== 'none') {
      clearInterval(espera);
      setTimeout(() => guardar(montar), 900);
    }
  }, 300);
  setTimeout(() => clearInterval(espera), 30000);
})();
