import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()

# 1) brilho volta ao pulso de 5 s
s = s.replace("animation: gyPulse 9s ease-in-out infinite alternate;", "animation: gyPulse 5s ease-in-out infinite alternate;")

# 2) .gy-tilt sem will-change (como era)
s = s.replace("  position: absolute; left: 0; top: 0; width: 260px; height: 260px; transform-style: preserve-3d; will-change: transform;",
              "  position: absolute; left: 0; top: 0; width: 260px; height: 260px; transform-style: preserve-3d;")

# 3) cardã estático (como era)
s = s.replace(".gy-gimbal { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-18deg) rotateZ(22deg); will-change: transform; }",
              ".gy-gimbal { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-18deg) rotateZ(22deg); }")

# 4) gradiente original dos aros
s = s.replace("  background: conic-gradient(from var(--from), var(--c2) 0deg, var(--c1) 22deg, var(--c1) 306deg, var(--c2) 336deg, var(--gy-a2) 352deg, var(--c2) 360deg);",
              "  background: conic-gradient(from var(--from), var(--c1), var(--c2) 22%, var(--c1) 50%, var(--c2) 72%, var(--c1));")

# 5) aros: volta ao giro original em 18/12/8 s; só o de dentro muda de tamanho
s = s.replace(".gy-r1 { --d: 186px; --w: 4px; --c1: var(--gy-a); --c2: var(--gy-a2); --from: 20deg; animation: gyOrbit 18s linear -6s infinite; }",
              ".gy-r1 { --d: 164px; --w: 7px; --c1: var(--gy-a); --c2: var(--gy-a2); --from: 20deg; animation: gySpinY 18s linear -4s infinite; }")
s = s.replace(".gy-r2 { --d: 142px; --w: 3.5px; --c1: var(--gy-b2); --c2: var(--gy-b); --from: 110deg; animation: gyOrbit 9s linear -3s infinite reverse; }",
              ".gy-r2 { --d: 128px; --w: 6px; --c1: var(--gy-b2); --c2: var(--gy-b); --from: 110deg; animation: gySpinX 12s linear -2.4s infinite; }")
# aro de dentro: 112 px para ficar FORA da bola de 100 px (antes 94 px ficava por dentro e sumia)
s = s.replace(".gy-r3 { --d: 102px; --w: 3px; --c1: var(--gy-c); --c2: var(--gy-c2); --from: 200deg; animation: gyOrbit 6s linear -2s infinite; }",
              ".gy-r3 { --d: 112px; --w: 5px; --c1: var(--gy-c); --c2: var(--gy-c2); --from: 200deg; animation: gySpinY 8s linear -1.2s infinite reverse; }")

# 6) miolo volta ao giro original (o tamanho 100 px é definido mais abaixo)
s = s.replace(".gy-core { position: absolute; left: 50%; top: 50%; width: 62px; height: 62px; margin: -31px 0 0 -31px; transform-style: preserve-3d; will-change: transform; animation: gyCoreBreath 9s ease-in-out infinite; }",
              ".gy-core { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; transform-style: preserve-3d; will-change: transform; animation: gyRock 7s ease-in-out infinite alternate; }")
s = s.replace(".gy-core > * { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 17px; }",
              ".gy-core > * { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }")
s = s.replace(".gy-core img { inset: auto; left: 9%; top: 9%; width: 82%; height: 82%; transform: translateZ(2.5px); display: block; border-radius: 11px; -webkit-user-drag: none; }",
              ".gy-core img { transform: translateZ(2.5px); display: block; -webkit-user-drag: none; }")

# 7) keyframes originais
old_kf = """@keyframes gyOrbit { from { transform: rotateZ(0deg); } to { transform: rotateZ(360deg); } }
@keyframes gyCoreBreath {
  0%, 100% { transform: rotateY(-9deg) scale(1); }
  50% { transform: rotateY(9deg) scale(1.035); }
}
@keyframes gyPulse { from { opacity: 0.6; transform: scale(0.95); } to { opacity: 1; transform: scale(1.05); } }"""
new_kf = """@keyframes gySpinY { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
@keyframes gySpinX { from { transform: rotateX(0deg); } to { transform: rotateX(360deg); } }
@keyframes gyRock { from { transform: rotateY(-30deg) rotateX(10deg); } to { transform: rotateY(30deg) rotateX(-8deg); } }
@keyframes gyPulse { from { opacity: 0.65; transform: scale(0.94); } to { opacity: 1; transform: scale(1.06); } }"""
if old_kf not in s:
    raise SystemExit("keyframes atuais nÃ£o encontrados")
s = s.replace(old_kf, new_kf)

# 8) estado "done" volta a ter o balanço calmo
s = s.replace("""[data-theme="light"] .gy-done { --gy-a: #e0101f; --gy-a2: #ff5560; --gy-b: #e0101f; --gy-b2: #ff9aa2; --gy-c: #e0101f; --gy-c2: #ff5560; --gy-glow: rgba(224,16,31,0.34); }""",
""" [data-theme="light"] .gy-done { --gy-a: #e0101f; --gy-a2: #ff5560; --gy-b: #e0101f; --gy-b2: #ff9aa2; --gy-c: #e0101f; --gy-c2: #ff5560; --gy-glow: rgba(224,16,31,0.34); }
.gy-done .gy-gimbal { animation: gyCalm 11s ease-in-out infinite; }
@keyframes gyCalm {
  0%, 100% { transform: rotateX(-18deg) rotateZ(22deg); }
  30% { transform: rotateX(-34deg) rotateY(26deg) rotateZ(22deg); }
  68% { transform: rotateX(-6deg) rotateY(-30deg) rotateZ(22deg); }
}""")

# 9) poses paradas originais
s = s.replace('[data-fx="off"] .gy:not(.gy-done) .gy-r1 { transform: rotateZ(18deg); }', '[data-fx="off"] .gy:not(.gy-done) .gy-r1 { transform: rotateY(38deg); }')
s = s.replace('[data-fx="off"] .gy:not(.gy-done) .gy-r2 { transform: rotateZ(-42deg); }', '[data-fx="off"] .gy:not(.gy-done) .gy-r2 { transform: rotateX(62deg); }')
s = s.replace('[data-fx="off"] .gy:not(.gy-done) .gy-r3 { transform: rotateZ(96deg); }', '[data-fx="off"] .gy:not(.gy-done) .gy-r3 { transform: rotateY(-48deg); }')
s = s.replace("[data-fx=\"off\"] .gy-core { transform: rotateY(-9deg) scale(1); }\n", "")
s = s.replace(".gy:not(.gy-done) .gy-r1 { transform: rotateY(38deg); }\n  .gy:not(.gy-done) .gy-r2 { transform: rotateX(62deg); }\n  .gy:not(.gy-done) .gy-r3 { transform: rotateY(-48deg); }\n  .gy-core { transform: rotateY(-9deg) scale(1); }",
              ".gy:not(.gy-done) .gy-r1 { transform: rotateY(38deg); }\n  .gy:not(.gy-done) .gy-r2 { transform: rotateX(62deg); }\n  .gy:not(.gy-done) .gy-r3 { transform: rotateY(-48deg); }\n  .gy-core { transform: rotateY(-18deg) rotateX(6deg); }")

io.open(p, "w", encoding="utf-8").write(s)
print("revertido")
