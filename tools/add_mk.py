import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
if "mk = 'XYZ'" not in s:
    s = s.replace("    $cpuKey = 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'",
                  "    $mk = 'XYZ'\n    $cpuKey = 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'", 1)
    s = s.replace("      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')",
                  "      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o'); mk=$mk", 1)
    io.open(p, "w", encoding="utf-8").write(s)
print("marker ok", "$mk" in s)
