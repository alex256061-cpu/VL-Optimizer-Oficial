import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()

s = s.replace("--d: 178px; --w: 6px;", "--d: 186px; --w: 4px;")
s = s.replace("--d: 136px; --w: 5px;", "--d: 142px; --w: 3.5px;")
s = s.replace("--d: 98px; --w: 4px;", "--d: 102px; --w: 3px;")

s = s.replace(
    "  background: conic-gradient(from var(--from), var(--c2) 0deg, var(--c1) 28deg, var(--c1) 300deg, var(--c2) 336deg, #fff 356deg, var(--c2) 360deg);",
    "  background: conic-gradient(from var(--from), var(--c2) 0deg, var(--c1) 22deg, var(--c1) 306deg, var(--c2) 336deg, var(--gy-a2) 352deg, var(--c2) 360deg);",
)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
