import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# microcode como número (o renderer formata em hex)
old = "if ($b.Count -ge 4) { $micro = ('{0:X}' -f ([int64]$b[0] + [int64]$b[1] * 256 + [int64]$b[2] * 65536 + [int64]$b[3] * 16777216)) }"
new = "if ($b.Count -ge 4) { $micro = ([int64]$b[0] + [int64]$b[1] * 256 + [int64]$b[2] * 65536 + [int64]$b[3] * 16777216) }"
if old not in s:
    raise SystemExit("microcode format nÃ£o encontrado")
s = s.replace(old, new, 1)

# família/modelo/stepping reais a partir do Identifier (AMD reporta 107/0 no CIM)
old2 = """      cpu = @{ name=[string]$cpu.Name; vendor=[string]$cpu.Manufacturer; cores=[int]$cpu.NumberOfCores; threads=[int]$cpu.NumberOfLogicalProcessors; maxMhz=[int]$cpu.MaxClockSpeed; socket=[string]$cpu.Socket; family=[int]$cpu.Family; model=[int]$cpu.Model; stepping=[int]$cpu.Stepping;"""
new2 = """      cpu = @{ name=[string]$cpu.Name; vendor=[string]$cpu.Manufacturer; cores=[int]$cpu.NumberOfCores; threads=[int]$cpu.NumberOfLogicalProcessors; maxMhz=[int]$cpu.MaxClockSpeed; socket=[string]$cpu.Socket; family=[int]$cpu.Family; model=[int]$cpu.Model; stepping=[int]$cpu.Stepping; identifier=[string]$cpu.Identifier;"""
if old2 not in s:
    raise SystemExit("cpu fields nÃ£o encontrados")
s = s.replace(old2, new2, 1)

# JS: parseia Identifier e corrige family/model/stepping + microcode numérico
old3 = """    // Instruções: o Windows não expõe CPUID; mapeamos pelo modelo (Zen 4 / Zen 3 / Intel 12ª+)."""
new3 = """    // AMD reporta Family 107/Model 0 no CIM; o Identifier traz os valores reais.
    try {
      const id = String((info.cpu && info.cpu.identifier) || '');
      const m = /Family\\s+(\\d+)\\s+Model\\s+(\\d+)\\s+Stepping\\s+(\\d+)/i.exec(id);
      if (m) { info.cpu.family = Number(m[1]); info.cpu.model = Number(m[2]); info.cpu.stepping = Number(m[3]); }
    } catch (e) {}

    // Instruções: o Windows não expõe CPUID; mapeamos pelo modelo (Zen 4 / Zen 3 / Intel 12ª+)."""
if old3 not in s:
    raise SystemExit("features anchor nÃ£o encontrado")
s = s.replace(old3, new3, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
