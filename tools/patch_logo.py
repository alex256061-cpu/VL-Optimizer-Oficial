import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\giroscopio.css"
s = io.open(p, encoding="utf-8").read()
add = """

/* ── Logo VL em destaque no centro do giroscópio (sobrescreve o tamanho original) ── */
.gy-core { width: 96px; height: 96px; margin: -48px 0 0 -48px; }
.gy-core > * { border-radius: 50%; }
.gy-core i:nth-child(1) {
  transform: translateZ(-12px);
  background: radial-gradient(circle at 50% 38%, #ff3b46 0%, #b3101c 55%, #2a0509 100%);
  box-shadow: 0 0 46px rgba(255, 31, 46, 0.85), 0 0 96px rgba(255, 31, 46, 0.35), inset 0 0 24px rgba(0, 0, 0, 0.45);
}
.gy-core i:nth-child(2) { transform: translateZ(-6px); background: #b3101c; }
.gy-core i:nth-child(3) { background: #e01322; }
.gy-core img {
  transform: translateZ(26px) scale(1.12);
  filter: drop-shadow(0 0 16px rgba(255, 31, 46, 0.95)) drop-shadow(0 8px 20px rgba(0, 0, 0, 0.6));
}
[data-fx="off"] .gy-core { transform: rotateY(-18deg) rotateX(6deg); }
[data-theme="light"] .gy-core i:nth-child(1) {
  background: radial-gradient(circle at 50% 38%, #ff5b64 0%, #e0101f 55%, #7a0710 100%);
  box-shadow: 0 0 40px rgba(224, 16, 31, 0.55), 0 0 80px rgba(224, 16, 31, 0.25);
}
"""
io.open(p, "w", encoding="utf-8").write(s + add)
print("ok")
