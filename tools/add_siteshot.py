import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()

anchor = "app.whenReady().then(async () => {"
if anchor not in s:
    raise SystemExit("whenReady nÃ£o encontrado")

block = r"""app.whenReady().then(async () => {
  if (process.argv.includes('--siteshot')) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = path.join(__dirname, 'site', 'preview');
    fs.mkdirSync(out, { recursive: true });
    const sw = new BrowserWindow({ width: 1440, height: 950, show: true, backgroundColor: '#07030a', autoHideMenuBar: true });
    await sw.loadFile(path.join(__dirname, 'site', 'index.html'));
    await sleep(2600);
    await sw.webContents.executeJavaScript(`window.scrollTo(0,0); (function(){ document.querySelectorAll('.reveal').forEach(function(e){e.classList.add('in');}); })();`);
    await sleep(900);
    const spots = [['01-hero', 0], ['02-recursos', 980], ['03-prints', 2050], ['04-precos', 3300], ['05-faq', 4300]];
    for (const [name, y] of spots) {
      await sw.webContents.executeJavaScript(`window.scrollTo({top:${y},behavior:'instant'})`);
      await sleep(700);
      const img = await sw.webContents.capturePage();
      fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    }
    sw.setContentSize(430, 900);
    await sleep(700);
    await sw.webContents.executeJavaScript('window.scrollTo(0,0)');
    await sleep(600);
    fs.writeFileSync(path.join(out, '06-mobile.png'), (await sw.webContents.capturePage()).toPNG());
    console.log('SITE_SHOTS_OK');
    app.exit(0);
    return;
  }
"""
s = s.replace(anchor, block, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
