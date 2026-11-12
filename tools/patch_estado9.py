import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try: s = raw.decode("utf-8")
except UnicodeDecodeError: s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **6/7 — Completar PC Info** (microcode, instruções, cache L1, tela, bateria).',
    '- [x] **6/7 — PC Info completo**: microcode (0xA601209), família/modelo/stepping reais do `Identifier`, cache L1/L2/L3 somados (`Win32_CacheMemory`), chips de instruções por família, polegadas/ano das telas via EDID (`root\\wmi`), bateria real (`BatteryStaticData` etc.), VRAM real pelo `qwMemorySize`, RAM em bytes e "ligado há" em ms. Cache de 2 min + Atualizar forçando leitura.',
)

changelog = """## CHANGELOG — 2026-11-11 (8ª rodada — etapa 6)

- **PC Info completo**: microcode `0xA601209`, família 25 / modelo 97 / stepping 2 (lidos do `Identifier` do registro — o CIM reporta 107/0), cache L1 512 KB / L2 8 MB / L3 96 MB, chips de instruções (SSE→AVX-512, SHA, VAES, GFNI).
- **Telas**: polegadas e ano de fabricação via `WmiMonitorBasicDisplayParams`/`WmiMonitorID` (27,2" 2022 e 28,6" 2015 aqui).
- **VRAM real** pelo `HardwareInformation.qwMemorySize` (12 GB em vez de 4 GB do `AdapterRAM`), iGPU marcada como integrada.
- **Bugs corrigidos**: `bootAt` agora em ms (o "Ligado há" mostrava NaN), `installed` do SO, RAM ao vivo em bytes (mostrava 0,0 GB), campos `maker/part` da memória que quebravam o modo Avançado.
- **Desempenho**: `pcinfo-get` com cache de 2 min; botão Atualizar força nova leitura (primeira leitura ~2,3 s).
- Gotcha: o script do `pcinfo-get` usa `String.raw` — sem isso o JS come as barras dos caminhos (`HKLM:\\...` virava `HKLM:...`) e microcode/monitores vinham vazios.

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
