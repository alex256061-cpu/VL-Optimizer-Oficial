import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try: s = raw.decode("utf-8")
except UnicodeDecodeError: s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **5/7 — Limpeza com progresso e sem corte de tempo**.',
    '- [x] **5/7 — Limpeza sem corte**: medição completa (orçamento só como trava de 30 s), categorias em paralelo, nova categoria **Instaladores de driver** (C:\\NVIDIA, C:\\AMD, C:\\Intel, downloader NVIDIA), progresso no rodapé e "Medindo…" por item; temporários saltaram de ~2 GB para 15,6 GB reais.',
)

changelog = """## CHANGELOG — 2026-11-11 (7ª rodada — etapa 5)

- **Limpeza sem corte**: a medição não usa mais o orçamento de 6 s (que subestimava); agora mede tudo, com trava de segurança de 30 s e categorias em paralelo. Resultado real neste PC: 15,6 GB de temporários (antes aparecia uma fração).
- **Nova categoria "Instaladores de driver"**: C:\\NVIDIA, C:\\AMD, C:\\Intel e `ProgramData\\NVIDIA Corporation\\Downloader` (arquivos com mais de 7 dias).
- **Progresso**: `clean-status` devolve índice/total e "Medindo…" por item; o rodapé mostra "medindo X/Y".
- **Sem travar a interface**: a checagem de programas abertos virou uma única chamada assíncrona cacheada (antes eram vários `tasklist` síncronos que travavam o app).

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
