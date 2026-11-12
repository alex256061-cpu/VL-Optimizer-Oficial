# agendar com caminho SEM espaco (C:\VLOptimizer)
#
# O problema anterior: o caminho tinha "lucas larado" (com espaco), e as aspas aninhadas do
# schtasks quebravam. Com o script em C:\VLOptimizer o comando fica simples e funciona.

$ErrorActionPreference = 'Continue'
$nome = 'VLOptimizer-KeepSupabaseAlive'
$script = 'C:\VLOptimizer\manter-supabase-vivo.ps1'

if (-not (Test-Path -LiteralPath $script)) {
  Write-Output "FALHA: $script nao existe"
  exit 1
}

# remove a antiga se existir
& cmd.exe /c ('schtasks /Delete /TN "' + $nome + '" /F') 2>&1 | Out-Null

# comando: sem aspas internas, porque o caminho nao tem espaco
$comando = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + $script
$linha = 'schtasks /Create /TN "' + $nome + '" /TR "' + $comando + '" /SC DAILY /ST 12:00 /F'

Write-Output "=== criando ==="
Write-Output $linha
$r = & cmd.exe /c $linha 2>&1 | Out-String
Write-Output $r

Write-Output "=== rodando agora ==="
& cmd.exe /c ('schtasks /Run /TN "' + $nome + '"') 2>&1 | Out-Null
Start-Sleep -Seconds 12

Write-Output "=== resultado ==="
$q = & cmd.exe /c ('schtasks /Query /TN "' + $nome + '" /FO LIST /V') 2>&1 | Out-String
$q -split "`r?`n" | Where-Object { $_ -match "ltima execu|ltimo resultado|Status" }

Write-Output ""
Write-Output "=== log ==="
$log = Join-Path $env:LOCALAPPDATA 'VLOptimizer\manter-vivo.log'
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 5 }
