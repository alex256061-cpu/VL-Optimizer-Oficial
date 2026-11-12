import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = """          try { await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`); } catch (e) { logs.push('go ERR ' + p + ' ' + e.message); }"""
new = """          try { await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`); } catch (e) { logs.push('go ERR ' + p + ' ' + e.message); }
          if (p === 'pcinfo') {
            try { await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('[data-mode-link="advanced"]'); if (b) b.click(); })()`); } catch (e) {}
          }"""
if old not in s:
    raise SystemExit("shots go nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
