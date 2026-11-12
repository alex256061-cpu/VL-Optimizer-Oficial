import io, re
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
bad = '<link rel="stylesheet" href="tour.css"\n'
if bad in s:
    s = s.replace(bad, '<link rel="stylesheet" href="tour.css">\n', 1)
    print("tag corrigida")
# normaliza linhas em branco duplicadas e CR
s = s.replace("\r", "")
s = re.sub(r"\n{3,}", "\n\n", s)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("linhas:", s.count("\n") + 1)
