import os, re, json
root = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src"
files = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        if f.endswith(('.css', '.js', '.html')):
            files.append(os.path.join(dp, f))
files.append(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\preload.js")

pat = re.compile(r'rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})')
from collections import Counter
c = Counter()
for f in files:
    s = open(f, encoding='utf-8', errors='replace').read()
    for m in pat.finditer(s):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if b > r + 10 and b > 60:  # bluish/purple
            c[f"rgb({r},{g},{b})"] += 1
for k, v in c.most_common(60):
    print(v, k)
