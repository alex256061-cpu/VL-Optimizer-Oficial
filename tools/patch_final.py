import io, os, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── logo: disco mais escuro, halo menor, mark com fio branco ──
p = ROOT + r"\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()
start = s.find("/* ── Logo VL em destaque")
new = """/* ── Logo VL em destaque no centro do giroscópio ── */
.gy-core { width: 108px; height: 108px; margin: -54px 0 0 -54px; }
.gy-core > * { border-radius: 50%; }
.gy-core i:nth-child(1) {
  transform: translateZ(-12px);
  background: radial-gradient(circle at 50% 34%, #1b070a 0%, #0b0406 55%, #010101 100%);
  box-shadow: 0 0 26px rgba(255, 31, 46, 0.45), 0 0 64px rgba(255, 31, 46, 0.18), inset 0 0 20px rgba(255, 31, 46, 0.28);
  border: 1px solid rgba(255, 85, 96, 0.28);
}
.gy-core i:nth-child(2) { transform: translateZ(-6px); background: #5c050c; }
.gy-core i:nth-child(3) { background: #150407; }
.gy-core img {
  transform: translateZ(54px) scale(1.18);
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 10px rgba(255, 31, 46, 0.95)) drop-shadow(0 6px 16px rgba(0, 0, 0, 0.65));
}
[data-fx="off"] .gy-core { transform: rotateY(-18deg) rotateX(6deg); }
[data-theme="light"] .gy-core i:nth-child(1) {
  background: radial-gradient(circle at 50% 34%, #ffffff 0%, #ffe6e8 55%, #ffd4d8 100%);
  box-shadow: 0 0 28px rgba(224, 16, 31, 0.35), inset 0 0 16px rgba(224, 16, 31, 0.18);
}
[data-theme="light"] .gy-core i:nth-child(2) { background: #ffd4d8; }
[data-theme="light"] .gy-core i:nth-child(3) { background: #fff2f3; }
"""
if start < 0:
    raise SystemExit("bloco do logo não encontrado")
io.open(p, "w", encoding="utf-8").write(s[:start] + new)
print("logo css ok")

# ── remove log de debug do shots e o probe ──
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("for (const p of pages) {\n          console.log('SHOT_START', p);", "for (const p of pages) {")
io.open(p, "w", encoding="utf-8").write(s)
if os.path.exists(ROOT + r"\probe.js"):
    os.remove(ROOT + r"\probe.js")
print("debug limpo")

# ── README: VL + funcionalidades novas ──
p = ROOT + r"\README.md"
s = io.open(p, encoding="utf-8").read()
s = s.replace("## O que está ligado de verdade", """## Novidades desta versão

- **Nome e marca:** VL (título, janela, instalador e pasta de dados).
- **Sem rastro de rede social:** botões de TikTok/Discord e textos de conta removidos; nada aponta para gdzfps.com.
- **Logo em destaque:** o "VL" virou medalhão no centro do giroscópio (108 px, disco escuro, halo vermelho).
- **Modo administrador:** o app reabre elevado (UAC) na primeira execução; se você cancelar, aparece um aviso no topo com o botão "Reabrir como admin".
- **Atalho global Ctrl+Alt+B:** marca a base de FPS com o jogo em foco, sem sair do jogo.
- **Modo automático de verdade:** com ele ligado, ao abrir um jogo o app baixa a prioridade de Chrome/Discord, fecha OneDrive/Dropbox/Google Drive e liga o plano Alto Desempenho; ao fechar, devolve o plano anterior.
- **Limpar RAM real:** `EmptyWorkingSet` nos processos grandes (teste no PC: liberou ~2 GB).
- **Programas com ícone real** (extraído do shell) e **sobras de registro** com backup `.reg` em `desinstalacoes` antes de apagar.

## O que está ligado de verdade""")
io.open(p, "w", encoding="utf-8").write(s)
print("readme ok")
