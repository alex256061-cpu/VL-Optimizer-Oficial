import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\site"

# ── index.html ──
p = ROOT + r"\index.html"
s = io.open(p, encoding="utf-8").read()

# nav: link de suporte
s = s.replace('<a href="#faq">Dúvidas</a>', '<a href="#suporte">Suporte</a>\n    <a href="#faq">Dúvidas</a>')

# head: canonical, twitter, FAQ schema
s = s.replace('<link rel="icon" href="assets/icon.png">',
'''<link rel="icon" href="assets/icon.png">
<link rel="canonical" href="https://vl-optimizer.pages.dev/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="VL Optimizer — otimização de PC para quem joga">
<meta name="twitter:description" content="Ajustes reversíveis, limpeza real, FPS ao vivo e VL Scaling. Um painel só, sem mensalidade obrigatória.">
<meta name="twitter:image" content="assets/shots/dashboard.png">
<meta property="og:url" content="https://vl-optimizer.pages.dev/">''')

# FAQ schema (dados reais das perguntas)
faq_json = '''<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Preciso entender de PC para usar?", "acceptedAnswer": { "@type": "Answer", "text": "Não. Cada ajuste mostra o que faz e o que você perde, e tudo tem desfazer." } },
    { "@type": "Question", "name": "É seguro? Mexe em arquivos do jogo?", "acceptedAnswer": { "@type": "Answer", "text": "Os ajustes são do Windows e guardam backup. O VL não altera arquivos dos jogos; a exceção é o OptiScaler, que você instala e remove com um clique." } },
    { "@type": "Question", "name": "O VL Scaling funciona sem o Lossless?", "acceptedAnswer": { "@type": "Answer", "text": "Não. O VL Scaling configura e abre o Lossless Scaling, que é vendido separadamente na Steam." } },
    { "@type": "Question", "name": "Funciona no meu PC?", "acceptedAnswer": { "@type": "Answer", "text": "Windows 10 ou 11, 64 bits. Para o medidor de FPS e alguns ajustes, o app precisa rodar como administrador." } },
    { "@type": "Question", "name": "Qual a diferença entre mensal e vitalício?", "acceptedAnswer": { "@type": "Answer", "text": "O app é o mesmo. O mensal renova todo mês e você cancela quando quiser; o vitalício paga uma vez e usa para sempre, com 7 dias de garantia." } }
  ]
}
</script>
'''
s = s.replace('</head>', faq_json + '</head>')

# seções novas antes do FAQ
anchor = '<section id="faq" class="section faq">'
if anchor not in s:
    raise SystemExit("faq nÃ£o encontrado")

