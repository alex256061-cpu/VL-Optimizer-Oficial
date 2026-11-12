import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()

marker = "  if (process.argv.includes('--shots')) {"
block = r"""  if (process.argv.includes('--ftest')) {
    // teste de campo: mede o jogo aberto, liga o overlay e roda o gargalo
    win.webContents.once('did-finish-load', async () => {
      const out = {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        await sleep(2500);
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(b=>b.click()); document.querySelectorAll('.tour-root,.tour-overlay').forEach(e=>e.remove()); })();`);
        const g = await core.ps(`$p = Get-Process -Name cod -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { Write-Output ($p.Id.ToString() + '|' + $p.ProcessName) }`);
        const [pidStr, pname] = g.out.split('|');
        out.pid = parseInt(pidStr, 10) || null;
        out.name = pname || null;
        if (!out.pid) throw new Error('jogo cod nao encontrado');
        out.target = await ex.fpsSetTarget(out.pid);
        await sleep(7000);
        const st = await ex.fpsStatus();
        out.live = st.live;
        out.processesWithFps = (st.processes || []).filter((p) => p.fps > 0).map((p) => p.name + ':' + p.fps);
        const ov = ex.fpsOverlaySet({ on: true, pos: 0, show: { frametime: true, low1: true, cpu: true, gpu: true, ram: true, name: true } });
        ex.setOverlayState({ on: true, pos: 0, show: ov.overlay.show });
        applyOverlay({ on: true, pos: 0, show: ov.overlay.show });
        await sleep(4500);
        const ow = BrowserWindow.getAllWindows().find((w) => w !== win);
        if (ow) {
          const img = await ow.webContents.capturePage();
          fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
          fs.writeFileSync(path.join(__dirname, 'shots', 'overlay-teste.png'), img.toPNG());
          out.overlayCaptured = true;
          out.overlayBounds = ow.getBounds();
        } else out.overlayCaptured = false;
        out.bottleneck = await ex.measureBottleneck({ seconds: 8, pid: out.pid });
        fs.writeFileSync(path.join(__dirname, 'ftest.json'), JSON.stringify(out, null, 1));
        console.log('FTEST_OK');
      } catch (e) {
        fs.writeFileSync(path.join(__dirname, 'ftest.json'), JSON.stringify({ error: String(e), out }, null, 1));
        console.log('FTEST_ERR ' + e.message);
      }
      app.exit(0);
    });
  }

"""
if marker not in s:
    raise SystemExit("marker shots nÃ£o encontrado")
s = s.replace(marker, block + marker, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ftest ok")
