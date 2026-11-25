/* VL Optimizer — landing page
   Edite CONFIG para mudar preço e link de checkout. */
const CONFIG = {
  monthlyPrice: 40,
  lifetimePrice: 99,
  monthlyUrl: '',   // link do checkout do plano mensal
  lifetimeUrl: '',  // link do checkout do vitalício
  discordUrl: 'https://discord.gg/k8F3mvxam',   // convite do Discord
  currency: 'R$'
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ── preços ── */
// Os elementos com data-price-count mostram o preço dentro de uma animação de contagem.
// Sem isto, o número fica congelado no valor do HTML e não acompanha o CONFIG.
(function pricesCount() {
  document.querySelectorAll('[data-price-count]').forEach((b) => {
    const plan = b.dataset.priceCount;
    const value = plan === 'monthly' ? CONFIG.monthlyPrice : CONFIG.lifetimePrice;
    b.setAttribute('data-count', String(Math.round(Number(value))));
  });
})();

(function prices() {
  // Cada preço é atualizado isoladamente: um elemento inesperado é ignorado em vez de
  // derrubar o script inteiro (isso já deixou o site invisível uma vez).
  //
  // A página tem dois formatos de preço:
  //   <small>R$</small><b data-price="lifetime">99</b><span>,00</span>
  //     -> o <b> guarda o inteiro e o <span> guarda os centavos
  //   R$ <span data-price="monthly">40</span>/mês
  //     -> o próprio elemento guarda o número inteiro, sem centavos
  document.querySelectorAll('[data-price]').forEach((b) => {
    try {
      if (!b) return;

      const plano = b.dataset.price;
      // mapa explícito: 'free' NÃO pode cair no preço do vitalício
      const valor = plano === 'free' ? 0
        : plano === 'monthly' ? CONFIG.monthlyPrice
          : CONFIG.lifetimePrice;

      const [inteiro, centavos] = Number(valor).toFixed(2).split('.');

      // o <b> recebe só o inteiro
      b.textContent = inteiro;

      const box = b.parentElement;
      if (!box) return;

      // o <span> de centavos é o irmão que começa com vírgula ",00"
      const irmaos = [...box.children].filter((el) => el !== b && el.tagName === 'SPAN');
      const centavosEl = irmaos.find((el) => /^,\d{2}$/.test((el.textContent || '').trim()));
      if (centavosEl) centavosEl.textContent = ',' + centavos;

      // o <small> é o "R$"
      const small = box.querySelector('small');
      if (small && !small.querySelector('[data-price]')) small.textContent = CONFIG.currency;
    } catch (e) { }
  });
})();
/* ── checkout ── */
(function checkout() {
  document.querySelectorAll('[data-buy]').forEach((btn) => {
    const plan = btn.dataset.buy;
    const url = plan === 'monthly' ? CONFIG.monthlyUrl : CONFIG.lifetimeUrl;
    if (url) btn.href = url;
    btn.addEventListener('click', (e) => {
      if (url) return;
      e.preventDefault();
      toast(`Checkout do plano ${plan === 'monthly' ? 'mensal' : 'vitalício'} ainda não configurado.`);
    });
  });
})();

/* ── toast ── */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

/* ── nav ── */
const nav = $('#nav');
const onScroll = () => {
  nav.classList.toggle('scrolled', window.scrollY > 24);
  const h = document.documentElement.scrollHeight - innerHeight;
  const p = h > 0 ? (scrollY / h) * 100 : 0;
  const bar = $('#progressBar');
  if (bar) bar.style.width = p + '%';
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ── menu mobile ── */
const menuBtn = $('#menuBtn');
const navLinks = $('#navLinks');
if (menuBtn && navLinks) {
  menuBtn.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  $$('a', navLinks).forEach((a) => a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }));
}

/* ── reveal on scroll ── */
const reveals = $$('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  reveals.forEach((el, i) => {
    el.style.transitionDelay = (i % 4) * 70 + 'ms';
    io.observe(el);
  });
} else reveals.forEach((el) => el.classList.add('in'));

/* ── contadores ── */
const counters = $$('[data-count]');
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function runCounter(el) {
  const target = Number(el.dataset.count || 0);
  const suffix = el.dataset.suffix || '';
  const prefix = el.dataset.prefix || '';
  const start = performance.now();
  const dur = 1100;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = prefix + Math.round(target * easeOut(t)) + (t === 1 ? suffix : '');
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
if ('IntersectionObserver' in window && counters.length) {
  const co = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      runCounter(e.target);
      co.unobserve(e.target);
    });
  }, { threshold: 0.6 });
  counters.forEach((el) => co.observe(el));
} else counters.forEach(runCounter);

