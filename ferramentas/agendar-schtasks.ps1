# agendar com schtasks.exe (sem elevacao)
#
# O caminho tem espaco ("lucas larado"), entao o /TR precisa de aspas internas. O schtasks
# exige que o caminho do exe esteja entre aspas duplas escapadas como \"...\".

$ErrorActionPreference = 'Continue'

$script = Join-Path $PSScriptRoot 'manter-supabase-vivo.ps1'
$nome = 'VLOptimizer-KeepSupabaseAlive'

if (-not (Test-Path -LiteralPath $script)) {
  Write-Output "FALHA: script nao encontrado"
  exit 1
}

# comando completo: powershell.exe ... -File "C:\caminho\manter-supabase-vivo.ps1"
$comando = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
$tr = '"' + $comando + '"'

Write-Output "=== criando a tarefa ==="
Write-Output "comando: $comando"

$saida = & schtasks.exe /Create /TN $nome /TR $tr /SC DAILY /ST 12:00 /F 2>&1 | Out-String
Write-Output $saida

Write-Output "=== conferindo ==="
$q = & schtasks.exe /Query /TN $nome /FO LIST 2>&1 | Out-String
Write-Output $q
