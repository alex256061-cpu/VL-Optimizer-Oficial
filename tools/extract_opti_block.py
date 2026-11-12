import io, re

src = io.open(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\tools\patch_opti.py", encoding="utf-8").read()
m = re.search(r'block = r"""(.*?)"""\n', src, re.S)
if not m:
    raise SystemExit("bloco nÃ£o extraÃ­do")
io.open(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\tools\opti-block.js", "w", encoding="utf-8").write(m.group(1))
print("opti-block.js:", len(m.group(1)))
