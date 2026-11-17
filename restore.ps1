# ══════════════════════════════════════════════════════════════════════════
# restore.ps1 — o "desfazer" dos 8 tipos de item da foto.
#
# Fonte: RESTORE_PS do GDZ Optimizer (C:\VLTemp\TIME\t8-templates.md, linha 81),
# conferido em C:\VLTemp\TIME\t1-backup.md (t1-backup.md, seção restoreItems).
# Este arquivo é o RESTORE_PS LITERAL do GDZ, com três adaptações de encanamento
# (todas marcadas com "VL:"), nenhuma de comportamento:
#
#   VL 1. O dado não vem por __DATA__ substituído pelo Node: quem chama injeta
#         uma linha de cabeçalho que define $itens (ver restaurar-sistema.js).
#         Assim este arquivo é PowerShell válido sozinho e o parser confere.
#   VL 2. O bloco DRS_PS (NVAPI) entra por concatenação do Node, igual ao
#         withDrs() do GDZ — só quando existe item 'drs'. Não mora aqui.
#   VL 3. A saída é a mesma do GDZ ("GDZ_ERRO: ..."), porque é o que o desfazer
#         reconhece. O ps() do VL tira "VL_ERRO:" da saída; "GDZ_ERRO:" não
#         colide com nada e passa direto para o Node ler.
#
# Regras do GDZ que foram copiadas de propósito:
#   - um item que falha NÃO aborta a restauração: vai para $fail e só no fim
#     sai um único "GDZ_ERRO:" listando o que falhou (restauração parcial).
#   - o plano de energia é reativado no fim, porque /setacvalueindex só vale
#     depois de /setactive.
#   - DWord acima de 2147483647 vira int32 assinado; Binary vem em base64
#     aninhado; MultiString vira [string[]].
#
# Não chame este arquivo direto com "$spec": quem monta $itens é o
# restaurar-sistema.js. Sem a linha do cabeçalho, $itens é $null e o script
# termina sem fazer nada (o foreach de @($items) não roda).
# ══════════════════════════════════════════════════════════════════════════
$ProgressPreference = 'SilentlyContinue'

$fail = @()
foreach ($i in @($itens)) {
  if (-not $i) { continue }
  try {
    if ($i.t -eq 'reg') {
      if ($i.exists) {
        if (-not (Test-Path -LiteralPath $i.path)) { New-Item -Path $i.path -Force -ErrorAction Stop | Out-Null }
        if ($i.kind -eq 'Binary') { $v = [byte[]][Convert]::FromBase64String($i.value) }
        elseif ($i.kind -eq 'DWord') { $n = [int64]$i.value; if ($n -gt 2147483647) { $n -= 4294967296 }; $v = [int]$n }
        elseif ($i.kind -eq 'QWord') { $v = [int64]$i.value }
        elseif ($i.kind -eq 'MultiString') { $v = [string[]]@($i.value) }
        else { $v = [string]$i.value }
        Set-ItemProperty -LiteralPath $i.path -Name $i.name -Value $v -Type $i.kind -Force -ErrorAction Stop
      } else {
        Remove-ItemProperty -LiteralPath $i.path -Name $i.name -ErrorAction SilentlyContinue
      }
    }
    elseif ($i.t -eq 'svc') {
      # 'Auto'/'Manual'/'Disabled' é o vocabulário do Win32_Service.StartMode, que é
      # o que o snapshot.ps1 grava. sc.exe quer auto|demand|disabled|delayed-auto.
      $m = if ($i.mode -eq 'Auto') { if ($i.delayed) { 'delayed-auto' } else { 'auto' } } elseif ($i.mode -eq 'Manual') { 'demand' } else { 'disabled' }
      sc.exe config $i.name start= $m | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'sc' }
      if ($i.running) { Start-Service -Name $i.name -ErrorAction SilentlyContinue }
    }
    elseif ($i.t -eq 'scheme') { powercfg /setactive $i.value | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'powercfg' } }
    elseif ($i.t -eq 'pwr') { powercfg /setacvalueindex $i.scheme $i.sub $i.set $i.ac | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'powercfg' } }
    elseif ($i.t -eq 'bcd') {
      # O "{current}" vai entre apas simples: sem elas o PowerShell expande e o
      # bcdedit recebe lixo (medido nesta máquina; ver snapshot.ps1).
      if ($i.exists) { bcdedit /set '{current}' $i.el $i.value | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'bcdedit' } }
      else { bcdedit /deletevalue '{current}' $i.el 2>$null | Out-Null }
    }
    elseif ($i.t -eq 'tcp') {
      # Igual ao GDZ. A configuração vem pelo netsh porque é o que o
      # Set-NetTCPSetting do snapshot (AutoTuningLevelLocal/ScalingHeuristics)
      # aceita de volta sem tradução de valor.
      $v = $i.value.ToLower()
      if ($i.k -eq 'autotuning' -and $v -in @('normal','highlyrestricted','restricted','disabled','experimental')) { netsh int tcp set global "autotuninglevel=$v" | Out-Null }
      elseif ($i.k -eq 'rss' -and $v -in @('enabled','disabled')) { netsh int tcp set global "rss=$v" | Out-Null }
      elseif ($i.k -eq 'heuristics' -and $v -in @('enabled','disabled')) { netsh int tcp set heuristics $v | Out-Null }
    }
    elseif ($i.t -eq 'dns') {
      $a = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { [string]$_.InterfaceGuid -eq $i.guid } | Select-Object -First 1
      if ($a) {
        $list = @($i.ns -split '[,\s]+' | Where-Object { $_ })
        if ($list.Count) { Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $list -ErrorAction Stop }
        else { Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction Stop }
      }
    }
    elseif ($i.t -eq 'drs') {
      # GdzDrsInit vem do DRS_PS, que o Node concatena na frente só quando há item
      # 'drs'. Sem ele a função não existe e o catch registra o item como falho —
      # mesmo efeito do "throw 'nvapi'" do GDZ.
      if (-not (Get-Command GdzDrsInit -CommandType Function -ErrorAction SilentlyContinue)) { throw 'nvapi' }
      if (-not (GdzDrsInit)) { throw 'nvapi' }
      if ($i.exists) { [GDZ.Drs]::Set([uint32]$i.id, [uint32]$i.value) } else { [GDZ.Drs]::Del([uint32]$i.id) }
    }
  } catch { $fail += "$($i.t) $($i.name)$($i.el)$($i.k)$($i.id)" }
}
# /setacvalueindex só vale depois de reativar o plano.
$g = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value
if ($g) { powercfg /setactive $g | Out-Null }
if ($fail.Count) { Write-Output "GDZ_ERRO: não foi possível restaurar: $($fail -join ', ')" }
