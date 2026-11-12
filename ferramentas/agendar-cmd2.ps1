# Corrigir: o script nao grava log quando roda pela tarefa agendada.
#
# Motivo provavel: codigo -196608 = 0xFFFF0000, que o schtasks reporta quando o processo
# termina com a janela oculta e o PowerShell falha ao abrir o console. Nao e erro do script.
#
# Solucao: rodar o PowerShell via cmd.exe com saida redirecionada para um arquivo, para nao
# depender de console.

$ErrorActionPreference = 'Continue'
$nome = 'VLOptimizer-KeepSupabaseAlive'

# remover a antiga
& cmd.exe /c ('schtasks /Delete /TN "' + $nome + '" /F') 2>&1 | Out-Null

$script = Join-Path $PSScriptRoot 'manter-supabase-vivo.ps1'
$saida = 'C:\Users\lucas larado\AppData\Local\VLOptimizer\tarefa-saida.txt'

# cria a pasta
$pasta = Split-Path $saida -Parent
if (-not (Test-Path -LiteralPath $pasta)) { New-Item -ItemType Directory -Path $pasta -Force | Out-Null }

# comando: cmd /c powershell ... >> saida 2>&1
$cmd = 'cmd /c powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" >> "' + $saida + '" 2>&1'

$linha = 'schtasks /Create /TN "' + $nome + '" /TR "' + ($cmd -replace '"', '""') + '" /SC DAILY /ST 12:00 /F'

Write-Output "=== criando ==="
Write-Output $linha
$r = & cmd.exe /c $linha 2>&1 | Out-String
Write-Output $r

Write-Output "=== rodando agora para testar ==="
& cmd.exe /c ('schtasks /Run /TN "' + $nome + '"') 2>&1 | Out-Null
Start-Sleep -Seconds 12

Write-Output "=== saida do processo ==="
if (Test-Path -LiteralPath $saida) {
  Get-Content -LiteralPath $saida -Tail 10
} else {
  Write-Output "(sem arquivo de saida)"
}

Write-Output ""
Write-Output "=== log ==="
$log = Join-Path $env:LOCALAPPDATA 'VLOptimizer\manter-vivo.log'
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 5 }

Write-Output ""
Write-Output "=== resultado da tarefa ==="
$q = & cmd.exe /c ('schtasks /Query /TN "' + $nome + '" /FO LIST /V') 2>&1 | Out-String
$q -split "`r?`n" | Where-Object { $_ -match "ltima execu|ltimo resultado" }