/* ── telas / tabs ── */
(function shots() {
  const img = $('#shotImg');
  const title = $('#shotTitle');
  const tabs = $$('.shot-tab');
  if (!img || !tabs.length) return;
  let index = 0;
  let timer = null;
  const show = (i, manual) => {
    const tab = tabs[i];
    if (!tab) return;
    index = i;
    tabs.forEach((t, k) => {
      const on = k === i;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    img.classList.add('swap');
    const pre = new Image();
    pre.src = tab.dataset.img;
    pre.onload = () => {
      img.src = tab.dataset.img;
      img.alt = 'Tela ' + tab.dataset.title + ' do VL Optimizer';
      if (title) title.textContent = tab.dataset.title;
      requestAnimationFrame(() => img.classList.remove('swap'));
    };
    if (manual) restart();
  };
  const restart = () => {
    clearInterval(timer);
    timer = setInterval(() => show((index + 1) % tabs.length), 5200);
  };
  tabs.forEach((t, i) => t.addEventListener('click', () => show(i, true)));
  const grid = $('.showcase-grid');
  if (grid) {
    grid.addEventListener('mouseenter', () => clearInterval(timer));
    grid.addEventListener('mouseleave', restart);
  }
  restart();
})();

/* ── ano ── */
const y = $('#year');
if (y) y.textContent = new Date().getFullYear();

/* ── tilt leve no giroscópio ── */
(function tilt() {
  const art = $('.hero-art');
  const gyro = $('.gyro');
  if (!art || !gyro || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (matchMedia('(hover: none)').matches) return;
  art.addEventListener('pointermove', (e) => {
    const r = art.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const yy = (e.clientY - r.top) / r.height - 0.5;
    gyro.style.transform = `rotateY(${x * 10}deg) rotateX(${-yy * 8}deg)`;
    gyro.style.transition = 'transform .18s ease-out';
  });
  art.addEventListener('pointerleave', () => {
    gyro.style.transition = 'transform .8s cubic-bezier(.16,1,.3,1)';
    gyro.style.transform = 'none';
  });
})();

/* ── discord ── */
(function discord() {
  const btns = document.querySelectorAll('[data-discord]');
  btns.forEach((btn) => {
    if (CONFIG.discordUrl) {
      btn.href = CONFIG.discordUrl;
      btn.target = '_blank';
      btn.rel = 'noopener';
    }
    btn.addEventListener('click', (e) => {
      if (CONFIG.discordUrl) return;
      e.preventDefault();
      toast('Convite do Discord ainda não configurado.');
    });
  });
})();

/* ── comunidade no Discord (números reais, com fallback estático) ── */
(function discordStats() {
  const membros = document.querySelectorAll('[data-discord-membros]');
  const online = document.querySelectorAll('[data-discord-online]');
  if (!membros.length && !online.length) return;
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  fetch('/api/discord', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.ok) return;
      if (d.membros) membros.forEach((el) => { el.textContent = fmt(d.membros); });
      if (d.online) online.forEach((el) => { el.textContent = fmt(d.online); });
    })
    .catch(() => {});
})();

/* ── carrossel dos relatos (setas + contador) ── */
(function reviewsCarousel() {
  const track = document.getElementById('revTrack');
  if (!track) return;
  const cards = [...track.querySelectorAll('.review-card')];
  if (!cards.length) return;
  const contador = document.getElementById('revCount');
  const escopo = track.closest('section') || document;
  const anterior = escopo.querySelector('[data-rev="prev"]');
  const proximo = escopo.querySelector('[data-rev="next"]');
  const passo = () => (cards[0] ? cards[0].getBoundingClientRect().width + 16 : 320);
  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
  const atualiza = () => {
    const p = passo();
    const pagina = Math.min(cards.length, Math.max(1, Math.round(track.scrollLeft / p) + 1));
    if (contador) contador.textContent = String(pagina).padStart(2, '0') + ' / ' + String(cards.length).padStart(2, '0');
    if (anterior) anterior.disabled = track.scrollLeft <= 2;
    if (proximo) proximo.disabled = track.scrollLeft >= maxScroll() - 2;
  };
  if (anterior) anterior.addEventListener('click', () => track.scrollBy({ left: -passo(), behavior: 'smooth' }));
  if (proximo) proximo.addEventListener('click', () => track.scrollBy({ left: passo(), behavior: 'smooth' }));
  let raf = null;
  track.addEventListener('scroll', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(atualiza);
  }, { passive: true });
  window.addEventListener('resize', atualiza);
  atualiza();
})();
