# agendar-manter-vivo.ps1
#
# Cria a tarefa do Windows que roda o ping do Supabase todo dia.
#
# Por que: o plano gratuito pausa o projeto depois de uma semana sem uso no banco. Uma consulta
# por dia mantem ativo, sem custo nenhum.
#
# Roda sem elevacao: e uma tarefa do usuario atual, sem privilegio de administrador.

$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'manter-supabase-vivo.ps1'
$nomeTarefa = 'VL Optimizer - manter Supabase ativo'

if (-not (Test-Path -LiteralPath $script)) {
  Write-Output "FALHA  script nao encontrado: $script"
  exit 1
}

# se ja existe, remove para recriar limpo
$existe = Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue
if ($existe) {
  Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false
  Write-Output "tarefa antiga removida"
}

# acao: rodar o PowerShell, sem janela
$acao = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

# gatilho: todo dia as 12:00, e tambem quando o PC liga (caso fique desligado na hora marcada)
$gatilhoDiario = New-ScheduledTaskTrigger -Daily -At '12:00'
$gatilhoBoot = New-ScheduledTaskTrigger -AtLogOn

# configuracao: sem janela, nao para na bateria, tenta de novo se falhar
$config = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$config.Hidden = $true

Register-ScheduledTask `
  -TaskName $nomeTarefa `
  -Action $acao `
  -Trigger @($gatilhoDiario, $gatilhoBoot) `
  -Settings $config `
  -Description 'Faz uma consulta diaria no Supabase do VL Optimizer para o projeto nao ser pausado por inatividade (plano gratuito).' | Out-Null

Write-Output "tarefa criada: $nomeTarefa"
Write-Output ""

# conferir
$t = Get-ScheduledTask -TaskName $nomeTarefa
Write-Output "estado: $($t.State)"
Write-Output "gatilhos:"
$t.Triggers | ForEach-Object { Write-Output "  $($_.CimClass.CimClassName)" }

Write-Output ""
Write-Output "testando agora..."
Start-ScheduledTask -TaskName $nomeTarefa
Start-Sleep -Seconds 8
$info = Get-ScheduledTaskInfo -TaskName $nomeTarefa
Write-Output "ultima execucao: $($info.LastRunTime)"
Write-Output "resultado:       $($info.LastTaskResult)   (0 = sucesso)"