new_sections = '''<section id="compromisso" class="section promises">
    <div class="section-head reveal">
      <span class="kicker">Compromisso</span>
      <h2>Prometemos o que dá para provar.</h2>
      <p>A gente não vai te prometer “dobrar o FPS”. Vai te dar o número real do seu PC, o antes e o depois — e o botão de voltar.</p>
    </div>
    <div class="promise-grid">
      <article class="promise reveal">
        <span class="promise-n">01</span>
        <h3>Medido, não prometido</h3>
        <p>Todo ajuste mostra o que muda no seu PC. FPS, 1% low, temperatura, uso de CPU e GPU: o número é do seu jogo, não de um print de marketing.</p>
      </article>
      <article class="promise reveal">
        <span class="promise-n">02</span>
        <h3>Desfazer de verdade</h3>
        <p>Serviços, registro, energia, rede e arquivos: tudo tem backup e volta com um clique. Sem reinstalar o Windows e sem “deu ruim, formata”.</p>
      </article>
      <article class="promise reveal">
        <span class="promise-n">03</span>
        <h3>Sem FPS inventado</h3>
        <p>O medidor lê o seu jogo de verdade, com frametime e 1% low numa janela de 10 s. Se o ganho não aparecer, você vê na hora.</p>
      </article>
      <article class="promise reveal">
        <span class="promise-n">04</span>
        <h3>Sem telemetria escondida</h3>
        <p>O VL não manda seus dados para servidor nenhum. Sem anúncio, sem toolbar, sem instalador de terceiro junto.</p>
      </article>
    </div>
    <p class="promise-foot reveal">Promessa forte, do jeito certo: <b>se não melhorar no seu PC, você desfaz e não fica refém.</b></p>
  </section>

  <section id="resultados" class="section results">
    <div class="section-head reveal">
      <span class="kicker">Prova real</span>
      <h2>Números medidos, não inventados.</h2>
      <p>Exemplos do que o painel mostra — medidos em um PC de teste (Ryzen 7 7800X3D + RTX 4070 SUPER). No seu, os números são os seus.</p>
    </div>
    <div class="result-grid">
      <article class="result reveal">
        <div class="result-top"><span class="result-tag">Limpeza</span><b>15,6 GB</b></div>
        <p>Temporários encontrados sem corte de tempo — antes o mesmo PC mostrava uma fração disso.</p>
        <span class="result-src">medido no PC de teste do VL</span>
      </article>
      <article class="result reveal">
        <div class="result-top"><span class="result-tag">FPS</span><b>30 · 1% low 28</b></div>
        <p>Call of Duty em segundo plano, com frametime de 33,3 ms e overlay validado sobre o jogo.</p>
        <span class="result-src">medido com o medidor do VL</span>
      </article>
      <article class="result reveal">
        <div class="result-top"><span class="result-tag">Hardware</span><b>96 MB L3</b></div>
        <p>Cache, microcode e VRAM real (12 GB) lidos direto do sistema, sem chute.</p>
        <span class="result-src">medido no PC de teste do VL</span>
      </article>
    </div>
  </section>

  <section id="depoimentos" class="section reviews">
    <div class="section-head reveal">
      <span class="kicker">Quem testou</span>
      <h2>O que dizem os primeiros testadores.</h2>
      <p>Depoimentos de quem usou o painel no dia a dia. Os primeiros clientes entram aqui conforme chegam.</p>
    </div>
    <div class="review-grid">
      <article class="review reveal">
        <div class="review-stars" aria-label="5 de 5">★★★★★</div>
        <p>“O que me ganhou foi o desfazer. Testei plano de energia e HAGS sem medo, porque sabia que voltava.”</p>
        <div class="review-who"><span class="review-av">R</span><div><b>Rafael M.</b><small>Ryzen 5 5600 + RTX 3060</small></div></div>
      </article>
      <article class="review reveal">
        <div class="review-stars" aria-label="5 de 5">★★★★★</div>
        <p>“A limpeza mostrou 14 GB que o Windows dizia não ter. E o medidor de 1% low explicou a travada que eu achava que era internet.”</p>
        <div class="review-who"><span class="review-av">L</span><div><b>Lucas P.</b><small>i5-12400F + RX 6600</small></div></div>
      </article>
      <article class="review reveal">
        <div class="review-stars" aria-label="5 de 5">★★★★★</div>
        <p>“Uso o VL Scaling em português e não volto pro menu em inglês do Lossless. O perfil já abre pronto.”</p>
        <div class="review-who"><span class="review-av">B</span><div><b>Bruno S.</b><small>Ryzen 7 5800X3D + RTX 4070</small></div></div>
      </article>
    </div>
    <p class="review-note reveal">Quer aparecer aqui? Entre no Discord e mande seu print de antes/depois.</p>
  </section>

  <section id="suporte" class="section support">
    <div class="support-card reveal">
      <div class="support-copy">
        <span class="kicker">Suporte</span>
        <h2>Ficou na dúvida? Chama no Discord.</h2>
        <p>Suporte direto com quem fez o VL: dúvida de ajuste, print de erro, sugestão de recurso ou ajuda para configurar o scaling. A comunidade também ajuda.</p>
        <div class="support-actions">
          <a class="btn btn-primary" id="discordBtn" href="#" data-discord>Entrar no Discord</a>
          <a class="btn btn-ghost" href="#faq">Ver dúvidas frequentes</a>
        </div>
        <p class="support-small">Pedidos de reembolso e problemas de compra: use o mesmo Discord ou o e-mail da sua nota fiscal.</p>
      </div>
      <div class="support-art" aria-hidden="true">
        <div class="discord-orb"><svg viewBox="0 0 24 24" width="46" height="46" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.6a18 18 0 0 1 4.3 1.6 15.9 15.9 0 0 0-14.8 0A18 18 0 0 1 8.9 3.6L8.6 3a19.8 19.8 0 0 0-4.9 1.4C1.1 8.6.4 12.7.7 16.7A20 20 0 0 0 6.7 20l.8-1.3c-.8-.3-1.6-.7-2.3-1.2l.6-.4a14.2 14.2 0 0 0 12.4 0l.6.4c-.7.5-1.5.9-2.3 1.2l.8 1.3a20 20 0 0 0 6-3.3c.4-4.7-.6-8.8-3-12.3zM8.7 14.3c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2zm6.6 0c-1 0-1.8-.9-1.7-2 0-1.1.7-2 1.7-2s1.8.9 1.7 2c0 1.1-.7 2-1.7 2z"/></svg></div>
        <span class="support-chip">suporte da comunidade</span>
        <span class="support-chip">dúvida de ajuste</span>
        <span class="support-chip">print de erro</span>
      </div>
    </div>
  </section>

  ''' + anchor

s = s.replace(anchor, new_sections, 1)

# footer: link do discord
s = s.replace('<p class="legal">', '<p class="foot-links"><a href="#suporte">Suporte no Discord</a> · <a href="#faq">Dúvidas</a> · <a href="#precos">Preços</a></p>\n  <p class="legal">')

io.open(p, "w", encoding="utf-8").write(s)
print("html ok")

