import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\plano.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("if (user.lifetime) return 'Vitalício';", "if (user.lifetime) return 'Tudo liberado';")
io.open(p, "w", encoding="utf-8").write(s)
print("ok", "Tudo liberado" in s)
