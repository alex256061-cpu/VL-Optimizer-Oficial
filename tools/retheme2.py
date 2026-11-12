import os, re

SRC = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src"

subs = [
    # lime (volt) -> red
    ("#c6ff3d", "#ff1f2e"),
    ("#dcff7a", "#ffe6e8"),
    ("#aee922", "#ff5560"),
    ("#e0ff8f", "#ff9aa2"),
    ("#8fc300", "#ff5560"),
    ("198,255,61", "255,31,46"),
    ("198, 255, 61", "255, 31, 46"),
    # toggles verdes do dashboard -> vermelho
    ("linear-gradient(135deg, #16a34a, #22c55e)", "linear-gradient(135deg, #e0101f, #ff5560)"),
    ("rgba(22,163,74,0.45)", "rgba(224,16,31,0.45)"),
    ("rgba(22,163,74,0.3)", "rgba(224,16,31,0.3)"),
    ("border-top-color: #16a34a;", "border-top-color: #ff1f2e;"),
    # fundo lilás do tema claro -> preto/vermelho discreto
    ("#ede8fb", "#0b0b0d"),
    ("#e2daf7", "#111114"),
    ("#1e0f3c", "#ededf0"),
    ("#3d2670", "#b9b9c2"),
    ("#ff6b74", "#ff6b74"),
]

changed = 0
for dp, dn, fn in os.walk(SRC):
    for f in fn:
        if not f.endswith(('.css', '.js', '.html')):
            continue
        p = os.path.join(dp, f)
        s = open(p, encoding='utf-8', errors='strict').read()
        n = s
        for a, b in subs:
            n = n.replace(a, b)
        if n != s:
            open(p, 'w', encoding='utf-8').write(n)
            changed += 1
print("files changed:", changed)
