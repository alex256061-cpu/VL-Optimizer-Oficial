import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\ESTADO.md"
raw = open(p, "rb").read()
try: s = raw.decode("utf-8")
except UnicodeDecodeError: s = raw.decode("cp1252")

s = s.replace(
    '- [ ] **7/7 — Validar OptiScaler e FiveM** (quando houver jogo/FiveM).',
    '- [x] **7/7 — OptiScaler validado (instalação/remoção)**; FiveM **não instalado** neste PC, então o painel GTA RP ficou sem validação real. Teste feito: download do release 0.9.4 (.7z, 55 MB), extração com 7zr, cópia de 18 arquivos para uma pasta sandbox, `OptiScaler.dll` → `dxgi.dll` com backup do original, INI real patcheado (Dx12Upscaler=fsr31, Enabled=true, Dxgi=false) e remoção restaurando o `dxgi.dll` original. COD detectado e **bloqueado** (anti-cheat cod/call of duty) — não instalamos em jogo online.',
)

changelog = """## CHANGELOG — 2026-11-11 (9ª rodada — etapa 7)

- **OptiScaler reescrito para o release atual**: o código antigo procurava `.zip` e baixava sem seguir redirect — nunca funcionaria (o release 0.9.4 é `.7z` de 55 MB). Agora: API → asset `.7z/.zip` → download com redirect → extração (7zr baixado de 7-zip.org, ou Expand-Archive para zip).
- **Instalação igual ao setup oficial**: copia todos os arquivos do pacote para a pasta do jogo (menos `setup_*.bat/sh` e README), renomeia `OptiScaler.dll` para o proxy escolhido (`dxgi.dll` padrão; winmm/version/dbghelp/d3d12/wininet/winhttp), faz backup de qualquer arquivo sobrescrito (`.lopt-backup`) e registra tudo para remover.
- **INI real**: usa o `OptiScaler.ini` do pacote e só altera chaves documentadas (`Dx12Upscaler`, `[FrameGen] Enabled`, `Dxgi`).
- **Anti-cheat**: lista ampliada (cod/call of duty/warzone/fivem/valorant/cs2/fortnite/apex/rust/pubg/tarkov/overwatch/the finals/xdefiant/bf2042). O `opti-install` recusa sem confirmação explícita e a UI já mostra "jogo online com anti-cheat".
- **Sandbox de teste**: pasta com `game.exe` falso e `dxgi.dll` original → instalou 18 arquivos + backup, removeu e restaurou o `dxgi.dll` byte a byte.

"""
head_end = s.find("---\n\n## 0.")
s = s[:head_end] + changelog + s[head_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("estado ok")
