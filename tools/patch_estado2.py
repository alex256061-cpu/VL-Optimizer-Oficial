import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
s = io.open(p, encoding="utf-8").read()

# 1) changelog novo logo após o cabeçalho
head_end = s.find("---\n\n## 0.")
changelog = """---

## CHANGELOG — 2026-11-11 (2ª rodada)

- **Lossless Scaling integrado** (usuário comprou; caminho: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe`).
  - `ls-find-exe` detecta Steam (registro + libraryfolders.vdf + caminhos comuns) e grava em `scaling.json`.
  - `ls-config` (sem args) lê `%LOCALAPPDATA%\\Lossless Scaling\\Settings.xml` e devolve `current`, `recommended`, `configured`.
  - `ls-config` (com cfg) grava 21 campos no Settings.xml (FrameGeneration, LSFG3Mode1/Multiplier/Target/FlowScale/Size,
    CaptureApi, QueueTarget, ScalingType, FSRType, Sharpness, ScalingMode, ScaleFactor, SyncMode, HdrSupport,
    ResizeBeforeScaling, ScaleCursor, VRS, AutoScale/Delay, WindowedMode, StartAsAdmin) com backup em `lossless-settings.backup.xml`.
  - `ls-launch` grava as opções, fecha instância antiga e abre `LosslessScaling.exe -StartMinimized`; confere 8 s depois se
    o engine aceitou o arquivo (flag `settingsRejected` em `scaling.json`, avisada no próximo clique).
  - Schemas confirmados no binário (3.2.1): tipo `Settings`, `Settings.xml`, `-StartMinimized`, enums
    `LSFG3/LSFG2/LSFG1/OFF`, `ADAPTIVE/FIXED`, `DXGI/WGC`, `VSYNC1..4`, `DEFAULT`, `PERFORMANCE`, `ANIME4K`, `INTEGER`.
    `LSFG2Mode` e `ScalingFitMode` **não** são gravados (literais não confirmados) — o resto sim.
- **Gargalo corrigido**: `measure-bottleneck` agora devolve `cpu`, `coreMax`, `gpu`, `ram`, `ramGb`, `game`, `seconds`,
  `samples`, `verdict`, `dica` (era `meters.*`) — a tela de resultado renderiza.
- **GPU dedicada corrigida**: `gamesScan` resolve o `.exe` de cada jogo (`findGameExe`, prefere nome da pasta e ignora
  launcher/unins/setup) e `gpuDedicated` grava o caminho do executável no `UserGpuPreferences`.
- **Slots de RAM corrigidos**: usa `Win32_PhysicalMemoryArray.MemoryDevices` (mostrava threads como slots).
- **Hibernação**: probe agora lê `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\HibernateEnabled`.
- **Meus jogos**: filtra apps que não são jogos (Steamworks, SteamVR, Lossless, etc.).
- Textos da aba VL Scaling atualizados para "Lossless Scaling / Motor detectado".

"""
s = s[:head_end] + changelog + s[head_end:]

# 2) tabela de pendências: marca 1,2,3,5 como feitos
s = s.replace("| 1 | Gargalo: shape do retorno | tela mostra CPU/núcleo/GPU/RAM e veredito com números reais |",
              "| 1 | ✅ Gargalo: shape do retorno | tela mostra CPU/núcleo/GPU/RAM e veredito com números reais |")
s = s.replace("| 2 | GPU dedicada por exe | `UserGpuPreferences` recebe `<pasta>\\jogo.exe` e o slider \"Desfazer\" remove |",
              "| 2 | ✅ GPU dedicada por exe | `UserGpuPreferences` recebe o `jogo.exe` resolvido (fallback: erro claro se não achar) |")
s = s.replace("| 3 | Slots de RAM | PC Info mostra \"2 de 4 slots\" |",
              "| 3 | ✅ Slots de RAM | PC Info mostra \"2 de 4 slots\" |")
s = s.replace("| 5 | Hibernação status | ligar/desligar reflete corretamente no switch |",
              "| 5 | ✅ Hibernação status | lê `HibernateEnabled` (testar visualmente ligando/desligando) |")
s = s.replace("| 4 | UAC testado | aceitar → app reabre admin; cancelar → faixa com botão funcional |",
              "| 4 | UAC testado | aceitar → app reabre admin; cancelar → faixa com botão (falta validar na prática) |")

# 3) seção 8: Lossless agora integrado
old8 = s[s.find("## 8. INTEGRAÇÃO LOSSLESS"):s.find("## 9. COMANDOS")]
new8 = """## 8. INTEGRAÇÃO LOSSLESS (feita)

- Caminho detectado: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe`.
- Config: `%LOCALAPPDATA%\\Lossless Scaling\\Settings.xml` (tipo `Settings`, XmlSerializer).
- Backup: `%APPDATA%\\VL\\data\\lossless-settings.backup.xml`; `scaling.json` guarda engine + última config + flag `settingsRejected`.
- Fluxo: usuário clica **Iniciar** → VL grava o Settings.xml → mata instância antiga → abre `LosslessScaling.exe -StartMinimized`
  → 8 s depois relê o arquivo; se o engine tiver reescrito, marca rejeição e avisa no próximo clique.
- Limitação conhecida: `LSFG2Mode` e `ScalingFitMode` não são gravados (literais de enum não confirmados no binário).
- Não redistribuir o binário: usa a instalação/licença Steam do usuário.

"""
s = s.replace(old8, new8)
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
