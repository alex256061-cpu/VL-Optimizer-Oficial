import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

start = s.find("ex.lsLaunch = async (cfg) => {")
end = s.find("ex.lsStop = async () => {")
if start < 0 or end < 0:
    raise SystemExit("lsLaunch não encontrado")

new = r"""ex.lsLaunch = async (cfg) => {
  const exePath = await lsDetect(true);
  if (!exePath) return { success: false, error: 'Lossless Scaling não encontrado. Instale pela Steam (ou escolha o .exe na engrenagem).' };

  // Sem Settings.xml: abre uma vez para o app criar o perfil padrão (ele não sobe sem perfil).
  if (!fs.existsSync(lsSettingsPath())) {
    try { const { shell } = require('electron'); await shell.openPath(exePath); } catch (e) {}
    return { success: true, message: 'Primeira vez: o Lossless abriu para criar o perfil. Feche ele e clique Iniciar de novo.' };
  }

  let applied = null;
  if (cfg && typeof cfg === 'object') {
    applied = lsWrite(cfg);
    if (!applied.success) return { success: false, error: applied.error || 'Falha ao gravar o Settings.xml.' };
    const cc = scalingCfg(); cc.config = cfg; cc.settingsRejected = false; saveScaling(cc);
  }

  // fecha a instância antiga (precisa de admin) e espera o processo sumir antes de abrir de novo
  try {
    await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`, 20000);
    for (let i = 0; i < 20; i++) {
      const alive = await core.ps(`Write-Output @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue).Count`, 8000);
      if ((parseInt(alive.out, 10) || 0) === 0) break;
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (e) {}

  // abre pelo shell (CreateProcess direto faz o Lossless crashar; ShellExecute não)
  try {
    const { shell } = require('electron');
    const err = await shell.openPath(exePath);
    if (err) return { success: false, error: 'Não foi possível abrir o Lossless: ' + err };
    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);
    // confere 9s depois se o engine aceitou (ele reescreve o arquivo com os valores dele)
    setTimeout(async () => {
      try {
        const cur = ex.lsRead();
        if (!cur.exists || !cur.settings) return;
        const want = applied && applied.settings ? applied.settings.FrameGeneration : null;
        if (want && cur.settings.FrameGeneration && String(cur.settings.FrameGeneration).toUpperCase() !== String(want).toUpperCase()) {
          const cc = scalingCfg(); cc.settingsRejected = true; saveScaling(cc);
        }
      } catch (e) {}
    }, 9000);
    return { success: true, engine: exePath, applied: applied ? applied.applied : 0, message: applied && applied.applied ? 'Opções aplicadas no Lossless.' : undefined };
  } catch (e) {
    return { success: false, error: 'Falha ao abrir o Lossless: ' + e.message };
  }
};
"""
s = s[:start] + new + s[end:]

# lsStop devolve o resultado real
old_stop = """ex.lsStop = async () => {
  const r = await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Output 'ok'`, 20000);
  return { success: r.ok };
};"""
new_stop = """ex.lsStop = async () => {
  const r = await core.ps(`$alive = @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue); $alive | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; Write-Output @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue).Count`, 20000);
  const left = parseInt(r.out, 10) || 0;
  if (left > 0) return { success: false, error: 'O Lossless está aberto como administrador. Feche ele ou abra o VL como admin.' };
  return { success: true };
};"""
s = s.replace(old_stop, new_stop)
io.open(p, "w", encoding="utf-8").write(s)
print("launch/stop ok")
