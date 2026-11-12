import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

i = s.find("ex.pcinfoGet = async () => {")
j = s.find("core.ps(`", i)
if i < 0 or j < 0:
    raise SystemExit("pcinfoGet nÃ£o encontrado")
if "core.ps(String.raw`" not in s[j:j+40]:
    s = s[:j] + "core.ps(String.raw`" + s[j + len("core.ps(`"):]

# remove os campos de depuração
s = s.replace("    $mk = 'XYZ'\n", "")
s = s.replace("      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o'); mk=$mk; dbgUc=$dbgUc; dbgMon=$dbgMon; dbgMicro=[string]$micro",
              "      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')")
s = s.replace("    $dbgUc = 0; if ($uc) { $dbgUc = @($uc).Count }\n", "")
s = s.replace("      $dbgMon = $mon.Count\n", "")

io.open(p, "w", encoding="utf-8").write(s)
print("String.raw ok", "String.raw`" in s)
