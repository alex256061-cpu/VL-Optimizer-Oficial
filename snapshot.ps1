$ProgressPreference = 'SilentlyContinue'
$out = New-Object System.Collections.ArrayList
$scheme = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value

foreach ($s in @($spec.reg)) {
  if (-not $s.path) { continue }
  $o = [ordered]@{ t = 'reg'; path = $s.path; name = $s.name; exists = $false }
  $k = Get-Item -LiteralPath $s.path -ErrorAction SilentlyContinue
  if ($k -and (@($k.GetValueNames()) -contains $s.name)) {
    $kind = $k.GetValueKind($s.name).ToString()
    $v = $k.GetValue($s.name, $null, 'DoNotExpandEnvironmentNames')
    if ($kind -eq 'Binary') { $v = [Convert]::ToBase64String([byte[]]$v) }
    elseif ($kind -eq 'QWord') { $v = [string]$v }
    elseif ($kind -eq 'MultiString') { $v = @($v) }
    elseif ($kind -eq 'DWord') { $v = [int]$v }
    else { $v = [string]$v }
    $o.exists = $true; $o.kind = $kind; $o.value = $v
  }
  [void]$out.Add($o)
}

foreach ($s in @($spec.svc)) {
  if (-not $s) { continue }
  $w = Get-CimInstance Win32_Service -Filter ("Name=" + [char]39 + $s + [char]39) -ErrorAction SilentlyContinue
  if ($w) { [void]$out.Add([ordered]@{ t = 'svc'; name = $s; mode = [string]$w.StartMode; delayed = [bool]$w.DelayedAutoStart; running = ($w.State -eq 'Running') }) }
}

if ($scheme) { [void]$out.Add([ordered]@{ t = 'scheme'; value = $scheme }) }

foreach ($p in @($spec.pwr)) {
  if (-not $p -or -not $scheme) { continue }
  $lines = @(powercfg /q $scheme $p.sub $p.set | Where-Object { $_.Trim() })
  if ($lines.Count -ge 2) {
    $ult = [string]$lines[-2]
    $m = [regex]::Match($ult, '0x([0-9a-fA-F]+)')
    if ($m.Success) {
      [void]$out.Add([ordered]@{ t = 'pwr'; sub = $p.sub; set = $p.set; scheme = $scheme; ac = [Convert]::ToInt64($m.Groups[1].Value, 16) })
    }
  }
}

# bcdedit precisa de administrador: sem ele o "{current}" é rejeitado com
# "O tipo de entrada especificado é inválido" e o exit code é 1. Chamamos UMA vez
# só, guardamos a saída, e usamos para todos os elementos pedidos.
#
# O "{current}" tem de ir entre apas simples: sem elas o PowerShell expande e o
# bcdedit recebe lixo (medido).
$bcdTexto = $null
if (@($spec.bcd).Count -gt 0) {
  try {
    $bcdTexto = (& bcdedit /enum '{current}' 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { $bcdTexto = $null }
  } catch { $bcdTexto = $null }
}
foreach ($b in @($spec.bcd)) {
  if (-not $b) { continue }
  if (-not $bcdTexto) { continue }   # sem admin ou bcdedit indisponível: não fotografa
  $padrao = "(?im)^" + [regex]::Escape([string]$b) + "\s+(\S+)"
  $m = [regex]::Match($bcdTexto, $padrao)
  $val = 'No'
  if ($m.Success -and $m.Groups[1].Value -match '^(yes|sim|true|on)$') { $val = 'Yes' }
  [void]$out.Add([ordered]@{ t = 'bcd'; el = $b; exists = $m.Success; value = $val })
}

foreach ($k in @($spec.tcp)) {
  if (-not $k) { continue }
  $v = $null
  if ($k -eq 'rss') { $v = [string](Get-NetOffloadGlobalSetting -ErrorAction SilentlyContinue).ReceiveSideScaling }
  else {
    $t = Get-NetTCPSetting -SettingName Internet -ErrorAction SilentlyContinue
    if ($t) {
      if ($k -eq 'autotuning') { $v = [string]$t.AutoTuningLevelLocal }
      else { $v = [string]$t.ScalingHeuristics }
    }
  }
  if ($v) { [void]$out.Add([ordered]@{ t = 'tcp'; k = $k; value = $v }) }
}

if ($spec.dns) {
  $base = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\'
  foreach ($a in @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })) {
    $ns = (Get-ItemProperty -LiteralPath ($base + $a.InterfaceGuid) -Name NameServer -ErrorAction SilentlyContinue).NameServer
    [void]$out.Add([ordered]@{ t = 'dns'; guid = [string]$a.InterfaceGuid; ns = [string]$ns })
  }
}

Write-Output (Json @($out))