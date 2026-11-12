import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\ESTADO.md"
s = io.open(p, encoding="utf-8").read()
head_end = s.find("---\n\n## 0.")
changelog = """---

## CHANGELOG — 2026-11-11 (3ª rodada)

- **Sensores de verdade**: GPU via `nvidia-smi` (uso, temperatura, VRAM, consumo, ventoinha, clocks) no PC Info e no overlay
  (CPU/GPU temp + RAM). Pacote de RPM/clock por núcleo via `ProcessorInformation`. Discos: `Get-StorageReliabilityCounter`
  (temperatura/desgaste/horas — quando o SSD expõe; o KingFast deste PC não expõe e o campo some sozinho).
- **1% low real de 10 s**: a janela do PresentMon agora guarda timestamp por quadro e calcula o percentil sobre os últimos
  10 s (antes era aproximação de 600 quadros).
- **FPS por processo**: segunda sessão do PresentMon (`--session_name LOPT_LIST`) agrega quadros por aplicativo e preenche
  a lista da página Medidor com o FPS de cada processo (só aparece app que está realmente apresentando).
- **DNS só no adaptador físico ativo** (`Get-NetAdapter -Physical | Status Up`), tanto ao aplicar quanto ao detectar —
  VPN/virtual não é mais tocada.
- Build entregue em `dist` (o antigo `dist2` foi promovido) e `atualizar.cmd` faz a troca com o app aberto.

"""
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
