import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
anchor = "  if (process.argv.includes('--uitest')) {"
block = r"""  if (process.argv.includes('--animcheck')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1600));
        const r = await win.webContents.executeJavaScript(`(function(){
          const gim = document.querySelector('.gy-gimbal');
          const rings = Array.prototype.slice.call(document.querySelectorAll('.gy-ring'));
          const img = document.querySelector('.gy-core img');
          return {
            gimbal: gim ? getComputedStyle(gim).animationName : null,
            rings: rings.map(function (x) { const c = getComputedStyle(x); return c.animationName + ' ' + c.animationDuration + ' ' + c.animationDirection; }),
            logo: img ? img.getAttribute('src') : null
          };
        })()`);
        console.log('ANIM ' + JSON.stringify(r));
      } catch (e) { console.log('ANIM_ERR ' + e.message); }
      app.exit(0);
    });
  }

"""
if anchor not in s:
    raise SystemExit("anchor nÃ£o encontrado")
s = s.replace(anchor, block + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
