import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# Não gravar literais de enum que não conseguimos confirmar no binário (evita corromper o XML).
s = s.replace("  if (cfg.lsfg2Mode != null) put('LSFG2Mode', LS_CFG_TO_XML.lsfg2Mode[cfg.lsfg2Mode] || null);\n", "")
s = s.replace("  if (cfg.fitMode != null) put('ScalingFitMode', LS_CFG_TO_XML.fitMode[cfg.fitMode] || null);\n", "")
io.open(p, "w", encoding="utf-8").write(s)
print("ok", "LSFG2Mode', LS_CFG" not in s)
