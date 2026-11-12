import io, os
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
SRC = ROOT + r"\src"

# tema-l.css foi gravado em ANSI pelo PowerShell: converte para UTF-8
p = SRC + r"\tema-l.css"
raw = open(p, "rb").read()
try:
    raw.decode("utf-8")
except UnicodeDecodeError:
    txt = raw.decode("cp1252")
    io.open(p, "w", encoding="utf-8").write(txt)
    print("tema-l.css convertido para UTF-8")

# VVL -> VL
for dp, dn, fn in os.walk(SRC):
    for f in fn:
        if not f.endswith((".css", ".js", ".html")):
            continue
        path = os.path.join(dp, f)
        raw = open(path, "rb").read()
        try:
            s = raw.decode("utf-8")
        except UnicodeDecodeError:
            s = raw.decode("cp1252")
        n = s.replace("VVL", "VL")
        if n != s:
            io.open(path, "w", encoding="utf-8").write(n)
            print("fix VVL:", f)

# verificação
d = io.open(SRC + r"\dashboard.html", encoding="utf-8").read()
print("social block:", '<div class="social-row">' in d)
print("plan block:", '<div class="about-plan" id="about-plan"' in d)
print("VVL:", "VVL" in d)
