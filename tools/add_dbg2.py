import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
if "dbgUc" not in s:
    s = s.replace("    $micro = $null\n", "    $micro = $null\n    $dbgUc = 0; if ($uc) { $dbgUc = @($uc).Count }\n", 1)
    s = s.replace("      $mon = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)",
                  "      $mon = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)\n      $dbgMon = $mon.Count", 1)
    s = s.replace("      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o'); mk=$mk",
                  "      bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o'); mk=$mk; dbgUc=$dbgUc; dbgMon=$dbgMon; dbgMicro=[string]$micro", 1)
    io.open(p, "w", encoding="utf-8").write(s)
print("ok", "dbgUc" in s)
