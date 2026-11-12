import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\site"

# ── index.html ──
p = ROOT + r"\index.html"
s = io.open(p, encoding="utf-8").read()

# 1) JSON-LD: duas ofertas
old_ld = re.search(r'"offers":\s*\{.*?\n  \}', s, re.S)
if not old_ld:
    raise SystemExit("offers nÃ£o encontrado")
new_ld = '''"offers": [
    {
      "@type": "Offer",
      "name": "Plano mensal",
      "priceCurrency": "BRL",
      "price": "40.00",
      "availability": "https://schema.org/InStock",
      "url": "https://vl-optimizer.pages.dev/#precos"
    },
    {
      "@type": "Offer",
      "name": "Licença vitalícia",
      "priceCurrency": "BRL",
      "price": "99.00",
      "availability": "https://schema.org/InStock",
      "url": "https://vl-optimizer.pages.dev/#precos"
    }
  ]'''
s = s[:old_ld.start()] + new_ld + s[old_ld.end():]

# 2) hero: micro promessas
s = s.replace('<li>Sem mensalidade</li>', '<li>Cancele quando quiser</li>')

# 3) stats: última vira preço
old_stat = '''<div class="stat reveal"><b data-count="0" data-suffix=" mensalidade">0</b><span>você paga uma vez</span></div>'''
new_stat = '''<div class="stat reveal"><b data-count="99" data-prefix="R$ " data-suffix="">0</b><span>no plano vitalício</span></div>'''
if old_stat not in s:
    raise SystemExit("stat nÃ£o encontrado")
s = s.replace(old_stat, new_stat)

# 4) seção de preço inteira
start = s.find('<section id="precos"')
end = s.find('</section>', start) + len('</section>')
if start < 0:
    raise SystemExit("seÃ§Ã£o preÃ§o nÃ£o encontrada")
plans = '''<section id="precos" class="section pricing">
    <div class="section-head reveal">
      <span class="kicker">Preço</span>
      <h2>Escolha como pagar.</h2>
      <p>Mensal para testar sem compromisso, vitalício para ficar de vez. Os dois têm exatamente o mesmo app, sem função bloqueada.</p>
    </div>

    <div class="plans reveal">
      <article class="plan">
        <div class="plan-tag">Mensal</div>
        <div class="plan-price"><small>R$</small><b data-price="monthly">40</b><span>,00</span><i>/mês</i></div>
        <p class="plan-sub">renova sozinho · cancele quando quiser</p>
        <ul class="price-list">
          <li>Todos os recursos do painel</li>
          <li>Atualizações enquanto assinar</li>
          <li>Suporte por e-mail</li>
        </ul>
        <a class="btn btn-ghost btn-block" data-buy="monthly" href="#">Assinar mensal</a>
      </article>

      <article class="plan plan-featured">
        <span class="plan-badge">Melhor valor</span>
        <div class="plan-tag">Vitalício</div>
        <div class="plan-price"><small>R$</small><b data-price="lifetime">99</b><span>,00</span></div>
        <p class="plan-sub">pagamento único · sem renovação</p>
        <ul class="price-list">
          <li>Todos os recursos do painel</li>
          <li>Atualizações da versão 1.x</li>
          <li>7 dias de garantia</li>
          <li>Suporte por e-mail</li>
        </ul>
        <a class="btn btn-primary btn-block" data-buy="lifetime" href="#">Comprar vitalício</a>
        <p class="pay">Pix · cartão · boleto</p>
      </article>
    </div>

    <div class="plans-included reveal">
      <b>Nos dois planos:</b> ajustes com backup e desfazer · limpeza sem corte · FPS, 1% low e overlay · VL Scaling em português · OptiScaler com anti-cheat bloqueado · PC Info e gargalo.
    </div>
    <p class="plans-note reveal">O <b>VL Scaling</b> é um painel de configuração para o <b>Lossless Scaling</b>, vendido separadamente na Steam. O VL não redistribui nem inclui o Lossless.</p>
  </section>'''
s = s[:start] + plans + s[end:]

# 5) FAQ: garantia e planos
s = s.replace('<details><summary>E se eu não gostar?</summary><p>7 dias de garantia. Pediu reembolso dentro do prazo, devolvemos.</p></details>',
              '<details><summary>E se eu não gostar?</summary><p>No vitalício você tem 7 dias de garantia. No mensal, é só cancelar — sem multa e sem letra miúda.</p></details>')
