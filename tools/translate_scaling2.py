import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\gdz-scaling.html"
s = io.open(p, encoding="utf-8").read()

s = s.replace("""  document.getElementById('pbar-name').textContent = '"' + name + '"';""",
              """  document.getElementById('pbar-name').textContent = '"' + (name === 'Default' ? 'Padrão' : name) + '"';""")
s = s.replace("""document.getElementById('stxt').textContent = msg || (active ? 'Active' : 'Inactive');""",
              """document.getElementById('stxt').textContent = msg || (active ? 'Ativo' : 'Inativo');""")
s = s.replace("""setStatus(true, 'Active');""", """setStatus(true, 'Ativo');""")
s = s.replace("""setStatus(false, 'Inactive');""", """setStatus(false, 'Inativo');""")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
