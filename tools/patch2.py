import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
old = """        for (const p of pages) {
          try { await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`); } catch (e) { logs.push('go ERR ' + p + ' ' + e.message); }
          await new Promise((r) => setTimeout(r, 1500));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, p + '.png'), img.toPNG());
        }"""
new = """        for (const p of pages) {
          let active = '';
          try { await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`); } catch (e) { logs.push('go ERR ' + p + ' ' + e.message); }
          await new Promise((r) => setTimeout(r, 1100));
          try { await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); } catch (e) {}
          await new Promise((r) => setTimeout(r, 350));
          try { active = await win.webContents.executeJavaScript("(document.querySelector('.page.active') || {}).id || ''"); } catch (e) {}
          logs.push('page ' + p + ' -> ' + active);
          try { win.webContents.invalidate(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 200));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, p + '.png'), img.toPNG());
        }"""
if old not in s:
    raise SystemExit("bloco não encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