s = s.replace('<details><summary>Como recebo depois de comprar?</summary>',
              '<details><summary>Qual a diferença entre mensal e vitalício?</summary><p>O app é o mesmo, com todos os recursos. O mensal renova todo mês e você cancela quando quiser; o vitalício paga uma vez e usa para sempre, com 7 dias de garantia.</p></details>\n      <details><summary>Como recebo depois de comprar?</summary>')

io.open(p, "w", encoding="utf-8").write(s)
print("html ok")

# ── styles.css: cartões de plano ──
p = ROOT + r"\styles.css"
s = io.open(p, encoding="utf-8").read()
s += """
/* planos */
.plans{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:stretch}
.plan{position:relative;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:30px 28px;overflow:hidden}
.plan-featured{border-color:rgba(255,31,46,.5);background:linear-gradient(180deg,rgba(255,31,46,.12),rgba(255,255,255,.03) 46%);box-shadow:0 40px 100px -55px rgba(255,31,46,.8)}
.plan-featured::before{content:'';position:absolute;inset:-1px;border-radius:23px;padding:1px;background:linear-gradient(140deg,rgba(255,31,46,.85),transparent 42%,rgba(255,31,46,.3));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.plan-badge{position:absolute;top:18px;right:18px;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,var(--red),var(--red2));padding:5px 9px;border-radius:999px;box-shadow:0 8px 22px -8px rgba(255,31,46,.8)}
.plan-tag{display:inline-block;align-self:flex-start;font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);padding:5px 10px;border-radius:999px}
.plan-featured .plan-tag{color:var(--red3);border-color:rgba(255,31,46,.35);background:rgba(255,31,46,.1)}
.plan-price{display:flex;align-items:baseline;gap:3px;margin:18px 0 4px;font-weight:900;letter-spacing:-.04em}
.plan-price small{font-size:19px;font-weight:700;color:var(--muted)}
.plan-price b{font-size:clamp(46px,5.2vw,64px);line-height:1;background:linear-gradient(120deg,#fff,var(--red3));-webkit-background-clip:text;background-clip:text;color:transparent}
.plan-price span{font-size:22px;font-weight:800;color:var(--red3)}
.plan-price i{font-style:normal;font-size:14px;font-weight:700;color:var(--muted2);margin-left:4px}
.plan-sub{color:var(--muted2);font-size:12.5px;margin-bottom:20px}
.plan .price-list{flex:1}
.plan .btn{margin-top:8px}
.plans-included{max-width:860px;margin:22px auto 0;text-align:center;color:var(--muted);font-size:13.5px;line-height:1.7;border-top:1px solid var(--line);padding-top:18px}
.plans-included b{color:var(--text)}
.plans-note{max-width:760px;margin:16px auto 0;text-align:center;color:var(--muted2);font-size:12px;line-height:1.6}
@media (max-width:760px){.plans{grid-template-columns:1fr}}
"""
io.open(p, "w", encoding="utf-8").write(s)
print("css ok")

# ── app.js: config e botões ──
p = ROOT + r"\app.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""const CONFIG = {
  price: 49.9,                 // preço em reais (ex.: 49.90)
  checkoutUrl: '',             // cole aqui o link do seu checkout (Kirvano, Hotmart, Stripe...)
  currency: 'R$'
};""", """const CONFIG = {
  monthlyPrice: 40,
  lifetimePrice: 99,
  monthlyUrl: '',   // link do checkout do plano mensal
  lifetimeUrl: '',  // link do checkout do vitalício
  currency: 'R$'
};""")

old_price = s[s.find("/* ── preço ── */"):s.find("/* ── toast ── */")]
new_price = """/* ── preços ── */
(function prices() {
  document.querySelectorAll('[data-price]').forEach((b) => {
    const plan = b.dataset.price;
    const value = plan === 'monthly' ? CONFIG.monthlyPrice : CONFIG.lifetimePrice;
    const [int, cents] = Number(value).toFixed(2).split('.');
    b.textContent = int;
    const box = b.parentElement;
    const centsEl = box.querySelector('span');
    if (centsEl) centsEl.textContent = ',' + cents;
    const small = box.querySelector('small');
    if (small) small.textContent = CONFIG.currency;
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

"""
s = s.replace(old_price, new_price)
io.open(p, "w", encoding="utf-8").write(s)
print("js ok")
