import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
marker = "  if (process.argv.includes('--shots')) {"
block = """  if (process.argv.includes('--uitest')) {
    win.webContents.once('did-finish-load', async () => {
      const out = [];
      try {
        await new Promise((r) => setTimeout(r, 2600));
        await win.webContents.executeJavaScript(`(function(){
          try { localStorage.setItem('gdz-tour','1'); } catch(e) {}
          document.querySelectorAll('.tour-skip').forEach((b)=>b.click());
          document.querySelectorAll('.tour-root,.tour-overlay').forEach((e)=>e.remove());
        })();`);
        await win.webContents.executeJavaScript("go('inputlag')");
        await new Promise((r) => setTimeout(r, 2200));
        const sel = '.tw-row[data-key="tweak:kbd-repeat"] .tw-switch';
        out.push('before: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + (document.querySelector('${sel}')||{}).getAttribute?.call(document.querySelector('${sel}'),'aria-checked')`));
        await win.webContents.executeJavaScript(`document.querySelector('${sel}').click()`);
        await new Promise((r) => setTimeout(r, 3200));
        out.push('after on: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + document.querySelector('${sel}').getAttribute('aria-checked')`));
        out.push('row on: ' + await win.webContents.executeJavaScript(`(document.querySelector('.tw-row[data-key="tweak:kbd-repeat"]')||{}).className`));
        await win.webContents.executeJavaScript(`document.querySelector('${sel}').click()`);
        await new Promise((r) => setTimeout(r, 3200));
        out.push('after off: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + document.querySelector('${sel}').getAttribute('aria-checked')`));
      } catch (e) { out.push('ERR ' + e.message); }
      fs.writeFileSync(path.join(__dirname, 'uitest.log'), out.join('\\n'), 'utf8');
      console.log('UITEST_OK');
      app.exit(0);
    });
  }

"""
if marker not in s:
    raise SystemExit("marker não encontrado")
s = s.replace(marker, block + marker, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
