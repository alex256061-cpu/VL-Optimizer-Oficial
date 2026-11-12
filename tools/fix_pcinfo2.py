import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# 1) RAM em bytes (o renderer divide por GiB)
old = "ram = @{ used=([math]::Round(($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory) / 1MB, 1)); total=([math]::Round($ram.TotalVisibleMemorySize / 1MB, 1)); cache=$null };"
new = "ram = @{ used=([int64]($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory) * 1024); total=([int64]$ram.TotalVisibleMemorySize * 1024); cache=$null };"
if old not in s:
    raise SystemExit("ram live nÃ£o encontrado")
s = s.replace(old, new, 1)

# 2) bootAt sem fração de segundo (Date do JS não entende 7 dígitos)
s = s.replace("bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')",
              "bootAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-ddTHH:mm:sszzz')")

# 3) instalado em: usa Win32_OperatingSystem
s = s.replace("installed=$(if ($cv.InstallDate) { $cv.InstallDate.ToString('yyyy-MM-dd') } else { '' })",
              "installed=$(if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { '' })")
s = s.replace("    $sys = Get-CimInstance Win32_ComputerSystem",
              "    $sys = Get-CimInstance Win32_ComputerSystem\n    $os = Get-CimInstance Win32_OperatingSystem")

# 4) VRAM real (qwMemorySize) quando AdapterRAM estoura em 4 GB
old_gpu = """    $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; vram=[int64]$_.AdapterRAM;"""
new_gpu = """    $vramQ = 0
    try {
      $cls = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\d{4}$' }
      foreach ($k in $cls) {
        $pp = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        $q = $pp.'HardwareInformation.qwMemorySize'
        if ($q) { $vramQ = [int64]$q; break }
      }
    } catch {}
    $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; vram=$(if ($_.AdapterRAM -gt 0 -and $_.AdapterRAM -lt 2147483648 -and $vramQ -gt 0) { $vramQ } else { [int64]$_.AdapterRAM });"""
if old_gpu not in s:
    raise SystemExit("gpus nÃ£o encontrado")
s = s.replace(old_gpu, new_gpu, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("pcinfo fixes ok")
