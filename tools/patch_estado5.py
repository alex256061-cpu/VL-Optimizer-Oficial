import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try:
    s = raw.decode("utf-8")
except UnicodeDecodeError:
    s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **2/7 — Testar overlay e gargalo com um jogo** (precisa de um jogo aberto).',
    '- [x] **2/7 — Testar overlay e gargalo com um jogo**: feito com Call of Duty aberto. Achados/correções: PresentMon precisa de admin (mensagem clara agora); sessões ETW órfãs travavam a captura (`--stop_existing_session` + nomes `LOPT_TARGET`/`LOPT_LIST`); gargalo agora amostra 1×/s numa única chamada (8 amostras em 8 s); overlay validado com 30 FPS, MS 33.3, 1% 28, CPU/GPU/RAM e nome do jogo.',
)

changelog = """## CHANGELOG — 2026-11-11 (4ª rodada — etapa 2)

- **Medidor de FPS validado com jogo real** (COD): 30 FPS, frametime 33,3 ms, 1% low 28; lista de processos com FPS por app.
- **PresentMon precisa de administrador**: `--stop_existing_session` + sessões próprias (`LOPT_TARGET`, `LOPT_LIST`) para não travar com sessão órfã; se faltar admin o app mostra o aviso "o medidor precisa de administrador".
- **Gargalo**: medição agora dentro de uma única chamada de PowerShell, 1 amostra por segundo (antes eram ~4 amostras em 8 s por causa do overhead).
- **Overlay validado**: janela sempre-no-topo com FPS/MS/1%/CPU/GPU/RAM/nome, print em `shots/overlay-teste.png`.

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok", "2/7" in s)
