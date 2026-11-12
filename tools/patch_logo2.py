import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()
start = s.find("/* ── Logo VL em destaque")
if start < 0:
    raise SystemExit("bloco não encontrado")
new = """/* ── Logo VL em destaque no centro do giroscópio (sobrescreve o tamanho original) ── */
.gy-core { width: 100px; height: 100px; margin: -50px 0 0 -50px; }
.gy-core > * { border-radius: 50%; }
.gy-core i:nth-child(1) {
  transform: translateZ(-12px);
  background: radial-gradient(circle at 50% 34%, #33090e 0%, #140508 55%, #020203 100%);
  box-shadow: 0 0 38px rgba(255, 31, 46, 0.6), 0 0 92px rgba(255, 31, 46, 0.28), inset 0 0 22px rgba(255, 31, 46, 0.35);
  border: 1px solid rgba(255, 85, 96, 0.35);
}
.gy-core i:nth-child(2) { transform: translateZ(-6px); background: #7a0710; }
.gy-core i:nth-child(3) { background: #1c0609; }
.gy-core img {
  transform: translateZ(26px) scale(1.16);
  filter: drop-shadow(0 0 12px rgba(255, 31, 46, 0.9)) drop-shadow(0 6px 16px rgba(0, 0, 0, 0.65));
}
[data-fx="off"] .gy-core { transform: rotateY(-18deg) rotateX(6deg); }
[data-theme="light"] .gy-core i:nth-child(1) {
  background: radial-gradient(circle at 50% 34%, #ffffff 0%, #ffe6e8 55%, #ffd4d8 100%);
  box-shadow: 0 0 34px rgba(224, 16, 31, 0.45), inset 0 0 18px rgba(224, 16, 31, 0.2);
}
[data-theme="light"] .gy-core i:nth-child(2) { background: #ffd4d8; }
[data-theme="light"] .gy-core i:nth-child(3) { background: #fff2f3; }
"""
io.open(p, "w", encoding="utf-8").write(s[:start] + new)
print("ok")
