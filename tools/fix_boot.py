import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-ddTHH:mm:sszzz')"
new = "bootAt = [int64]([DateTimeOffset]$os.LastBootUpTime).ToUnixTimeMilliseconds()"
if old not in s:
    raise SystemExit("bootAt nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