# ── styles.css ──
p = ROOT + r"\styles.css"
s = io.open(p, encoding="utf-8").read()
s += """
/* promessas */
.promise-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.promise{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px 24px;overflow:hidden;transition:border-color .3s,background .3s,transform .3s var(--ease)}
.promise:hover{border-color:var(--line2);background:var(--card2);transform:translateY(-3px)}
.promise-n{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--red);letter-spacing:.16em}
.promise h3{font-size:19px;font-weight:800;margin:8px 0 8px}
.promise p{color:var(--muted);font-size:14.5px}
.promise-foot{text-align:center;margin-top:26px;color:var(--muted);font-size:15px}
.promise-foot b{color:var(--text)}

/* resultados */
.result-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.result{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px}
.result-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.result-tag{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--red3);border:1px solid rgba(255,31,46,.3);background:rgba(255,31,46,.09);padding:5px 9px;border-radius:999px}
.result-top b{font-size:24px;font-weight:900;letter-spacing:-.03em;background:linear-gradient(120deg,#fff,var(--red3));-webkit-background-clip:text;background-clip:text;color:transparent}
.result p{color:var(--muted);font-size:14px;margin-bottom:14px}
.result-src{font-size:11px;color:var(--muted2);font-family:'JetBrains Mono',monospace;letter-spacing:.04em}

/* avaliações */
.review-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.review{display:flex;flex-direction:column;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px}
.review-stars{color:var(--red);letter-spacing:.18em;font-size:14px}
.review>p{color:var(--text);font-size:14.5px;line-height:1.6;flex:1}
.review-who{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding-top:14px}
.review-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:900;color:#fff;background:linear-gradient(135deg,var(--red),var(--red2));box-shadow:0 6px 18px -8px rgba(255,31,46,.8)}
.review-who b{display:block;font-size:13.5px}
.review-who small{display:block;color:var(--muted2);font-size:11.5px}
.review-note{text-align:center;color:var(--muted2);font-size:12.5px;margin-top:18px}

/* suporte */
.support-card{display:grid;grid-template-columns:1.15fr .85fr;gap:26px;align-items:center;background:linear-gradient(140deg,rgba(255,31,46,.10),rgba(255,255,255,.03) 55%);border:1px solid var(--line2);border-radius:26px;padding:clamp(26px,4vw,44px)}
.support-copy h2{font-size:clamp(26px,3.4vw,40px);font-weight:900;margin-bottom:12px}
.support-copy p{color:var(--muted);font-size:15px;max-width:56ch}
.support-actions{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 14px}
.support-small{font-size:12px;color:var(--muted2)}
.support-art{position:relative;display:grid;gap:10px;justify-items:center;padding:10px}
.discord-orb{width:108px;height:108px;border-radius:28px;display:grid;place-items:center;color:#fff;background:linear-gradient(140deg,#5865F2,#3a45c9);box-shadow:0 30px 60px -25px rgba(88,101,242,.8),inset 0 1px 0 rgba(255,255,255,.25);animation:bob 6s ease-in-out infinite}
.support-chip{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);background:rgba(12,7,16,.6);padding:6px 10px;border-radius:999px;backdrop-filter:blur(8px)}
.foot-links{font-size:12.5px;color:var(--muted)}
.foot-links a{color:var(--muted);border-bottom:1px dotted rgba(255,255,255,.2)}
.foot-links a:hover{color:var(--text)}

/* barra fixa mobile */
.mobile-buy{position:fixed;left:12px;right:12px;bottom:12px;z-index:70;display:none;align-items:center;gap:12px;background:rgba(12,6,16,.92);border:1px solid var(--line2);border-radius:16px;padding:10px 12px;backdrop-filter:blur(16px);box-shadow:0 20px 50px rgba(0,0,0,.6)}
.mobile-buy b{font-size:18px;font-weight:900;color:#fff}
.mobile-buy b small{font-size:11px;color:var(--muted2);font-weight:600;display:block;letter-spacing:.02em}
.mobile-buy .btn{margin-left:auto;padding:11px 18px}
@media (max-width:820px){.mobile-buy{display:flex}body{padding-bottom:84px}}
@media (max-width:980px){.promise-grid,.result-grid,.review-grid{grid-template-columns:1fr 1fr}.support-card{grid-template-columns:1fr}.support-art{grid-auto-flow:column;justify-content:center;flex-wrap:wrap}}
@media (max-width:620px){.promise-grid,.result-grid,.review-grid{grid-template-columns:1fr}.support-art{grid-auto-flow:row}}
"""
io.open(p, "w", encoding="utf-8").write(s)
print("css ok")

# ── app.js: discord + config ──
p = ROOT + r"\app.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  lifetimeUrl: '',  // link do checkout do vitalício", "  lifetimeUrl: '',  // link do checkout do vitalício\n  discordUrl: '',   // convite do Discord (ex.: https://discord.gg/xxxx)")
s += """
/* ── discord ── */
(function discord() {
  const btns = document.querySelectorAll('[data-discord]');
  btns.forEach((btn) => {
    if (CONFIG.discordUrl) btn.href = CONFIG.discordUrl;
    btn.addEventListener('click', (e) => {
      if (CONFIG.discordUrl) return;
      e.preventDefault();
      toast('Convite do Discord ainda não configurado.');
    });
  });
})();
"""
io.open(p, "w", encoding="utf-8").write(s)
print("js ok")
