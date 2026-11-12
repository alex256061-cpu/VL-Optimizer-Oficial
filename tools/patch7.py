import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
old = """        fs.writeFileSync(path.join(dir, 'console.log'), logs.join('\\n'), 'utf8');
        console.log('SHOTS_OK', logs.length);"""
new = """        // janela do L Scaling
        try {
          await win.webContents.executeJavaScript("openScalingWindow()");
          await new Promise((r) => setTimeout(r, 2200));
          const sw = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed());
          if (sw) {
            const img = await sw.webContents.capturePage();
            fs.writeFileSync(path.join(dir, 'scaling.png'), img.toPNG());
            logs.push('scaling window capturada');
          }
        } catch (e) { logs.push('scaling ERR ' + e.message); }
        fs.writeFileSync(path.join(dir, 'console.log'), logs.join('\\n'), 'utf8');
        console.log('SHOTS_OK', logs.length);"""
if old not in s:
    raise SystemExit("bloco console.log não encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
