import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

i = s.find('OPTISCALER')
j = s.find('SCALING (Lossless Scaling)')
if i < 0 or j < 0:
    raise SystemExit("marcadores nÃ£o achados")
start = s.rfind('\n// ', 0, i)
end = s.rfind('\n// ', 0, j)
if start < 0 or end < 0 or end <= start:
    raise SystemExit("limites nÃ£o achados")

block = io.open(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\tools\opti-block.js", encoding="utf-8").read()
s = s[:start] + block + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("substituído", end - start, "chars por", len(block))
