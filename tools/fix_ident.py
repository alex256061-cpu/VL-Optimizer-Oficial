import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = """    $uc = (Get-ItemProperty $cpuKey -ErrorAction SilentlyContinue).'Update Revision'"""
new = """    $cpuReg = Get-ItemProperty $cpuKey -ErrorAction SilentlyContinue
    $uc = $cpuReg.'Update Revision'
    $ident = [string]$cpuReg.Identifier"""
if old not in s:
    raise SystemExit("uc line nÃ£o encontrada")
s = s.replace(old, new, 1)
s = s.replace("identifier=[string]$cpu.Identifier;", "identifier=[string]$ident;")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
