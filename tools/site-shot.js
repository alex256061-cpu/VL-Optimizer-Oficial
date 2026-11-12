const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'site', 'preview');
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 950, backgroundColor: '#07030a', show: true, webPreferences: { offscreen: false } });
  await win.loadFile(path.join(__dirname, '..', 'site', 'index.html'));
  await sleep(2600);
  await win.webContents.executeJavaScript(`window.scrollTo(0,0); (function(){ document.querySelectorAll('.reveal').forEach(function(e){e.classList.add('in');}); })();`);
  await sleep(900);

  const shots = [
    ['01-hero', 0],
    ['02-recursos', 980],
    ['03-prints', 2050],
    ['04-precos', 3300],
    ['05-faq', 4300],
  ];
  for (const [name, y] of shots) {
    await win.webContents.executeJavaScript(`window.scrollTo({top:${y},behavior:'instant'})`);
    await sleep(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  }

  // mobile
  win.setContentSize(430, 900);
  await sleep(600);
  await win.webContents.executeJavaScript(`window.scrollTo(0,0)`);
  await sleep(600);
  fs.writeFileSync(path.join(out, '06-mobile.png'), (await win.webContents.capturePage()).toPNG());

  console.log('SITE_SHOTS_OK');
  app.exit(0);
});
