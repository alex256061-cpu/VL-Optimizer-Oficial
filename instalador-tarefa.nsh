; instalador-tarefa.nsh - registra a tarefa agendada que abre o VL Optimizer elevado sem UAC.
;
; Por que no instalador: criar uma tarefa com RunLevel HighestAvailable exige administrador.
; Medido nesta maquina em 13/11/2026:
;   schtasks /create com o XML certo      -> "Acesso negado" (0x80070005) sem elevacao;
;   schtasks /create com XML invalido     -> erro de ESQUEMA ("namespace inesperado").
; Ou seja: o XML passa no esquema, e barra so a permissao. O instalador ja se eleva,
; entao e o unico ponto que pede UAC uma vez - o mesmo caminho do GDZ Optimizer, cuja
; tarefa foi conferida com Export-ScheduledTask:
;   Principal InteractiveToken + HighestAvailable, UserId = conta atual
;   Trigger   LogonTrigger  |  Action "<app>\GDZ Optimizer.exe" --autostart
;   Settings  IgnoreNew, ExecutionTimeLimit PT0S, DisallowStartIfOnBatteries=false
;
; Compatibilidade: requer instalador Unicode (electron-builder sempre compila com
; "Unicode true"; o teste de sintaxe em C:\VLTemp\nsis-test confirma isso).
;
; Armadilha do NSIS: $NOME consome a barra invertida e o texto seguinte como parte do
; nome da variavel ("$USERDOMAIN\$USERNAME" vira uma variavel inexistente). Por isso o
; nome da conta e montado em variaveis separadas e o .ps1 usa $$ para cifrao literal.

!include "LogicLib.nsh"

!define VL_TASK_NAME "VLOptimizer"
!define VL_ELEV_FLAG "--elevated-from-task"

!macro customInstall
  DetailPrint "Registrando a tarefa de administrador (abrir sem UAC)..."

  ; Conta atual no formato DOMINIO\USUARIO.
  ReadEnvStr $9 "USERDOMAIN"
  ReadEnvStr $8 "USERNAME"
  StrCmp $9 "" 0 +2
  ReadEnvStr $9 "COMPUTERNAME"
  StrCmp $8 "" 0 +3
  ReadEnvStr $8 "COMPUTERNAME"
  StrCpy $8 "User"
  StrCpy $9 "$9\$8"

  StrCpy $0 "$APPDATA\VLOptimizer-instalar"
  CreateDirectory "$0"

  ; XML da tarefa em UTF-16 (o schtasks exige o BOM).
  FileOpen $1 "$0\tarefa.xml" w
  FileWriteUTF16LE /BOM $1 '<?xml version="1.0" encoding="UTF-16"?>$\r$\n'
  FileWriteUTF16LE $1 '<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n'
  FileWriteUTF16LE $1 '<RegistrationInfo><URI>\${VL_TASK_NAME}</URI><Description>Abre o VL Optimizer como administrador, sem pedir UAC.</Description></RegistrationInfo>$\r$\n'
  FileWriteUTF16LE $1 '<Principals><Principal id="Author"><UserId>$9'
  FileWriteUTF16LE $1 '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>$\r$\n'
  FileWriteUTF16LE $1 '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>4</Priority><UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine></Settings>$\r$\n'
  FileWriteUTF16LE $1 '<Triggers><LogonTrigger><Enabled>false</Enabled><UserId>$9'
  FileWriteUTF16LE $1 '</UserId></LogonTrigger></Triggers>$\r$\n'
  FileWriteUTF16LE $1 '<Actions Context="Author"><Exec><Command>"$INSTDIR\${APP_EXECUTABLE_FILENAME}"</Command><Arguments>${VL_ELEV_FLAG}</Arguments><WorkingDirectory>$INSTDIR</WorkingDirectory></Exec></Actions>$\r$\n'
  FileWriteUTF16LE $1 '</Task>$\r$\n'
  FileClose $1

  ; Script que cria a tarefa e grava um marcador de conclusao (ExecShell e assincrono).
  FileOpen $1 "$0\aplicar.ps1" w
  FileWrite $1 '$$p = Join-Path $$env:APPDATA "VLOptimizer-instalar\tarefa.xml"$\r$\n'
  FileWrite $1 '$$marca = Join-Path $$env:APPDATA "VLOptimizer-instalar\concluido.txt"$\r$\n'
  FileWrite $1 '& schtasks.exe /create /tn "VLOptimizer" /xml $$p /f | Out-Null$\r$\n'
  FileWrite $1 'if ($$LASTEXITCODE -eq 0) { Set-Content -LiteralPath $$marca -Value "ok" -Encoding ASCII } else { Set-Content -LiteralPath $$marca -Value "falhou" -Encoding ASCII }$\r$\n'
  FileClose $1

  ; A instalacao e por usuario (perMachine:false, asInvoker): este processo NAO e
  ; administrador e o schtasks /create devolve "Acesso negado". O script roda num
  ; processo FILHO elevado — o UAC aparece uma vez aqui, igual ao GDZ.
  FileOpen $1 "$0\concluido.txt" w
  FileWrite $1 "pendente"
  FileClose $1

  DetailPrint "Pedindo permissao de administrador para a abertura automatica..."
  ExecShell "runas" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$0\aplicar.ps1"' SW_HIDE
  StrCpy $3 0

  vl_esperar:
    Sleep 700
    ClearErrors
    FileOpen $1 "$0\concluido.txt" r
    FileRead $1 $2
    FileClose $1
    StrCmp $2 "ok" vl_ok
    StrCmp $2 "falhou" vl_falhou
    IntOp $3 $3 + 1
    IntCmp $3 85 vl_sem_marcador vl_esperar vl_sem_marcador

  vl_ok:
    DetailPrint "Tarefa criada: o VL abre como administrador sem pedir UAC."
    Goto vl_fim

  vl_falhou:
    DetailPrint "Aviso: o Windows recusou criar a tarefa. O app abre normal."
    Goto vl_fim

  vl_sem_marcador:
    DetailPrint "Aviso: a tarefa de administrador nao foi confirmada. O app abre normal."

  vl_fim:
  Delete "$0\concluido.txt"
  RMDir /r "$0"
!macroend

!macro customUnInstall
  DetailPrint "Removendo a tarefa de administrador do VL..."
  nsExec::ExecToStack '"$SYSDIR\schtasks.exe" /delete /tn "${VL_TASK_NAME}" /f'
  Pop $1
  Pop $2
!macroend
