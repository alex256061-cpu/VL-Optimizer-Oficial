import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""document.querySelector('[data-mode-link="advanced"]')""", """document.querySelector('button[data-mode="advanced"]')""")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
