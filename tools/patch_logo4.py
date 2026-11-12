import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()
start = s.find("/* ── Logo VL em destaque")
new = """/* ── Logo VL em destaque no centro do giroscópio ── */
.gy-core { width: 100px; height: 100px; margin: -50px 0 0 -50px; }
.gy-core > * { border-radius: 50%; }
.gy-core i:nth-child(1) {
  transform: translateZ(-12px);
  background: radial-gradient(circle at 50% 36%, #2b0b10 0%, #100608 58%, #030203 100%);
  box-shadow: 0 0 24px rgba(255, 31, 46, 0.40), 0 0 58px rgba(255, 31, 46, 0.16), inset 0 0 16px rgba(255, 31, 46, 0.18);
  border: 1px solid rgba(255, 85, 96, 0.22);
}
.gy-core i:nth-child(2) { transform: translateZ(-6px); background: #4a0409; }
.gy-core i:nth-child(3) { background: #120305; }
.gy-core img {
  transform: translateZ(40px) scale(1.12);
  filter: drop-shadow(0 0 9px rgba(255, 31, 46, 0.85)) drop-shadow(0 4px 12px rgba(0, 0, 0, 0.55));
}
[data-fx="off"] .gy-core { transform: rotateY(-18deg) rotateX(6deg); }
[data-theme="light"] .gy-core i:nth-child(1) {
  background: radial-gradient(circle at 50% 36%, #ffffff 0%, #ffe6e8 58%, #ffd4d8 100%);
  box-shadow: 0 0 24px rgba(224, 16, 31, 0.30), inset 0 0 14px rgba(224, 16, 31, 0.14);
  border-color: rgba(224, 16, 31, 0.22);
}
[data-theme="light"] .gy-core i:nth-child(2) { background: #ffd4d8; }
[data-theme="light"] .gy-core i:nth-child(3) { background: #fff2f3; }
"""
io.open(p, "w", encoding="utf-8").write(s[:start] + new)
print("ok")
