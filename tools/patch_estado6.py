import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try: s = raw.decode("utf-8")
except UnicodeDecodeError: s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **3/7 — Inicialização via `StartupApproved`** (Gerenciador de Tarefas refletir).',
    '- [x] **3/7 — Inicialização via `StartupApproved`**: o estado agora é lido/gravado em `Explorer\\StartupApproved` (Run/Run32/StartupFolder), igual ao Gerenciador de Tarefas; o valor do Run não é mais movido; impacto estimado (alto/médio/baixo) exibido em cada linha; itens de HKLM pedem admin (mensagem clara).',
)

changelog = """## CHANGELOG — 2026-11-11 (5ª rodada — etapa 3)

- **Inicialização na forma do Windows**: leitura e escrita em `HKCU/HKLM\\...\\Explorer\\StartupApproved` (`Run`, `Run32`, `StartupFolder`), com blob binário 02 (ligado) / 03 (desligado). O valor do `Run` fica intacto — o Gerenciador de Tarefas passa a refletir o mesmo estado.
- **Impacto estimado** por app (alto/médio/baixo) na lista, com cor.
- Compatibilidade com itens desligados pela versão antiga (backup próprio) mantida.
- Template da lista corrigido (impacto dentro do bloco de informação, sem sobrepor o switch).

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
