import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
anchor = "  if (process.argv.includes('--uitest')) {"
block = r"""  if (process.argv.includes('--optishot')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 700));
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(b=>b.click()); go('opti'); })();`);
        await new Promise((r) => setTimeout(r, 1200));
        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('[data-act="detect"]'); if (b) b.click(); })();`);
        await new Promise((r) => setTimeout(r, 5000));
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'shots', 'opti-block.png'), img.toPNG());
        console.log('OPTISHOT_OK');
      } catch (e) { console.error('OPTISHOT_ERR', e); }
      app.exit(0);
    });
  }

"""
if anchor not in s:
    raise SystemExit("uitest anchor nÃ£o encontrado")
s = s.replace(anchor, block + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
