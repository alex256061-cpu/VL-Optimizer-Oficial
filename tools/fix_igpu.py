import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "integrated=($_.Name -match 'Intel|UHD|Vega');"
new = "integrated=($_.Name -match 'Intel|UHD|Vega|Radeon\\(TM\\) Graphics|Radeon Graphics');"
if old not in s:
    raise SystemExit("integrated nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")

p2 = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
m = io.open(p2, encoding="utf-8").read()
old2 = """        if (!process.argv.includes('--pcsimple')) await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="advanced"]'); if (b) b.click(); })();`);"""
new2 = """        await win.webContents.executeJavaScript(`(function(){ const m = ${JSON.stringify('')}; const b = document.querySelector('button[data-mode="${'${'}process.argv.includes('--pcsimple') ? 'simple' : 'advanced'}"]'); if (b) b.click(); })();`);"""
new2 = """        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="${process.argv.includes('--pcsimple') ? 'simple' : 'advanced'}"]'); if (b) b.click(); })();`);"""
if old2 not in m:
    raise SystemExit("pcshot click nÃ£o encontrado")
m = m.replace(old2, new2, 1)
io.open(p2, "w", encoding="utf-8").write(m)
print("ok2")
