import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# admin check + cfg salvo no launch + handler de erro do spawn
old = """  let applied = null;
  if (cfg && typeof cfg === 'object') applied = lsWrite(cfg);
  // fecha uma instância antiga para pegar as opções novas
  await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`, 20000);
  try {
    const args = ['-StartMinimized'];
    const child = spawn(exePath, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) });
    child.unref();
    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);"""
new = """  const adm = await core.ps(`Write-Output ([bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)))`);
  if (!/true/i.test(adm.out)) {
    return { success: false, error: 'O Lossless exige administrador. Clique em "Reabrir como admin" na faixa do topo e tente de novo.' };
  }
  let applied = null;
  if (cfg && typeof cfg === 'object') {
    applied = lsWrite(cfg);
    const cc = scalingCfg(); cc.config = cfg; saveScaling(cc);
  }
  // fecha uma instância antiga para pegar as opções novas
  await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`, 20000);
  try {
    const args = ['-StartMinimized'];
    const child = spawn(exePath, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) });
    child.on('error', () => {});
    child.unref();
    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);"""
if old not in s:
    raise SystemExit("lsLaunch trecho nÃ£o encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
