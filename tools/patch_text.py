import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()

pairs = [
    ("VL Scaling Engine</div>\n            <div style=\"font-size:11.5px;color:var(--text3);margin-top:2px\">Motor de Frame Generation e Upscaling integrado — pronto para usar</div>",
     "Lossless Scaling</div>\n            <div style=\"font-size:11.5px;color:var(--text3);margin-top:2px\">Motor de Frame Generation e Upscaling da Steam. As opções abaixo são gravadas nele.</div>"),
    (">● Engine Integrada<", ">● Motor detectado<"),
    ("Painel completo de Frame Generation e Upscaling — tecnologia real de escalonamento.",
     "Frame Generation e Upscaling pelo Lossless Scaling instalado no seu PC."),
]
for a, b in pairs:
    if a in s:
        s = s.replace(a, b)
    else:
        print("não achei:", a[:60])

# Deixa claro no botão quando é a primeira vez
s = s.replace("VL Scaling pronto. Clique para iniciar e pressione Ctrl+Alt+S no jogo.",
              "Pronto. Clique em iniciar para abrir o Lossless com estas opções (Ctrl+Alt+S ativa no jogo).")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
