import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# 1) hardware: trim + detail sem GB errado
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("$o = @{ cpu=$cpu.Name; cpuDetail=", "$o = @{ cpu=$cpu.Name.Trim(); cpuDetail=")
s = s.replace('gpuDetail=("$([math]::Round($gpu.AdapterRAM/1GB)) GB . driver $($gpu.DriverVersion)");', 'gpuDetail=("driver $($gpu.DriverVersion)");')
io.open(p, "w", encoding="utf-8").write(s)
print("hw ok")

# 2) ticker: só trabalha com overlay ligado
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
old = """function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(async () => {
    try {
      await ex.fpsTick();
      const ov = ex.fpsOverlayPayload();
      if (win && !win.isDestroyed() && ov.live) win.webContents.send('fps-update', ov);
      const st = ex.getOverlayState();
      if (overlayWin && !overlayWin.isDestroyed() && st.on && ov.live) {
        overlayWin.webContents.send('overlay-update', { ...ov, on: true, pos: st.pos, show: st.show });
      }
    } catch (e) {}
  }, 1000);
}"""
new = """function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(async () => {
    try {
      const st = ex.getOverlayState();
      if (!st.on) return; // sem overlay, nada de PowerShell de segundo em segundo
      await ex.fpsTick();
      const ov = ex.fpsOverlayPayload();
      if (overlayWin && !overlayWin.isDestroyed() && ov.live) {
        overlayWin.webContents.send('overlay-update', { ...ov, on: true, pos: st.pos, show: st.show });
      }
    } catch (e) {}
  }, 1500);
}"""
if old not in s:
    raise SystemExit("ticker não encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ticker ok")
