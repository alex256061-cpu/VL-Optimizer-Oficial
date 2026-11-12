# agendar via cmd.exe (evita o PowerShell quebrar os argumentos do schtasks)
#
# O /TR precisa chegar ao schtasks como UMA string. O PowerShell re-quebra em espacos quando
# o argumento contem aspas internas. Chamar pelo cmd.exe com /c resolve.

$ErrorActionPreference = 'Continue'

$script = Join-Path $PSScriptRoot 'manter-supabase-vivo.ps1'
$nome = 'VLOptimizer-KeepSupabaseAlive'

if (-not (Test-Path -LiteralPath $script)) {
  Write-Output "FALHA: script nao encontrado: $script"
  exit 1
}

# Monta a linha como o cmd.exe espera:
#   schtasks /Create /TN nome /TR "powershell.exe ... -File ""caminho"" " /SC DAILY /ST 12:00 /F
# O cmd usa "" para representar uma aspa literal dentro do argumento.
$comando = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + $script
$tr = '"' + ($comando -replace '"', '""') + '"'

$linha = 'schtasks /Create /TN "' + $nome + '" /TR ' + $tr + ' /SC DAILY /ST 12:00 /F'

Write-Output "=== executando ==="
Write-Output $linha
Write-Output ""

$saida = & cmd.exe /c $linha 2>&1 | Out-String
Write-Output $saida

Write-Output "=== conferindo ==="
$q = & cmd.exe /c ('schtasks /Query /TN "' + $nome + '" /FO LIST /V') 2>&1 | Out-String
Write-Output $q
