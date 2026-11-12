import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()

# 1) cardã com balanço lento e sincronizado (36 s = 2× o período base de 18 s)
s = s.replace(
    ".gy-gimbal { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-18deg) rotateZ(22deg); }",
    ".gy-gimbal { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-18deg) rotateZ(22deg); animation: gySway 36s ease-in-out infinite; }",
)

# 2) aros: giram no próprio plano (órbita visível), períodos 18/9/6 s (1×/2×/3×)
s = s.replace(
    ".gy-r1 { --d: 164px; --w: 7px; --c1: var(--gy-a); --c2: var(--gy-a2); --from: 20deg; animation: gySpinY 18s linear -4s infinite; }",
    ".gy-r1 { --d: 164px; --w: 7px; --c1: var(--gy-a); --c2: var(--gy-a2); --from: 20deg; animation: gyOrbit 18s linear -6s infinite; }",
)
s = s.replace(
    ".gy-r2 { --d: 128px; --w: 6px; --c1: var(--gy-b2); --c2: var(--gy-b); --from: 110deg; animation: gySpinX 12s linear -2.4s infinite; }",
    ".gy-r2 { --d: 128px; --w: 6px; --c1: var(--gy-b2); --c2: var(--gy-b); --from: 110deg; animation: gyOrbit 9s linear -3s infinite reverse; }",
)
s = s.replace(
    ".gy-r3 { --d: 94px; --w: 5px; --c1: var(--gy-c); --c2: var(--gy-c2); --from: 200deg; animation: gySpinY 8s linear -1.2s infinite reverse; }",
    ".gy-r3 { --d: 94px; --w: 5px; --c1: var(--gy-c); --c2: var(--gy-c2); --from: 200deg; animation: gyOrbit 6s linear -2s infinite; }",
)

# 3) gradiente com "cabeça" brilhante (dá direção à rotação, sem sumir de lado)
old_grad = """  background: conic-gradient(from var(--from), var(--c1), var(--c2) 22%, var(--c1) 50%, var(--c2) 72%, var(--c1));"""
new_grad = """  background: conic-gradient(from var(--from), var(--c2) 0deg, var(--c1) 28deg, var(--c1) 300deg, var(--c2) 336deg, #fff 356deg, var(--c2) 360deg);"""
if old_grad not in s:
    raise SystemExit("gradiente nÃ£o encontrado")
s = s.replace(old_grad, new_grad)

# 4) miolo: respiração suave (9 s = metade do período base), sem balanço brusco
s = s.replace(
    ".gy-core { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; transform-style: preserve-3d; will-change: transform; animation: gyRock 7s ease-in-out infinite alternate; }",
    ".gy-core { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; transform-style: preserve-3d; will-change: transform; animation: gyCoreBreath 9s ease-in-out infinite; }",
)

# 5) keyframes: órbita no plano, balanço do cardã, respiração; pulso do brilho em 9 s
old_kf = """@keyframes gySpinY { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
@keyframes gySpinX { from { transform: rotateX(0deg); } to { transform: rotateX(360deg); } }
@keyframes gyRock { from { transform: rotateY(-30deg) rotateX(10deg); } to { transform: rotateY(30deg) rotateX(-8deg); } }
@keyframes gyPulse { from { opacity: 0.65; transform: scale(0.94); } to { opacity: 1; transform: scale(1.06); } }"""
new_kf = """@keyframes gyOrbit { from { transform: rotateZ(0deg); } to { transform: rotateZ(360deg); } }
@keyframes gySway {
  0%, 100% { transform: rotateX(-18deg) rotateZ(22deg); }
  50% { transform: rotateX(-25deg) rotateZ(27deg); }
}
@keyframes gyCoreBreath {
  0%, 100% { transform: rotateY(-9deg) scale(1); }
  50% { transform: rotateY(9deg) scale(1.035); }
}
@keyframes gyPulse { from { opacity: 0.6; transform: scale(0.95); } to { opacity: 1; transform: scale(1.05); } }"""
if old_kf not in s:
    raise SystemExit("keyframes nÃ£o encontrados")
s = s.replace(old_kf, new_kf)

# 6) brilho pulsando em 9 s
s = s.replace("animation: gyPulse 5s ease-in-out infinite alternate;", "animation: gyPulse 9s ease-in-out infinite alternate;")

# 7) estado "equilibrado": cardã continua no mesmo balanço (sem animação concorrente)
s = s.replace(".gy-done .gy-gimbal { animation: gyCalm 11s ease-in-out infinite; }", "")
old_calm = """@keyframes gyCalm {
  0%, 100% { transform: rotateX(-18deg) rotateZ(22deg); }
  30% { transform: rotateX(-34deg) rotateY(26deg) rotateZ(22deg); }
  68% { transform: rotateX(-6deg) rotateY(-30deg) rotateZ(22deg); }
}"""
s = s.replace(old_calm, "")

# 8) poses paradas coerentes (sem giro de lado)
s = s.replace("[data-fx=\"off\"] .gy:not(.gy-done) .gy-r1 { transform: rotateY(38deg); }", "[data-fx=\"off\"] .gy:not(.gy-done) .gy-r1 { transform: rotateZ(18deg); }")
s = s.replace("[data-fx=\"off\"] .gy:not(.gy-done) .gy-r2 { transform: rotateX(62deg); }", "[data-fx=\"off\"] .gy:not(.gy-done) .gy-r2 { transform: rotateZ(-42deg); }")
s = s.replace("[data-fx=\"off\"] .gy:not(.gy-done) .gy-r3 { transform: rotateY(-48deg); }", "[data-fx=\"off\"] .gy:not(.gy-done) .gy-r3 { transform: rotateZ(96deg); }")
s = s.replace(".gy-core { transform: rotateY(-18deg) rotateX(6deg); }", ".gy-core { transform: rotateY(-9deg) scale(1); }")

# 9) largura de banda dos aros com o novo gradiente (mantém o miolo escuro visível)
io.open(p, "w", encoding="utf-8").write(s)
print("giroscópio ok")
