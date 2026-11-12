import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\site"
p = ROOT + r"\index.html"
s = io.open(p, encoding="utf-8").read()

start = s.find('<section id="depoimentos"')
end = s.find('</section>', start) + len('</section>')
if start < 0:
    raise SystemExit("seÃ§Ã£o depoimentos nÃ£o encontrada")

new = '''<section id="depoimentos" class="section reviews">
    <div class="section-head reveal">
      <span class="kicker">Relatos de teste</span>
      <h2>Testado antes de chegar em você.</h2>
      <p>Relatos dos testes internos, com o que foi medido de verdade. Depoimentos de clientes entram aqui conforme chegam — os primeiros vão aparecer com o print de antes/depois.</p>
    </div>
    <div class="review-grid">
      <article class="review reveal">
        <span class="review-badge">teste interno</span>
        <p>“Liguei o desfazer em plano de energia e HAGS, reiniciei e voltei tudo ao estado original. Sem reinstalar nada.”</p>
        <div class="review-who"><span class="review-av">VL</span><div><b>Equipe VL</b><small>Ryzen 7 7800X3D · Windows 10</small></div></div>
      </article>
      <article class="review reveal">
        <span class="review-badge">teste interno</span>
        <p>“A limpeza sem corte achou 15,6 GB de temporários e 12,9 GB de cache de shaders no mesmo PC em que a conta antiga mostrava uma fração.”</p>
        <div class="review-who"><span class="review-av">VL</span><div><b>Equipe VL</b><small>SSD 480 GB · 32 GB DDR5</small></div></div>
      </article>
      <article class="review reveal">
        <span class="review-badge">teste interno</span>
        <p>“O VL Scaling escreveu o perfil do Lossless e abriu o app já com LSFG 3.1, NIS, alvo 120 e Vsync ½ — sem editar arquivo na mão.”</p>
        <div class="review-who"><span class="review-av">VL</span><div><b>Equipe VL</b><small>RTX 4070 SUPER · 1080p 165 Hz</small></div></div>
      </article>
    </div>
    <p class="review-note reveal">Quer ter seu relato publicado? Entre no Discord e mande o print de antes/depois. <b>Nada de depoimento inventado: só entra o que a pessoa autorizou.</b></p>
  </section>'''
s = s[:start] + new + s[end:]

# imagens: decoding async
s = s.replace('<img id="shotImg" src="assets/shots/dashboard.png" alt="Tela do VL Optimizer" width="1400" height="880">',
              '<img id="shotImg" src="assets/shots/dashboard.png" alt="Tela do VL Optimizer" width="1400" height="880" decoding="async">')

io.open(p, "w", encoding="utf-8").write(s)
print("reviews honestas ok")

# CSS para o selo
p = ROOT + r"\styles.css"
s = io.open(p, encoding="utf-8").read()
s += """
.review-badge{align-self:flex-start;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);background:rgba(255,255,255,.03);padding:4px 8px;border-radius:999px}
.review .review-av{background:linear-gradient(135deg,#2a1420,#160a12);border:1px solid rgba(255,31,46,.4);color:var(--red3);font-size:12px;letter-spacing:.02em}
"""
io.open(p, "w", encoding="utf-8").write(s)
print("css ok")

# robots + sitemap + 404
io.open(ROOT + r"\robots.txt", "w", encoding="utf-8").write("User-agent: *\nAllow: /\nSitemap: https://vl-optimizer.pages.dev/sitemap.xml\n")
io.open(ROOT + r"\sitemap.xml", "w", encoding="utf-8").write('''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://vl-optimizer.pages.dev/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
''')
io.open(ROOT + r"\404.html", "w", encoding="utf-8").write('''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Página não encontrada — VL Optimizer</title><link rel="icon" href="/assets/icon.png">
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#07030a;color:#f5f2f7;font-family:system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:clamp(30px,6vw,54px);margin:0 0 10px;letter-spacing:-.03em}p{color:#a99fb4;max-width:46ch;margin:0 auto 24px}
a{display:inline-block;background:linear-gradient(135deg,#ff1f2e,#c4000e);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px}
img{width:88px;margin:0 auto 18px;display:block;filter:drop-shadow(0 0 18px rgba(255,31,46,.6))}</style></head>
<body><main><img src="/assets/logo.png" alt="VL"><h1>Essa página não existe.</h1><p>O link pode ter mudado ou o endereço foi digitado errado. Volte para o site e continue de onde parou.</p><a href="/">Voltar para o VL Optimizer</a></main></body></html>''')
print("seo ok")
