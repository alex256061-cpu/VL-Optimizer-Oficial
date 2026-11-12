import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = "        await new Promise((r) => setTimeout(r, 700));\n        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode=\"advanced\"]'); if (b) b.click(); })();`);"
new = "        await new Promise((r) => setTimeout(r, 700));\n        try {\n          const t = await win.webContents.executeJavaScript(`(async () => { try { const r = await ipcRenderer.invoke('pcinfo-get'); return { ok: !!r, success: r && r.success, hasInfo: !!(r && r.info), err: r && r.error }; } catch (e) { return { thrown: String(e) }; } })()`);\n          console.log('PCTEST ' + JSON.stringify(t));\n        } catch (e) { console.log('PCTEST_ERR ' + e.message); }\n        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode=\"advanced\"]'); if (b) b.click(); })();`);"
if old not in s:
    raise SystemExit("pcshot trecho nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
