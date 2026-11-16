# ══════════════════════════════════════════════════════════════════════════
# BACKUP E RESTAURAÇÃO DO ESTADO DO WINDOWS
#
# Regra nova, depois do incidente: nenhum teste aplica algo sem gravar o estado.
#
#   .\_backup-windows.ps1 salvar          -> grava tudo em C:\VLTemp\backups\<data>
#   .\_backup-windows.ps1 restaurar <dir> -> volta tudo ao que estava
#   .\_backup-windows.ps1 listar          -> mostra os backups
#
# O que é guardado: todas as chaves de registro que o app toca, exportadas com
# `reg export` (formato binário do próprio Windows, restauração garantida) e um
# resumo em texto para eu conferir antes/depois.
# ══════════════════════════════════════════════════════════════════════════
param(
    [Parameter(Position = 0)]
    [ValidateSet('salvar', 'restaurar', 'listar')]
    [string]$Acao = 'salvar',
    [Parameter(Position = 1)]
    [string]$Destino = ''
)

$ErrorActionPreference = 'Continue'
$RAIZ_BKP = 'C:\VLTemp\backups'

# Tudo que o VL toca, mais o que o Windows usa para aparência e serviços.
$CHAVES = @(
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Themes',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers',
    'HKCU\Control Panel\Desktop',
    'HKCU\Control Panel\Colors',
    'HKCU\Control Panel\Mouse',
    'HKCU\Control Panel\Keyboard',
    'HKCU\Control Panel\Accessibility\StickyKeys',
    'HKCU\Control Panel\Accessibility\ToggleKeys',
    'HKCU\Software\Microsoft\GameBar',
    'HKCU\System\GameConfigStore',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKCU\Software\Microsoft\DirectX\UserGpuPreferences',
    'HKCU\Software\Microsoft\DirectX\GraphicsSettings',
    'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management',
    'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile',
    'HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting',
    'HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl'
)

function Salvar {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dir = Join-Path $RAIZ_BKP $stamp
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    $linhas = New-Object System.Collections.Generic.List[string]
    $linhas.Add('# Estado em ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))
    $linhas.Add('# Computador: ' + $env:COMPUTERNAME)
    $linhas.Add('')

    $ok = 0
    $falhou = 0
    $num = 0
    foreach ($k in $CHAVES) {
        $num++
        # Nome simples: numero e o ultimo pedaco da chave. Sem regex, sem concatenacao
        # de formato — a versao anterior gerava um arquivo chamado "{0" e o backup
        # saia vazio sem avisar.
        $pedacos = $k.Split('\')
        $apelido = $pedacos[$pedacos.Length - 1]
        $nomeArq = ('{0:d2}' -f $num) + '_' + $apelido + '.reg'
        $arq = Join-Path $dir $nomeArq

        Remove-Item $arq -Force -ErrorAction SilentlyContinue
        & reg.exe export "$k" "$arq" /y > $null 2>&1
        $codigo = $LASTEXITCODE
        $tam = 0
        if (Test-Path $arq) { $tam = (Get-Item $arq).Length }

        if ($codigo -eq 0 -and $tam -gt 100) {
            $linhas.Add('[ok]    ' + $k)
            $ok++
        } else {
            $linhas.Add('[FALHA] ' + $k + '   (codigo ' + $codigo + ', ' + $tam + ' bytes)')
            if (Test-Path $arq) { Remove-Item $arq -Force -ErrorAction SilentlyContinue }
            $falhou++
        }
    }

    # Serviços: StartType de todos
    $svc = Join-Path $dir 'servicos.txt'
    & sc.exe query type= service state= all > $svc 2>&1

    $linhas.Add('')
    $linhas.Add('# Chaves ok: ' + $ok + '   falhas: ' + $falhou)
    $linhas.Add('# Restaurar com: .\_backup-windows.ps1 restaurar ' + $stamp)

    $texto = $linhas -join "`r`n"
    $texto | Out-File -FilePath (Join-Path $dir 'resumo.txt') -Encoding utf8

    Write-Host ''
    Write-Host ('Backup salvo em: ' + $dir) -ForegroundColor Green
    Write-Host ('Chaves: ' + $ok + ' ok, ' + $falhou + ' falha(s)') -ForegroundColor $(if ($falhou -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host ''
    Write-Host $texto
    Write-Host ''
    Write-Host ('Para voltar atras: .\_backup-windows.ps1 restaurar ' + $stamp) -ForegroundColor Yellow
}

function Restaurar {
    if (-not $Destino) {
        Write-Host 'Uso: .\_backup-windows.ps1 restaurar <nome-do-backup>' -ForegroundColor Red
        Write-Host 'Ou:  .\_backup-windows.ps1 listar' -ForegroundColor Red
        exit 1
    }
    $dir = Join-Path $RAIZ_BKP $Destino
    if (-not (Test-Path $dir)) { Write-Host ('Nao achei: ' + $dir) -ForegroundColor Red; exit 1 }

    Write-Host ''
    Write-Host ('Restaurando de: ' + $dir) -ForegroundColor Yellow
    Write-Host ''
    $n = 0
    Get-ChildItem $dir | Where-Object { $_.Name -like '*.reg' } | Sort-Object Name | ForEach-Object {
        & reg.exe import $_.FullName > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host ('  ok    ' + $_.Name + '   (' + $_.Length + ' B)') -ForegroundColor Green
            $n++
        } else {
            Write-Host ('  FALHA ' + $_.Name) -ForegroundColor Red
        }
    }
    Write-Host ''
    Write-Host ('Restauradas ' + $n + ' chaves.') -ForegroundColor Green
    Write-Host ''
    Write-Host 'Reinicie o Explorer para aplicar:' -ForegroundColor Yellow
    Write-Host '  Stop-Process -Name explorer -Force; Start-Process explorer' -ForegroundColor Yellow
}

function Listar {
    if (-not (Test-Path $RAIZ_BKP)) { Write-Host 'Nenhum backup ainda.'; return }
    Get-ChildItem $RAIZ_BKP -Directory | Sort-Object Name -Descending | ForEach-Object {
        $q = @(Get-ChildItem $_.FullName | Where-Object { $_.Name -like '*.reg' }).Count
        Write-Host ('  ' + $_.Name + '   ' + $q + ' chave(s)')
    }
}

switch ($Acao) {
    'salvar' { Salvar }
    'restaurar' { Restaurar }
    'listar' { Listar }
}
