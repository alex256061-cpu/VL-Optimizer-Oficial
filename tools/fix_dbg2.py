import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
bad = "; dbg = @{ micro = [string]; monCount = @().Count; ucType = null }"
s = s.replace(bad, "")
# restaura o microcode caso tenha sido corrompido em algum Replace do PowerShell
s = s.replace("microcode=$micro }", "microcode=$micro }")
io.open(p, "w", encoding="utf-8").write(s)
print("ok", "dbg" not in s)
