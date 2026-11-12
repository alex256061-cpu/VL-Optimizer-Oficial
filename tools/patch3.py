import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
s = s.replace("localStorage.setItem('gdz-tour', 'v-shot')", "localStorage.setItem('gdz-tour', '1')")
io.open(p, "w", encoding="utf-8").write(s)
print("ok", "'gdz-tour', '1'" in s)
