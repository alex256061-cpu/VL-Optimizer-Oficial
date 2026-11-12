import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# esqueleto completo do Settings.xml (raiz) para primeira execução
anchor = "function lsWrite(cfg) {"
skel = r"""const LS_SKELETON = (profile) => '<?xml version="1.0" encoding="utf-8"?>\n<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
  '  <WindowMaximized>false</WindowMaximized>\n  <WindowHeight>650</WindowHeight>\n  <WindowWidth>1150</WindowWidth>\n  <ProfileListWidth>250</ProfileListWidth>\n' +
  '  <Hotkey>S</Hotkey>\n  <HotkeyModifierKeys>Alt Control</HotkeyModifierKeys>\n  <GpuPreference>0</GpuPreference>\n  <GpuPreferenceChangeCount>0</GpuPreferenceChangeCount>\n' +
  '  <SetupPhase>0</SetupPhase>\n  <StartAsAdmin>false</StartAsAdmin>\n  <StartAtWindowsStartup>false</StartAtWindowsStartup>\n  <MinimizeToTray>false</MinimizeToTray>\n' +
  '  <CloseToTray>false</CloseToTray>\n  <Language>System</Language>\n  <Theme>System</Theme>\n' +
  '  <FrameGenerationCollapsed>false</FrameGenerationCollapsed>\n  <CursorOptionsCollapsed>false</CursorOptionsCollapsed>\n  <RenderingOptionsCollapsed>false</RenderingOptionsCollapsed>\n' +
  '  <CaptureOptionsCollapsed>false</CaptureOptionsCollapsed>\n  <GpuDisplayOptionsCollapsed>false</GpuDisplayOptionsCollapsed>\n  <CropInputOptionsCollapsed>false</CropInputOptionsCollapsed>\n' +
  '  <BehaviorCollapsed>false</BehaviorCollapsed>\n  <LegacyOptionsCollapsed>false</LegacyOptionsCollapsed>\n' +
  '  <GameProfiles>\n    ' + profile + '\n  </GameProfiles>\n</Settings>\n';

"""
if anchor not in s:
    raise SystemExit("lsWrite nÃ£o encontrado")
s = s.replace(anchor, skel + anchor, 1)

# no lsWrite: primeira execução usa o esqueleto em vez de desistir
old = """  const parts = lsProfileParts(xml);
  if (!parts) return { success: false, error: 'Settings.xml sem <GameProfiles> — abra o Lossless uma vez.', applied: 0, skipped: [] };
  let block = parts.block || lsDefaultXml();"""
new = """  let firstRun = false;
  const parts = lsProfileParts(xml);
  if (!parts) {
    // arquivo existe mas sem GameProfiles: monta o esqueleto
    xml = LS_SKELETON(lsDefaultXml());
    firstRun = true;
  }
  const parts2 = lsProfileParts(xml);
  let block = parts2.block || lsDefaultXml();"""
if old not in s:
    raise SystemExit("trecho parts nÃ£o encontrado")
s = s.replace(old, new, 1)

# ajusta referências a parts.inner/has -> parts2 e devolve firstRun
s = s.replace("""  if (parts.has) {
    inner = parts.inner.replace(parts.block, block);
  } else {
    inner = parts.inner.trim() === '' ? '\\n    ' + block + '\\n  ' : parts.inner + '\\n    ' + block + '\\n  ';
  }
  let out = xml.replace(parts.inner, inner);""",
"""  if (parts2.has) {
    inner = parts2.inner.replace(parts2.block, block);
  } else {
    inner = parts2.inner.trim() === '' ? '\\n    ' + block + '\\n  ' : parts2.inner + '\\n    ' + block + '\\n  ';
  }
  let out = xml.replace(parts2.inner, inner);""")

s = s.replace("return { success: true, applied: applied.length, skipped, firstRun: false, file, settings: cur };",
              "return { success: true, applied: applied.length, skipped, firstRun, file, settings: cur };")

# e o caminho "sem arquivo" passa a usar o esqueleto também
old_nofile = """  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  if (!xml) return { success: false, needsFirstRun: true, error: 'Abra o Lossless Scaling uma vez (ele cria o Settings.xml) e tente de novo.', applied: 0, skipped: [] };
  try { fs.copyFileSync(file, lsBackupPath()); } catch (e) {}"""
new_nofile = """  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  if (!xml) xml = LS_SKELETON(lsDefaultXml());
  else { try { fs.copyFileSync(file, lsBackupPath()); } catch (e) {} }"""
if old_nofile not in s:
    raise SystemExit("trecho no-file nÃ£o encontrado")
s = s.replace(old_nofile, new_nofile, 1)

# lsLaunch: não precisa mais do desvio de primeira execução
s = s.replace("""  // Sem Settings.xml: abre uma vez para o app criar o perfil padrão (ele não sobe sem perfil).
  if (!fs.existsSync(lsSettingsPath())) {
    try { const { shell } = require('electron'); await shell.openPath(exePath); } catch (e) {}
    return { success: true, message: 'Primeira vez: o Lossless abriu para criar o perfil. Feche ele e clique Iniciar de novo.' };
  }

""", "")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
