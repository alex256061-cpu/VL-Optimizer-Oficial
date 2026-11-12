import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
SRC = ROOT + r"\src"

# busca.js: texto do Sobre
p = SRC + r"\busca.js"
s = io.open(p, encoding="utf-8").read()
s = re.sub(
    r"\{ page: 'sobre', where: '[^']*', title: 'Sobre', desc: '[^']*', syn: '[^']*' \}",
    "{ page: 'sobre', where: 'VL', title: 'Sobre', desc: 'Versão do VL Optimizer, preferências e efeitos visuais.', syn: 'versao preferencias efeitos app' }",
    s,
)
io.open(p, "w", encoding="utf-8").write(s)
print("busca ok", "redes sociais" not in s)

# tour.js: passo do Sobre sem redes sociais
p = SRC + r"\tour.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace(
    "text: 'A versão instalada e os atalhos para o TikTok e o Discord do VL, onde fica o suporte.'",
    "text: 'A versão instalada e as preferências do app: iniciar com o Windows, métricas e efeitos.'",
)
io.open(p, "w", encoding="utf-8").write(s)
print("tour ok", "TikTok" not in s)

# dashboard: remove CSS morta de redes sociais
p = SRC + r"\dashboard.html"
s = io.open(p, encoding="utf-8").read()
s = re.sub(r"\n\s*\.social-tiktok\b[^\n]*\n", "\n", s)
s = re.sub(r"\n\s*\.social-discord\b[^\n]*\n", "\n", s)
io.open(p, "w", encoding="utf-8").write(s)
print("css social removido", ".social-tiktok" not in s)

# README: caminho do build
p = ROOT + r"\README.md"
s = io.open(p, encoding="utf-8").read()
s = s.replace("dist\\VL Optimizer-win32-x64\\VL Optimizer.exe", "dist\\VL Optimizer-win32-x64\\VL Optimizer.exe")
io.open(p, "w", encoding="utf-8").write(s)
