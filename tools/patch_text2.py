import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()

subs = [
    ('<div style="font-size:12.5px;font-weight:800;color:var(--text)">VL Scaling Engine</div>',
     '<div style="font-size:12.5px;font-weight:800;color:var(--text)">Lossless Scaling</div>'),
    ('<div style="font-size:11px;color:var(--text3);margin-top:1px">Motor de Frame Generation e Upscaling integrado — pronto para usar</div>',
     '<div style="font-size:11px;color:var(--text3);margin-top:1px">Motor da Steam instalado no seu PC. As opções abaixo são gravadas nele.</div>'),
    ('<span style="font-size:11.5px;font-weight:700;color:#16a34a">Engine Integrada</span>',
     '<span style="font-size:11.5px;font-weight:700;color:#16a34a">Motor detectado</span>'),
    ("'Salva as configurações e abre o VL Scaling pronto para usar.'",
     "'Abre o Lossless Scaling com as opções abaixo.'"),
]
for a, b in subs:
    if a in s:
        s = s.replace(a, b)
    else:
        print("NAO ACHEI:", a[:70])

s = s.replace("VL Scaling pronto. Clique para iniciar e pressione Ctrl+Alt+S no jogo.",
              "Pronto. Clique em iniciar para abrir o Lossless com estas opções (Ctrl+Alt+S ativa no jogo).")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
