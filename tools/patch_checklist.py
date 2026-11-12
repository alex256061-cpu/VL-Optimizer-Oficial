import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
s = io.open(p, encoding="utf-8").read()

checklist = """## CHECKLIST DAS 7 ETAPAS (em andamento)

- [x] **1/7 — Remover controles mortos**: switch "Enviar métricas" removido do Sobre; "Optimized version" removido do dashboard e da janela do scaling (não existe no Lossless); "Draw FPS" agora é gravado no Lossless (`DrawFps`).
- [ ] **2/7 — Testar overlay e gargalo com um jogo** (precisa de um jogo aberto).
- [ ] **3/7 — Inicialização via `StartupApproved`** (Gerenciador de Tarefas refletir).
- [ ] **4/7 — Capas e tamanhos dos jogos**.
- [ ] **5/7 — Limpeza com progresso e sem corte de tempo**.
- [ ] **6/7 — Completar PC Info** (microcode, instruções, cache L1, tela, bateria).
- [ ] **7/7 — Validar OptiScaler e FiveM** (quando houver jogo/FiveM).

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + checklist + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("checklist ok")
