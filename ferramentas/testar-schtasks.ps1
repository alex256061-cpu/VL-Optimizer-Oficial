# Testar se o schtasks funciona sem elevacao (tarefa do usuario atual)
#
# Register-ScheduledTask exige elevacao. O schtasks.exe com /SC DAILY e o mesmo usuario pode
# funcionar sem. Vamos testar.

$ErrorActionPreference = 'Continue'

$script = Join-Path $PSScriptRoot 'manter-supabase-vivo.ps1'
$nome = 'VLOptimizer-KeepSupabaseAlive'

Write-Output "=== removendo tarefa antiga (se existir) ==="
& schtasks /Delete /TN $nome /F 2>&1 | Out-String

Write-Output ""
Write-Output "=== criando com schtasks (sem elevacao) ==="
$args = @(
  '/Create',
  '/TN', $nome,
  '/TR', "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"",
  '/SC', 'DAILY',
  '/ST', '12:00',
  '/F'
)
$out = & schtasks @args 2>&1 | Out-String
Write-Output $out

Write-Output ""
Write-Output "=== a tarefa existe? ==="
$q = & schtasks /Query /TN $nome /FO LIST 2>&1 | Out-String
Write-Output $q
