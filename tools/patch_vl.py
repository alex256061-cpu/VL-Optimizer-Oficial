import io, os, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
SRC = ROOT + r"\src"

def rd(p): return io.open(p, encoding="utf-8").read()
def wr(p, s): io.open(p, "w", encoding="utf-8").write(s)

# ── 1. remove login (não usado) e rastros gdzfps/keyauth ──
for f in ("login.html", "login-theme.css"):
    p = os.path.join(SRC, f)
    if os.path.exists(p):
        os.remove(p)
        print("removido", f)

# ── 2. dashboard: social + plano + textos ──
p = SRC + r"\dashboard.html"
s = rd(p)
s = s.replace("connect-src 'self' https://keyauth.win;", "connect-src 'self';")
# bloco social
s = re.sub(r'\n\s*<div class="social-row">.*?</div>\n', '\n', s, flags=re.S)
# bloco de plano (upsell de assinatura)
s = re.sub(r'\n\s*<!-- Só para quem está no plano grátis.*?<!-- Só no app instalado', '\n          <!-- Só no app instalado', s, flags=re.S)
# textos
s = s.replace('alt="L Optimizer"', 'alt="VL Optimizer"')
s = s.replace('<div class="about-title">L <span>Optimizer</span></div>', '<div class="about-title">VL <span>Optimizer</span></div>')
s = s.replace('<div class="about-copy">© 2026 L Optimizer · Todos os direitos reservados · TikTok: @loptimizer</div>',
              '<div class="about-copy">© 2026 VL Optimizer · Todos os direitos reservados</div>')
s = s.replace('O L abre minimizado na barra de tarefas', 'O VL abre minimizado na barra de tarefas')
s = s.replace('<b>L</b><i>Optimizer</i>', '<b>VL</b><i>Optimizer</i>')
s = s.replace('<div class="sb-logo-name">L <span>Optimizer</span></div>', '<div class="sb-logo-name">VL <span>Optimizer</span></div>')
s = s.replace('L Scaling', 'VL Scaling').replace('L FG', 'VL FG').replace('L SCALING', 'VL SCALING')
s = s.replace('https://www.tiktok.com/@loptimizer', '')
s = s.replace('https://discord.gg/wKQqNvgTDK', '')
wr(p, s)
print("dashboard ok", "social-row" not in s, "about-plan" not in s)

# ── 3. gdz-scaling: keyauth fora + marca ──
p = SRC + r"\gdz-scaling.html"
s = rd(p)
s = s.replace("connect-src 'self' https://keyauth.win;", "connect-src 'self';")
s = s.replace('L Scaling', 'VL Scaling').replace('L FG', 'VL FG').replace('L SCALING', 'VL SCALING')
wr(p, s)

# ── 4. marca/cópia em todo o src ──
reps = [
    ("L Optimizer", "VL Optimizer"),
    ("L Scaling", "VL Scaling"),
    ("L FG", "VL FG"),
    ("do L ", "do VL "),
    ("do L.", "do VL."),
    ("do L,", "do VL,"),
    ("o L im", "o VL im"),
    ("do L a ", "do VL a "),
]
for dp, dn, fn in os.walk(SRC):
    for f in fn:
        if not f.endswith((".css", ".js", ".html")):
            continue
        path = os.path.join(dp, f)
        s = rd(path)
        n = s
        for a, b in reps:
            n = n.replace(a, b)
        if n != s:
            wr(path, n)

# ── 5. textos específicos ──
p = SRC + r"\busca.js"
s = rd(p)
s = s.replace("{ page: 'sobre', where: 'L', title: 'Sobre', desc: 'Versão do L Optimizer, redes sociais e Discord.', syn: 'versao suporte discord tiktok' }",
              "{ page: 'sobre', where: 'VL', title: 'Sobre', desc: 'Versão do VL Optimizer, preferências e efeitos.', syn: 'versao suporte preferencias efeitos' }")
wr(p, s)

p = SRC + r"\tour.js"
s = rd(p)
s = s.replace("text: 'A versão instalada e os atalhos para o TikTok e o Discord do L, onde fica o suporte.'",
              "text: 'A versão instalada e as preferências do app (iniciar com o Windows, métricas e efeitos).'")
s = s.replace("o app prepara o PC sozinho quando um dos seus jogos abre (navegador e Discord com prioridade baixa",
              "o app prepara o PC sozinho quando um dos seus jogos abre (navegador com prioridade baixa")
wr(p, s)

p = SRC + r"\plano.js"
s = rd(p)
s = s.replace("fale com o suporte no Discord.", "fale com o suporte.")
s = s.replace("Tenho uma chave (sorteio, Discord ou compra antiga)", "Tenho uma chave de licença")
wr(p, s)

p = SRC + r"\pcinfo.js"
s = rd(p)
s = s.replace("É só colar no Discord quando pedirem a configuração do seu PC.", "É só colar quando pedirem a configuração do seu PC.")
s = s.replace("Relatório copiado. É só colar no Discord ou no suporte.", "Relatório copiado. É só colar no suporte.")
wr(p, s)

# ── 6. main / package / engine: nome VL ──
p = ROOT + r"\main.js"
s = rd(p)
s = s.replace("title: 'L Optimizer'", "title: 'VL Optimizer'")
s = s.replace("title: 'L Scaling'", "title: 'VL Scaling'")
s = s.replace("app.setAppUserModelId('com.l.optimizer')", "app.setAppUserModelId('com.vl.optimizer')")
s = s.replace("'L Optimizer'", "'VL Optimizer'")
s = s.replace("'LOptimizer'", "'VLOptimizer'")
wr(p, s)

p = ROOT + r"\engine.js"
s = rd(p)
s = s.replace("versão antiga do L a desligou", "versão antiga do VL a desligou")
s = s.replace("ajustes antigos do L", "ajustes antigos do VL")
wr(p, s)

p = ROOT + r"\engine-extras.js"
s = rd(p)
s = s.replace("'LOptimizer'", "'VLOptimizer'").replace("'L Optimizer'", "'VL Optimizer'")
s = s.replace("L Optimizer'", "VL Optimizer'")
wr(p, s)

p = ROOT + r"\package.json"
s = rd(p)
s = s.replace('"productName": "L Optimizer"', '"productName": "VL"')
s = s.replace('"description": "L Optimizer', '"description": "VL Optimizer')
wr(p, s)
print("done")
