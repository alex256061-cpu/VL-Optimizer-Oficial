import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine.js"
s = io.open(p, encoding="utf-8").read()

old_get = """    $ifs = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 })
    if ($ifs.Count -eq 0) { Write-Output 'auto'; exit }"""
new_get = """    $act = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    $ifs = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 -and ($act.Count -eq 0 -or $act -contains $_.InterfaceIndex) })
    if ($ifs.Count -eq 0) { Write-Output 'auto'; exit }"""
if old_get not in s:
    raise SystemExit("getDns nÃ£o encontrado")
s = s.replace(old_get, new_get)

old_auto = """    const r = await ps(`Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue }; Write-Output 'ok'`);"""
new_auto = """    const r = await ps(`
      $idx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
      if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
      foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ResetServerAddresses -ErrorAction SilentlyContinue }
      Write-Output 'ok'`);"""
if old_auto not in s:
    raise SystemExit("auto nÃ£o encontrado")
s = s.replace(old_auto, new_auto)

old_set = """  const r = await ps(`Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceIndex } | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ServerAddresses ${list} -ErrorAction SilentlyContinue }; Write-Output 'ok'`);"""
new_set = """  const r = await ps(`
    $idx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
    foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ServerAddresses ${list} -ErrorAction SilentlyContinue }
    Write-Output 'ok'`);"""
if old_set not in s:
    raise SystemExit("set nÃ£o encontrado")
s = s.replace(old_set, new_set)
io.open(p, "w", encoding="utf-8").write(s)
print("dns ok")
