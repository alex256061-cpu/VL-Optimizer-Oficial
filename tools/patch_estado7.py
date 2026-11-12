import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try: s = raw.decode("utf-8")
except UnicodeDecodeError: s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **4/7 — Capas e tamanhos dos jogos**.',
    '- [x] **4/7 — Capas e tamanhos dos jogos**: Steam usa `steamId` e puxa a arte do CDN (retrato + wide); tamanho da pasta somado em paralelo (orçamento 4 s por jogo) e exibido no rodapé do card (COD: 97,5 GB); detecção de "Rodando" por processo real.',
)

changelog = """## CHANGELOG — 2026-11-11 (6ª rodada — etapa 4)

- **Capa dos jogos**: `steamId` exposto pelo scanner → o renderer monta a arte oficial do CDN da Steam (retrato + alternativas wide). Epic/FiveM seguem com o card de letra.
- **Tamanho em disco**: soma assíncrona da pasta de cada jogo em paralelo, orçamento de 4 s por jogo, rótulo pt-BR no rodapé do card (ex.: 97,5 GB).
- **"Rodando" de verdade**: `gamesStatus` compara os processos abertos com o `.exe` de cada jogo (antes todos apareciam parados).
- **Bug corrigido**: o renderer só mostra jogos com `installed: true` — o scanner não setava a flag e a lista aparecia vazia.

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
