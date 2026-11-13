// ── Plano da conta: páginas pagas com cadeado, preços, ofertas e avisos de plano ──
// Quem decide de verdade é o main.js (bloqueio por canal, a partir do entitlement assinado); aqui
// só mostramos o cadeado antes do clique. Preço, cupom anunciado, crédito de upgrade e indicação vêm
// da API (canal 'offers') e são só vitrine: quem cobra é o site. Usa ipcRenderer, toast() e go() do dashboard.
(function () {
  // Página -> recurso que ela exige. Página FORA do mapa é livre para todo mundo.
  //
  // A referência mapeava as páginas dela (dashboard, fps, gargalo, hardware...), o que
  // aqui invertia tudo: o Painel aparecia trancado e Desempenho/Limpeza ficavam livres.
  //
  // Nossa regra (a mesma do texto do app): medir é grátis, aplicar é pago.
  //   Grátis: Painel, Gargalo, Informações do PC, Verificar hardware, Sobre, VL Scaling
  //   Pago:   as páginas de otimização
  const PAGE_FEATURE = {
    desempenho: 'otimizar',
    inputlag: 'otimizar',
    memoria: 'otimizar',
    limpeza: 'otimizar',
    programas: 'otimizar',
    live: 'otimizar',
    tweaks: 'otimizar',
    inicializacao: 'otimizar',
    jogos: 'otimizar',
    opti: 'otimizar',
    fps: 'otimizar',
  };
  const PAGE_NAME = {
    desempenho: 'Desempenho', inputlag: 'Mouse e teclado', memoria: 'Memória', limpeza: 'Limpeza', programas: 'Programas', live: 'Internet e live',
    tweaks: 'Windows', opti: 'GTA RP e DLSS/FSR', scaling: 'VL Scaling',
  };
  const DAY = 86400000;
  let user = null;
  let offers = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: cents % 100 ? 2 : 0 });
  // Contagem dos avisos (apareceu / clicou em planos). É só um número: não vai ligado à conta.
  const track = (type, trigger) => { try { Promise.resolve(ipcRenderer.invoke('plan-event', { type, trigger })).catch(() => {}); } catch (e) {} };
  async function loadOffers(force) {
    try { const r = await ipcRenderer.invoke('offers', { force: !!force }); offers = (r && r.offers) || null; } catch (e) { offers = null; }
    return offers;
  }
  // Quanto falta para o plano com data vencer (null: grátis, vitalício ou Licença do PC).
  const msLeft = () => (user && user.plan === 'pro' && !user.lifetime && user.licenseExpiresAt ? new Date(user.licenseExpiresAt).getTime() - Date.now() : null);
  // "2 dias", "5 h 12 min", "8 min"
  function leftText(ms) {
    if (!(ms > 0)) return null;
    if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} dias`;
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
  }
  // o tutorial de primeiro uso (tour.js) conta como janela aberta: nenhum aviso entra por cima dele
  const dialogOpen = () => !!(document.getElementById('plan-upsell') || document.getElementById('telemetry-consent') || document.getElementById('gdz-tour'));

  const allowed = (page) => {
    const f = (user && user.features) || [];
    if (f.includes('*')) return true;
    const need = PAGE_FEATURE[page];
    return !!need && f.includes(need);
  };
  const pageOfNav = (item) => {
    const on = item.getAttribute('onclick') || '';
    if (on.includes('openScalingWindow')) return 'scaling';
    const m = /go\('([^']+)'/.exec(on);
    return m ? m[1] : null;
  };

  function planLabel() {
    if (!user) return '';
    if (user.plan === 'pro') {
      if (user.pcBound) return 'Licença do PC';
      if (user.lifetime) return 'Tudo liberado';
      const ms = msLeft();
      if (ms === null) return 'Plano pago';
      if (ms <= 3 * DAY) return ms < DAY ? 'Vence em menos de 1 dia' : `Vence em ${Math.ceil(ms / DAY)} dias`;
      // longe (mais de 300 dias), o ano entra para não parecer que vence este ano
      return 'Plano até ' + new Date(user.licenseExpiresAt).toLocaleDateString('pt-BR', ms > 300 * DAY ? { day: '2-digit', month: '2-digit', year: '2-digit' } : { day: '2-digit', month: '2-digit' });
    }
    if (user.reason === 'expired') return 'Plano vencido';
    if (user.reason === 'other_device') return user.pcBound ? 'PC novo: renovar' : 'Plano em outro PC';
    return 'Plano grátis';
  }

  function paint() {
    document.querySelectorAll('.sidebar .nav-item').forEach((item) => {
      const page = pageOfNav(item);
      const locked = !!page && !allowed(page);
      item.classList.toggle('nav-locked', locked);
      if (locked && !item.querySelector('.nav-lock')) {
        const l = document.createElement('span');
        l.className = 'nav-lock';
        l.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';
        item.appendChild(l);
      }
      if (!locked) item.querySelector('.nav-lock')?.remove();
    });
    const role = document.querySelector('.user-role');
    if (role) role.textContent = planLabel() + (user && user.offline ? ' · offline' : '');
    paintAbout();
  }

  // Aba Sobre: quem está sem plano pago (grátis ou vencido) vê a chamada para assinar; com o preço
  // mais baixo que a API oferece a esta conta, quando ela informa.
  function paintAbout() {
    const box = document.getElementById('about-plan');
    if (!box) return;
    const show = !!user && user.plan !== 'pro' && user.reason !== 'other_device';
    box.hidden = !show;
    if (!show) return;
    const expired = user.reason === 'expired';
    box.querySelector('.about-plan-kicker').textContent = expired ? 'Seu plano venceu' : 'Você está no plano grátis';
    box.querySelector('.about-plan-t').textContent = expired ? 'Renove e libere tudo de novo' : 'Libere todas as otimizações';
    const btn = document.getElementById('about-plan-btn');
    btn.textContent = expired ? 'Renovar o plano' : 'Ver os planos';
    btn.onclick = () => upsell(null, { trigger: 'sobre', title: expired ? 'Renovar o plano' : 'Escolha o seu plano' });
    const prices = ((offers && offers.plans) || []).map((p) => {
      const promo = offers.promo && (offers.promo.plans || []).find((x) => x.planId === p.id);
      return promo ? promo.finalCents : p.priceCents;
    }).filter((c) => c > 0);
    document.getElementById('about-plan-note').textContent = prices.length ? `a partir de ${brl(Math.min(...prices))} · Pix, liberado na hora` : 'Pix, liberado na hora';
  }

  // Um botão por plano que a conta pode comprar, com o preço que vale para ela: o do cupom anunciado
  // ou o de upgrade (mensal ativo vira crédito no vitalício). Sem oferta da API, devolve false e o
  // modal fica com o botão único "Ver planos".
  function fillPlans(box) {
    const opts = box.querySelector('.plan-opts');
    const promoBox = box.querySelector('.plan-promo');
    const refBox = box.querySelector('.plan-ref');
    opts.textContent = ''; promoBox.textContent = ''; refBox.textContent = '';
    const o = offers;
    const can = !!(o && Array.isArray(o.plans) && o.plans.length && o.salesOpen !== false);
    opts.hidden = !can;
    box.querySelector('[data-a="planos"]').hidden = can;
    const promo = can && o.promo && Array.isArray(o.promo.plans) && o.promo.plans.length ? o.promo : null;
    promoBox.hidden = !promo;
    if (promo) {
      const off = promo.percentOff ? `${promo.percentOff}% de desconto` : promo.amountOffCents ? `${brl(promo.amountOffCents)} de desconto` : 'desconto';
      promoBox.append(el('span', 'plan-promo-tag', 'Oferta'), el('span', 'plan-promo-txt', promo.headline || `Cupom ${promo.code}: ${off}`));
      const left = el('span', 'plan-promo-left');
      const tick = () => {
        const t = promo.endsAt ? leftText(new Date(promo.endsAt).getTime() - Date.now()) : null;
        left.textContent = t ? `termina em ${t}` : '';
        left.hidden = !t;
      };
      tick();
      promoBox.append(left);
      clearInterval(box._tick);
      box._tick = setInterval(() => { if (document.body.contains(box)) tick(); else clearInterval(box._tick); }, 30000);
    }
    if (can) for (const p of o.plans) {
      const cut = promo && promo.plans.find((x) => x.planId === p.id);
      const up = o.upgrade && o.upgrade.planId === p.id ? o.upgrade : null;
      const final = cut ? cut.finalCents : up ? up.finalCents : p.priceCents;
      const life = p.days === null;
      const b = el('button', 'plan-opt' + (life ? ' hot' : ''));
      b.type = 'button';
      b.dataset.plan = p.id;
      if (cut) b.dataset.coupon = promo.code;
      const main = el('span', 'plan-opt-main');
      const name = el('span', 'plan-opt-name', p.name);
      if (life) name.append(el('span', 'plan-opt-tag', 'Melhor valor'));
      main.append(name, el('span', 'plan-opt-sub',
        up ? `upgrade: os ${brl(up.creditCents)} do mensal viram crédito`
          : life ? 'paga uma vez, continua depois de formatar'
          : `${p.days} dias, sem renovação automática`));
      const price = el('span', 'plan-opt-price');
      if (final < p.priceCents) price.append(el('s', null, brl(p.priceCents)));
      price.append(el('b', null, brl(final)));
      b.append(main, price);
      opts.append(b);
    }
    const ref = o && o.referral && o.referral.code ? o.referral : null;
    const points = o && o.points && o.points.text ? o.points.text : null;
    refBox.hidden = !ref && !points;
    if (ref) {
      const reward = ref.rewardText || (ref.rewardDays > 0 && ref.earnsDays ? `Você ganha ${ref.rewardDays} dias de plano a cada amigo que comprar.` : '');
      refBox.append(el('div', 'plan-ref-txt', `Indique um amigo: ele ganha ${ref.percentOff}% na primeira compra. ${reward}`.trim()));
      const row = el('div', 'plan-ref-row');
      const copy = el('button', 'ghost-btn', 'Copiar código');
      copy.type = 'button';
      copy.dataset.a = 'copy';
      copy.dataset.code = ref.code;
      row.append(el('code', 'plan-ref-code', ref.code), copy);
      refBox.append(row);
    }
    if (points) refBox.append(el('div', 'plan-ref-txt', points));
    return can;
  }

  // page: a página com cadeado que abriu o modal (null quando ele vem de um aviso).
  // opts: { trigger, title, text } — de qual aviso veio (para a contagem) e o texto dele.
  function upsell(page, opts = {}) {
    document.getElementById('plan-upsell')?.remove();
    document.getElementById('plan-nudge')?.remove();
    const trigger = opts.trigger || 'cadeado';
    // Licença do PC em outro PC = este Windows é outro (formatou ou trocou de PC): renova pelo mesmo preço.
    const renew = !!(user && user.reason === 'other_device' && user.pcBound);
    const otherPc = !!(user && user.reason === 'other_device' && !renew);
    const pro = !!(user && user.plan === 'pro');
    const why = opts.text || (renew
      ? 'A sua Licença do PC ficou no Windows de antes. Ela vale até formatar: se você formatou ou trocou de PC, compre de novo pelo mesmo preço (ou passe para o vitalício, que continua depois de formatar) e ela vem para este PC.'
      : otherPc
        ? 'O seu plano pago está ligado a outro PC. Para usar aqui, fale com o suporte no Discord.'
        : user && user.reason === 'expired'
          ? 'O seu plano venceu. Compre de novo (mensal ou vitalício) para liberar tudo; o que você já aplicou continua podendo ser desfeito.'
          : pro
            ? 'Nada renova sozinho. Comprando de novo, os dias se somam aos que ainda faltam.'
            : 'O plano grátis inclui o medidor de FPS, o gargalo, a verificação do hardware, a inicialização, os jogos e a Otimização Rápida.');
    const box = document.createElement('div');
    box.id = 'plan-upsell';
    box.className = 'plan-upsell';
    box.innerHTML = `
      <div class="plan-upsell-card" role="dialog" aria-modal="true" aria-labelledby="plan-upsell-t">
        <div class="plan-upsell-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg></div>
        <div id="plan-upsell-t" class="plan-upsell-title"></div>
        <p class="plan-upsell-text"></p>
        <div class="plan-promo" hidden></div>
        <div class="plan-opts" hidden></div>
        <div class="plan-upsell-btns">
          <button class="qo-btn" data-a="planos">${renew ? 'Renovar a licença' : pro ? 'Renovar' : 'Ver planos'}</button>
          <button class="ghost-btn" data-a="recheck">Já comprei</button>
          <button class="ghost-btn" data-a="close">Agora não</button>
        </div>
        <div class="plan-ref" hidden></div>
        <button class="plan-upsell-legacy" data-a="legacy">Tenho uma chave (sorteio, Discord ou compra antiga)</button>
        <form class="plan-upsell-claim" hidden>
          <input name="key" placeholder="L-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="64">
          <button class="qo-btn" type="submit">Resgatar</button>
        </form>
      </div>`;
    box.querySelector('.plan-upsell-title').textContent = opts.title || `${PAGE_NAME[page] || 'Este recurso'} faz parte do plano pago`;
    box.querySelector('.plan-upsell-text').textContent = why;
    // Plano em outro PC é caso de suporte: sem preço, o botão leva para a conta.
    const paintPlans = () => { if (!otherPc) fillPlans(box); };
    paintPlans();
    loadOffers().then(() => { if (document.body.contains(box)) paintPlans(); });
    // vindo de um aviso, quem conta a aparição é o aviso (offer_view)
    if (!opts.fromNudge) track('upsell_view', trigger);
    box.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target === box || a === 'close') box.remove();
      const opt = e.target.closest('.plan-opt');
      if (opt) {
        track('upsell_click', trigger);
        ipcRenderer.invoke('open-site', { page: 'planos', plan: opt.dataset.plan, coupon: opt.dataset.coupon });
      }
      if (a === 'planos') {
        track('upsell_click', trigger);
        ipcRenderer.invoke('open-site', { page: otherPc ? 'conta' : 'planos' });
      }
      if (a === 'copy') {
        const code = e.target.closest('button').dataset.code;
        try { await navigator.clipboard.writeText(code); toast(`Código ${code} copiado. Mande para o seu amigo.`); track('referral_copy', trigger); }
        catch (err) { toast('Não foi possível copiar. Selecione o código e copie.'); }
      }
      if (a === 'legacy') {
        const f = box.querySelector('.plan-upsell-claim');
        f.hidden = false;
        e.target.hidden = true;
        f.querySelector('input').focus();
      }
      if (a === 'recheck') {
        const b = e.target.closest('button');
        const stamp = () => (user ? [user.plan, user.licenseExpiresAt, user.lifetime].join('|') : '');
        const before = stamp();
        b.disabled = true; b.textContent = 'Conferindo…';
        const r = await ipcRenderer.invoke('check-session').catch(() => null);
        if (r && r.success) { user = r.user; paint(); }
        const unlocked = page ? allowed(page) : !!user && user.plan === 'pro' && stamp() !== before;
        if (unlocked) {
          box.remove();
          toast('Plano liberado neste PC.');
          if (page) go(page, document.querySelector(`.nav-item[onclick*="'${page}'"]`));
        } else { b.disabled = false; b.textContent = 'Já comprei'; toast('Ainda não apareceu compra nesta conta. Se acabou de pagar, espere um minuto.'); }
      }
    });
    box.querySelector('.plan-upsell-claim').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const input = f.querySelector('input');
      const btn = f.querySelector('button');
      btn.disabled = true; btn.textContent = 'Conferindo…';
      const r = await ipcRenderer.invoke('claim-key', { key: input.value }).catch(() => null);
      btn.disabled = false; btn.textContent = 'Resgatar';
      if (!r || !r.success) { toast((r && r.error) || 'Não foi possível resgatar a chave.'); return; }
      user = r.user; paint(); box.remove();
      toast(r.user.lifetime ? 'Chave resgatada: plano vitalício nesta conta.' : 'Chave resgatada: o plano da chave agora está na sua conta.');
      if (page && allowed(page)) go(page, document.querySelector(`.nav-item[onclick*="'${page}'"]`));
    });
    document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(box);
    (box.querySelector('.plan-opt.hot') || box.querySelector('.plan-opt') || box.querySelector('[data-a="planos"]')).focus();
  }

  // ── Avisos de plano: um cartão pequeno no canto, que não trava a tela ──
  // No máximo um por vez e um a cada 10 minutos; cada assunto, uma vez por dia (ou a cada `days`).
  // Fica dentro da janela do app: nunca aparece por cima do jogo.
  let lastNudgeAt = 0;
  const seenRecently = (key, days) => { try { return Date.now() - Number(localStorage.getItem('gdz-nudge:' + key) || 0) < days * DAY; } catch (e) { return false; } };
  const markSeen = (key) => { try { localStorage.setItem('gdz-nudge:' + key, String(Date.now())); } catch (e) {} };

  function nudge(n) {
    const key = n.key || n.trigger;
    if (!user || dialogOpen() || document.getElementById('plan-nudge')) return false;
    if (Date.now() - lastNudgeAt < 10 * 60000 || seenRecently(key, n.days || 1)) return false;
    lastNudgeAt = Date.now();
    markSeen(key);
    const card = el('div', 'plan-nudge');
    card.id = 'plan-nudge';
    card.setAttribute('role', 'status');
    const x = el('button', 'plan-nudge-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Fechar');
    x.onclick = () => card.remove();
    card.append(x, el('div', 'plan-nudge-title', n.title), el('div', 'plan-nudge-text', n.text));
    if (n.endsAt) {
      const left = el('div', 'plan-nudge-left');
      const tick = () => {
        const t = leftText(new Date(n.endsAt).getTime() - Date.now());
        if (!t) { card.remove(); return; }
        left.textContent = `Termina em ${t}`;
      };
      tick();
      card.append(left);
      const timer = setInterval(() => { if (document.body.contains(card)) tick(); else clearInterval(timer); }, 30000);
    }
    const cta = el('button', 'qo-btn', n.cta || 'Ver planos');
    cta.type = 'button';
    cta.onclick = () => upsell(null, { trigger: n.trigger, fromNudge: true, title: n.modalTitle || n.title, text: n.modalText });
    const btns = el('div', 'plan-nudge-btns');
    btns.append(cta);
    card.append(btns);
    document.body.appendChild(card);
    track('offer_view', n.trigger);
    // some sozinho: quem não clicou em 90 s não quer ver agora
    setTimeout(() => card.remove(), 90000);
    return true;
  }

  // Depois de medir ou otimizar no plano grátis: quantos ajustes recomendados para ESTE PC ainda
  // estão desligados (número real, o mesmo do anel do Painel). Sem nada pendente, não aparece.
  const plural = (n) => (n === 1 ? '1 ajuste recomendado desligado' : `${n} ajustes recomendados desligados`);
  const DIAG = {
    gargalo: (n) => ({ title: 'Gargalo medido', text: `Seu PC ainda tem ${plural(n)}. O plano pago libera todos, e cada um tem volta.` }),
    hardware: (n) => ({ title: 'Verificação feita', text: `Seu PC ainda tem ${plural(n)}. O plano pago libera todos, e cada um tem volta.` }),
    fps: (n) => ({ title: 'FPS gravado: esse é o seu "antes"', text: `Seu PC ainda tem ${plural(n)}. Com o plano pago você liga todos e grava de novo para comparar no mesmo jogo.` }),
    rapida: (n) => ({ title: 'Otimização Rápida aplicada', text: `Ela liga o básico. Seu PC ainda tem ${plural(n)}, liberados no plano pago.` }),
  };
  window.addEventListener('gdz-diag', (e) => {
    const kind = e.detail;
    if (!user || user.plan === 'pro' || !DIAG[kind]) return;
    // a Otimização Rápida ainda está relendo o Windows: espera o estado novo dos ajustes
    setTimeout(() => {
      if (!user || user.plan === 'pro' || !window.gdzOpt || !window.gdzOpt.loaded()) return;
      const n = window.gdzOpt.recommended().filter((r) => !r.on).length;
      if (n) nudge({ trigger: kind, modalTitle: 'Libere todos os ajustes do seu PC', ...DIAG[kind](n) });
    }, kind === 'rapida' ? 4000 : 1500);
  });

  // Ao abrir o app, no máximo um aviso, pelo que mais importa: plano vencido, plano perto de vencer,
  // oferta com prazo e, por último, o upgrade para o vitalício. Plano grátis sem oferta não vê nada aqui.
  async function startupNotice(retry) {
    if (!user) return;
    if (dialogOpen()) { if (!retry) setTimeout(() => startupNotice(true), 60000); return; }
    await loadOffers();
    if (!user || dialogOpen()) return;
    const pro = user.plan === 'pro';
    const up = offers && offers.upgrade;
    const promo = offers && offers.promo && Array.isArray(offers.promo.plans) && offers.promo.plans.length ? offers.promo : null;
    const ms = msLeft();
    if (!pro && user.reason === 'expired') {
      nudge({ trigger: 'vencido', title: 'Seu plano venceu', text: 'O que você já aplicou continua ligado e pode ser desfeito. Para aplicar ajustes novos, renove.', cta: 'Renovar', modalTitle: 'Renovar o plano' });
    } else if (ms !== null && ms <= 3 * DAY) {
      nudge({
        trigger: 'vencimento',
        title: ms < DAY ? 'Seu plano vence em menos de 1 dia' : `Seu plano vence em ${Math.ceil(ms / DAY)} dias`,
        text: up
          ? `Renove o mensal ou passe para o vitalício por ${brl(up.finalCents)}: os ${brl(up.creditCents)} do mensal viram crédito.`
          : 'Renove agora: os dias se somam aos que ainda faltam.',
        cta: 'Renovar', modalTitle: 'Renovar o plano',
      });
    } else if (promo) {
      const off = promo.percentOff ? `${promo.percentOff}% de desconto` : promo.amountOffCents ? `${brl(promo.amountOffCents)} de desconto` : 'desconto';
      nudge({
        trigger: 'oferta', key: 'oferta:' + promo.code,
        title: promo.headline || `Oferta: ${off}`,
        text: `Cupom ${promo.code}: ${off}${promo.firstPurchaseOnly ? ' na primeira compra' : ''}. Já vem aplicado ao abrir os planos.`,
        endsAt: promo.endsAt, cta: 'Ver oferta', modalTitle: 'Escolha o seu plano',
      });
    } else if (up) {
      nudge({
        trigger: 'upgrade', days: 3,
        title: `Vitalício por ${brl(up.finalCents)}`,
        text: `Os ${brl(up.creditCents)} que você pagou no mensal viram crédito enquanto ele estiver ativo.`,
        cta: 'Ver upgrade', modalTitle: 'Passar para o vitalício',
      });
    }
  }

  const baseGo = window.go;
  window.go = function (pg, el) {
    if (user && !allowed(pg)) { upsell(pg); return; }
    // o preço da chamada da aba Sobre vem das ofertas da conta
    if (pg === 'sobre') loadOffers().then(paintAbout);
    return baseGo(pg, el);
  };
  const baseScaling = window.openScalingWindow;
  if (typeof baseScaling === 'function') {
    window.openScalingWindow = function (el) {
      if (user && !allowed('scaling')) { upsell('scaling'); return; }
      return baseScaling(el);
    };
  }

  // Barra da atualização: aparece já no download (com a porcentagem) e, com a assinatura conferida
  // pelo main.js, oferece reiniciar. "Ocultar"/"Depois" vale só para a fase em que foi clicado.
  let updateHiddenFor = null;
  function showUpdate(s) {
    const phase = s && (s.status === 'downloading' || s.status === 'ready') ? `${s.status}:${s.version}` : null;
    let bar = document.getElementById('update-bar');
    if (!phase || updateHiddenFor === phase) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'update-bar';
      bar.className = 'update-bar';
      document.body.appendChild(bar);
    }
    if (bar.dataset.phase === phase) {
      if (s.status === 'downloading') {
        bar.querySelector('.update-txt').textContent = `Baixando a versão ${s.version}… ${s.percent || 0}%`;
        bar.querySelector('.update-fill').style.width = `${s.percent || 0}%`;
      }
      return;
    }
    bar.dataset.phase = phase;
    bar.textContent = '';
    const txt = document.createElement('span');
    txt.className = 'update-txt';
    const later = document.createElement('button');
    later.className = 'ghost-btn';
    later.onclick = () => { updateHiddenFor = phase; bar.remove(); };
    if (s.status === 'downloading') {
      txt.textContent = `Baixando a versão ${s.version}… ${s.percent || 0}%`;
      const track = document.createElement('div');
      track.className = 'update-track';
      const fill = document.createElement('div');
      fill.className = 'update-fill';
      fill.style.width = `${s.percent || 0}%`;
      track.append(fill);
      later.textContent = 'Ocultar';
      bar.append(txt, track, later);
      return;
    }
    txt.textContent = `Versão ${s.version} pronta para instalar.`;
    const b = document.createElement('button');
    b.className = 'qo-btn';
    b.textContent = 'Reiniciar e atualizar';
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Reiniciando…';
      const r = await ipcRenderer.invoke('update-install').catch(() => null);
      if (!r || !r.success) { b.disabled = false; b.textContent = 'Reiniciar e atualizar'; toast((r && r.error) || 'Não foi possível atualizar agora.'); }
    };
    later.textContent = 'Depois';
    bar.append(txt, b, later);
  }

  // Pergunta uma vez só; a resposta fica em settings.telemetryConsent e pode ser trocada em Sobre.
  function askConsent() {
    // na primeira abertura o tutorial vem antes: a pergunta espera ele fechar
    if (document.getElementById('gdz-tour')) { setTimeout(askConsent, 2000); return; }
    if (document.getElementById('plan-upsell') || document.getElementById('telemetry-consent')) return;
    const box = document.createElement('div');
    box.id = 'telemetry-consent';
    box.className = 'plan-upsell';
    box.innerHTML = `
      <div class="plan-upsell-card" role="dialog" aria-modal="true" aria-labelledby="telemetry-consent-t">
        <div class="plan-upsell-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg></div>
        <div id="telemetry-consent-t" class="plan-upsell-title">Ajudar a medir o ganho de FPS?</div>
        <p class="plan-upsell-text">Quando você grava o FPS no medidor, o app pode enviar os números (média, 1% low, jogo) e as otimizações aplicadas. Nada de arquivos, nome do PC ou dados pessoais. Serve para mostrar quanto cada otimização rende de verdade. A configuração do PC (processador, placa de vídeo, RAM, disco e monitor) já vai sempre, porque é ela que adapta as otimizações ao seu PC.</p>
        <div class="plan-upsell-btns">
          <button class="qo-btn" data-a="yes">Pode enviar</button>
          <button class="ghost-btn" data-a="no">Não enviar</button>
        </div>
      </div>`;
    box.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a !== 'yes' && a !== 'no') return;
      box.remove();
      await ipcRenderer.invoke('telemetry-consent-set', { on: a === 'yes' }).catch(() => null);
      paintTelemetry(a === 'yes');
      toast(a === 'yes' ? 'Obrigado! Dá para desligar depois em Sobre.' : 'Tudo bem, nada será enviado.');
    });
    document.body.appendChild(box);
  }

  function paintTelemetry(on) {
    const t = document.getElementById('telemetry-toggle');
    if (!t) return;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
  }
  window.toggleTelemetry = async function (el) {
    const on = !el.classList.contains('on');
    paintTelemetry(on);
    const r = await ipcRenderer.invoke('telemetry-consent-set', { on }).catch(() => null);
    paintTelemetry(!!(r && r.consent));
  };

  function paintAutostart(on) {
    const t = document.getElementById('autostart-toggle');
    if (!t) return;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
  }
  window.toggleAutostart = async function (el) {
    const on = !el.classList.contains('on');
    paintAutostart(on);
    const r = await ipcRenderer.invoke('autostart-set', { on }).catch(() => null);
    paintAutostart(!!(r && r.on));
  };
  // Só existe no app instalado: no portátil e em desenvolvimento a linha continua escondida.
  ipcRenderer.invoke('autostart-get').then((r) => {
    const row = document.getElementById('autostart-pref');
    if (!row || !r || !r.supported) return;
    row.style.display = '';
    paintAutostart(!!r.on);
  }).catch(() => {});

  ipcRenderer.invoke('telemetry-consent').then((r) => {
    paintTelemetry(!!(r && r.consent));
    if (r && r.consent === null) setTimeout(askConsent, 4000);
  }).catch(() => {});

  ipcRenderer.invoke('get-user').then((u) => { user = u; paint(); setTimeout(startupNotice, 9000); }).catch(() => {});
  ipcRenderer.invoke('update-status').then((s) => {
    const v = document.getElementById('about-ver');
    if (v && s && s.current) v.textContent = 'Versão ' + s.current;
    showUpdate(s);
  }).catch(() => {});
  if (typeof ipcRenderer.on === 'function') ipcRenderer.on('update-status', showUpdate);
  // Compra feita no site com o app aberto: o main confere sozinho e avisa aqui.
  if (typeof ipcRenderer.on === 'function') ipcRenderer.on('entitlement-update', (u) => {
    user = u;
    paint();
    // plano mudou: preço de upgrade, cupom e avisos mudam junto
    offers = null;
    if (!u || !u.bought) return;
    document.getElementById('plan-upsell')?.remove();
    document.getElementById('plan-nudge')?.remove();
    toast(u.pcBound ? 'Compra confirmada: Licença do PC liberada neste PC.' : u.lifetime ? 'Compra confirmada: plano vitalício liberado neste PC.' : 'Compra confirmada: plano liberado neste PC.');
  });
  // API para outras telas (otimizacoes.js). Antes o plano.js era uma IIFE fechada e o
  // otimizacoes.js mantinha uma CÓPIA da regra de bloqueio — duas regras brigando.
  window.plano = {
    paint,
    allowed,
    upsell,
    reload: () => ipcRenderer.invoke('get-user').then((u) => { user = u; paint(); return u; }).catch(() => null),
    user: () => user,
  };

})();
