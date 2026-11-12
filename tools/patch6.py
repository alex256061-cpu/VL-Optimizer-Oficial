import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# 1) shots loop: dismiss tour right before capture
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
old = "          logs.push('page ' + p + ' -> ' + active);"
new = """          logs.push('page ' + p + ' -> ' + active);
          try {
            await win.webContents.executeJavaScript(`(function(){ document.querySelectorAll('.tour-skip').forEach((b) => b.click()); document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask,.tour-highlight,.tour-bubble').forEach((e) => e.remove()); })();`);
          } catch (e) {}"""
if old not in s:
    raise SystemExit("loop marker não encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("main ok")

# 2) fps auto-target: só jogo conhecido
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = """  if (!fps.proc) {
    // auto-alvo: jogo com janela maior
    if (!fps.targetPid) {
      const r = await core.ps(`$o = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne ${process.pid} } | Select-Object -First 1); if ($o.Count) { Write-Output $o[0].Id; Write-Output ($o[0].ProcessName + '.exe') }`);
      const lines = r.out.split('\\n').map((s) => s.trim()).filter(Boolean);
      if (lines[0]) { startPM(Number(lines[0])); fps.targetName = lines[1] || ''; }
    }
  }"""
new = """  if (!fps.proc && !fps.targetPid) {
    // auto-alvo: só um jogo conhecido, nunca o primeiro processo que aparecer
    try {
      const games = (await ex.gamesStatus()).games || [];
      const names = new Set(games.map((g) => String(g.name || '').toLowerCase()));
      const r = await core.ps(`$o = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne ${process.pid} } | ForEach-Object { @{ id=$_.Id; name=$_.ProcessName } }); Write-Output (Json $o)`);
      let procs = [];
      try { procs = JSON.parse(r.out); } catch (e) {}
      if (!Array.isArray(procs)) procs = procs ? [procs] : [];
      const game = procs.find((p) => names.has(String(p.name || '').toLowerCase()) || /fivem|gta|cs2|valorant|fortnite|warzone|apex|rust|pubg|league|rocket|overwatch|minecraft/i.test(p.name || ''));
      if (game) { startPM(Number(game.id)); fps.targetName = game.name + '.exe'; }
    } catch (e) {}
  }"""
if old not in s:
    raise SystemExit("fps block não encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("fps ok")
