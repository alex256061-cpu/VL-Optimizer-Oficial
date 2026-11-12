import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = """        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="advanced"]'); if (b) b.click(); })();`);
        await new Promise((r) => setTimeout(r, 15000));
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'shots', 'pcinfo.png'), img.toPNG());"""
new = """        if (!process.argv.includes('--pcsimple')) await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="advanced"]'); if (b) b.click(); })();`);
        await new Promise((r) => setTimeout(r, 15000));
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'shots', process.argv.includes('--pcsimple') ? 'pcinfo-simple.png' : 'pcinfo.png'), img.toPNG());"""
if old not in s:
    raise SystemExit("pcshot capture nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
