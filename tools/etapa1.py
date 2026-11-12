import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── 1) dashboard: remove o bloco "Enviar métricas de FPS" ──
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()

idx = s.find("Enviar métricas de FPS")
if idx < 0:
    raise SystemExit("bloco de métricas nÃ£o encontrado")
start = s.rfind('<div class="about-pref">', 0, idx)
end_marker = '</div>'
# o bloco termina no </div> que fecha o .about-pref; procura o próximo "\n          </div>\n" após o toggle
toggle = s.find('id="telemetry-toggle"', idx)
close = s.find('\n          </div>', toggle)
if start < 0 or close < 0:
    raise SystemExit("limites do bloco de métricas nÃ£o encontrados")
s = s[:start] + s[close + len('\n          </div>'):]
print("métricas removidas")

# ── 2) dashboard: remove a linha "Versão Otimizada" (não existe no Lossless) ──
opt = s.find('id="ls-optimized-toggle"')
if opt > 0:
    row_start = s.rfind('<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-top:1px solid var(--border)">', 0, opt)
    if row_start < 0:
        row_start = s.rfind('<div style=', 0, opt)
    row_end = s.find('</div>\n\n', opt)
    # remove até o fechamento da linha
    close2 = s.find('\n            </div>\n', opt)
    s = s[:row_start] + s[close2 + len('\n            </div>\n'):]
    print("versão otimizada removida do dashboard")

# remove a entrada no getConfig
s = re.sub(r'\n\s*optimized:\s*tog\([^)]*\),', '', s)

io.open(p, "w", encoding="utf-8").write(s)
print("dashboard ok | metrics:", "telemetry-toggle" not in s, "| optimized:", "ls-optimized-toggle" not in s)

# ── 3) janela separada: DrawFPS no getConfig, remove "Optimized version" ──
p = ROOT + r"\src\gdz-scaling.html"
s = io.open(p, encoding="utf-8").read()
# linha do Optimized version
row = re.search(r'\n\s*<div class="frow">\s*\n\s*<span class="flbl">Optimized version</span>.*?</div>\s*\n\s*</div>\s*\n', s, re.S)
if row:
    s = s[:row.start()] + '\n' + s[row.end():]
    print("optimized removido da janela")
else:
    print("AVISO: linha optimized da janela nÃ£o encontrada")

# getConfig: drawFps
if "drawFps:" not in s:
    s = s.replace("    optimized:       tog('ls-optimized'),", "    drawFps:         tog('ls-drawfps'),")
    s = s.replace("optimized:       tog('ls-optimized'),", "drawFps:         tog('ls-drawfps'),")
    print("drawFps adicionado ao getConfig")
io.open(p, "w", encoding="utf-8").write(s)
print("janela ok | drawFps:", "drawFps:" in s, "| optimized:", "ls-optimized" not in s)

# ── 4) writer: grava DrawFps ──
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
anchor = "  if (cfg.windowedMode != null) put('WindowedMode', cfg.windowedMode ? 'true' : 'false');"
if anchor not in s:
    raise SystemExit("anchor windowed nÃ£o encontrado")
s = s.replace(anchor, anchor + "\n  if (cfg.drawFps != null) put('DrawFps', cfg.drawFps ? 'true' : 'false');")
io.open(p, "w", encoding="utf-8").write(s)
print("writer ok")
