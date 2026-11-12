import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("; dbg = @{ micro = [string]$micro; monCount = @($monitors).Count; ucType = $(if ($uc) { $uc.GetType().Name } else { 'null' }) }", "; dbg = @{ uc = @($uc).Count; mon = @($monitors).Count }")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
