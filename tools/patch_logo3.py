import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()
start = s.find("/* ── Logo VL em destaque")
new = """/* ── Logo VL em destaque no centro do giroscópio ── */
.gy-core { width: 112px; height: 112px; margin: -56px 0 0 -56px; }
.gy-core > * { border-radius: 50%; }
.gy-core i:nth-child(1) {
  transform: translateZ(-12px);
  background: radial-gradient(circle at 50% 32%, #171114 0%, #0a0709 55%, #010101 100%);
  box-shadow: 0 0 22px rgba(255, 31, 46, 0.35), 0 0 54px rgba(255, 31, 46, 0.14), inset 0 0 14px rgba(255, 31, 46, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.gy-core i:nth-child(2) { transform: translateZ(-6px); background: #4a0409; }
.gy-core i:nth-child(3) { background: #120305; }
.gy-core img {
  transform: translateZ(70px) scale(1.3);
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5)) drop-shadow(0 0 14px rgba(255, 31, 46, 0.95));
}
[data-fx="off"] .gy-core { transform: rotateY(-18deg) rotateX(6deg); }
[data-theme="light"] .gy-core i:nth-child(1) {
  background: radial-gradient(circle at 50% 34%, #ffffff 0%, #ffe6e8 55%, #ffd4d8 100%);
  box-shadow: 0 0 26px rgba(224, 16, 31, 0.3), inset 0 0 14px rgba(224, 16, 31, 0.14);
  border-color: rgba(224, 16, 31, 0.25);
}
[data-theme="light"] .gy-core i:nth-child(2) { background: #ffd4d8; }
[data-theme="light"] .gy-core i:nth-child(3) { background: #fff2f3; }
"""
io.open(p, "w", encoding="utf-8").write(s[:start] + new)
print("ok")
