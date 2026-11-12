import io, re

src = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(src, encoding="utf-8").read()
start = s.find("ex.pcinfoGet = async () => {")
start = s.find("core.ps(`", start) + len("core.ps(`")
end = s.find("`, 180000);", start)
script = s[start:end]
out = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\tools\pcinfo-extract.ps1"
io.open(out, "w", encoding="utf-8-sig").write(script)
print("extraído", len(script), "chars")
