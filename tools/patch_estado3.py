import io, os

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# limpa os XMLs de teste (não deixar algo que possa sobrescrever o Settings real)
for f in ("lossless-probe-settings.xml", "ls-baseline.xml", "ls-baseline-path.xml"):
    p = os.path.join(ROOT, "tools", f)
    if os.path.exists(p):
        os.remove(p)
        print("removido", f)

# ESTADO: seção do Lossless com o schema real
p = ROOT + r"\ESTADO.md"
s = io.open(p, encoding="utf-8").read()
start = s.find("## 8. INTEGRAÇÃO LOSSLESS (feita)")
end = s.find("## 9. COMANDOS")
new8 = """## 8. INTEGRAÇÃO LOSSLESS (validada no app real)

**Schema real (Lossless Scaling 3.2.2), confirmado abrindo o app:**
- Arquivo: `%LOCALAPPDATA%\\Lossless Scaling\\Settings.xml`, raiz `<Settings>`.
- As opções de scaling **não** ficam na raiz: ficam dentro de `<GameProfiles>` → `<Profile>` (o perfil "Padrão" é o que não tem `<Path>`).
- **O app crasha (ArgumentOutOfRange no MainWindow Loaded) se não houver nenhum perfil** — por isso o VL sempre garante um `<Profile>` no GameProfiles.
- **O app crasha se for aberto por CreateProcess** (spawn). Abrir por shell (ShellExecute / `shell.openPath` / `cmd start`) funciona. O `lsLaunch` usa `shell.openPath`.
- Enums exatos (case-sensitive): `FrameGeneration` = Off/LSFG3/LSFG2/LSFG1/LSFI/LSFI1 · `ScalingType` = Off/LS1/FSR/NIS/SGSR/BicubicCAS/Anime4K/XBR/SharpBilinear/Integer/Nearest · `FSRType` = ORIGINAL/OPTIMIZED · `LSFG3Mode1` = FIXED/ADAPTIVE · `LSFGSize` = BALANCED/PERFORMANCE · `SyncMode` = OFF/DEFAULT/VSYNC1..4 · `CaptureApi` = DXGI/WGC/GDI · `ScalingMode` = Auto/Custom · `ScalingFitMode` = AspectRatio/Fullscreen · `LSFG2Mode` = X2/X3/X4 · `Anime4kType` = S/M/L/VL/UL · `LS1Type` = BALANCED/PERFORMANCE.
- Um literal inválido faz o app descartar TODAS as opções (volta ao padrão e reescreve o arquivo) — por isso os literais são fixos no código.
- O app lê o arquivo no start e **não reescreve** quando aceita (mtime não muda).
- Fluxo do VL: `ls-config` lê o perfil Padrão; `ls-config(cfg)` grava 24 campos com backup em `%APPDATA%\\VL\\data\\lossless-settings.backup.xml`; `ls-launch` grava, mata instância antiga (espera sair), abre por `shell.openPath` e confere 9 s depois se o engine aceitou.
- Teste feito: janela do Lossless aberta mostrando LSFG 3.1, Adaptativo, Alvo 120, Desempenho, NIS, DXGI, fila 1, Vsync ½, latência 1 — exatamente o que o VL gravou.

"""
s = s[:start] + new8 + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
