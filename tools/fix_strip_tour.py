import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = """        await new Promise((r) => setTimeout(r, 1800));
        const rect = await win.webContents.executeJavaScript"""
new = """        await new Promise((r) => setTimeout(r, 700));
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(function(b){b.click();}); document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask,.tour-bubble,.tour-highlight').forEach(function(e){e.remove();}); })();`);
        await new Promise((r) => setTimeout(r, 1500));
        const rect = await win.webContents.executeJavaScript"""
if old not in s:
    raise SystemExit("animstrip nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
