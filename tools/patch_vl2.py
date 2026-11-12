import io, os

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
TARGETS = []

for dp, dn, fn in os.walk(ROOT + r"\src"):
    for f in fn:
        if f.endswith((".css", ".js", ".html")):
            TARGETS.append(os.path.join(dp, f))
for f in ("main.js", "engine.js", "engine-extras.js", "preload.js", "README.md", "package.json", "start.cmd"):
    p = os.path.join(ROOT, f)
    if os.path.exists(p):
        TARGETS.append(p)

pairs = [
    ("L Optimizer", "VL Optimizer"),
    ("L Scaling", "VL Scaling"),
    ("L FG", "VL FG"),
    ("L SCALING", "VL SCALING"),
    ("do L ", "do VL "),
    ("do L.", "do VL."),
    ("do L,", "do VL,"),
    ("do L a ", "do VL a "),
    ("o L im", "o VL im"),
    ("onde fica o suporte", "onde fica o suporte"),
]

changed = 0
for p in TARGETS:
    raw = open(p, "rb").read()
    try:
        s = raw.decode("utf-8")
    except UnicodeDecodeError:
        s = raw.decode("cp1252")
        print("convertido:", os.path.basename(p))
    n = s
    for a, b in pairs:
        n = n.replace(a, b)
    # conserta duplicação acidental
    while "VVL" in n:
        n = n.replace("VVL", "VL")
    if n != s:
        io.open(p, "w", encoding="utf-8").write(n)
        changed += 1

print("arquivos alterados:", changed)
