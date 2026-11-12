import io, re

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
raw = open(p, "rb").read()
txt = raw.decode("utf-8")
print("CRCR:", txt.count("\r\r"), "CRLF:", txt.count("\r\n"), "LF:", txt.count("\n"))
# normaliza: remove todos os CR, deixa LF puro e remove linhas em branco duplicadas
txt = txt.replace("\r", "")
txt = re.sub(r"\n{3,}", "\n\n", txt)
io.open(p, "w", encoding="utf-8", newline="").write(txt)
print("normalizado")
