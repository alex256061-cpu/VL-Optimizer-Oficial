import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "bank=[string]$_.BankLabel; slot=[string]$_.DeviceLocator;"
new = "bank=[string]$_.BankLabel; slot=[string]$_.DeviceLocator; maker=[string]$_.Manufacturer; part=[string]$_.PartNumber;"
if old not in s:
    raise SystemExit("mem fields nÃ£o encontrados")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
