import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
anchor = "  if (process.argv.includes('--uitest')) {"
block = r"""  if (process.argv.includes('--animstrip')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1800));
        const rect = await win.webContents.executeJavaScript(`(function(){ const r = document.querySelector('.gy').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        for (let i = 0; i < 4; i++) {
          const img = await win.webContents.capturePage(rect);
          fs.writeFileSync(path.join(__dirname, 'shots', 'anim-' + i + '.png'), img.toPNG());
          await new Promise((r) => setTimeout(r, 750));
        }
        console.log('ANIMSTRIP_OK');
      } catch (e) { console.log('ANIMSTRIP_ERR ' + e.message); }
      app.exit(0);
    });
  }

"""
if anchor not in s:
    raise SystemExit("anchor nÃ£o encontrado")
s = s.replace(anchor, block + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
