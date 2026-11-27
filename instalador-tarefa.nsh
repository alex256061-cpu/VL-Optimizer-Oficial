; ═══════════════════════════════════════════════════════════════════════════
; VISUAL DO INSTALADOR (1.4.73)
;
; O electron-builder monta o instalador "assistido" com o MUI do NSIS, que por
; padrao e' cinza e careta. Estas linhas (que entram ANTES do installer.nsi e,
; por isso, antes das paginas serem declaradas) fazem:
;   - installerSidebar.bmp (preto/vermelho, 164x314) nas telas de boas-vindas e
;     de conclusao  -> electron-builder liga isso a MUI_WELCOMEFINISHPAGE_BITMAP
;   - installerHeader.bmp (150x57) no topo da tela de instalacao
;     -> MUI_HEADERIMAGE / MUI_HEADERIMAGE_BITMAP
;   - uma pagina de boas-vindas com texto nosso
;   - a pagina generica "para todos os usuarios / apenas para mim" e' PULADA:
;     customInstallmode poe =1 e a funcao da pagina da
;     Abort(), entao ela nem aparece. A instalacao continua por usuario (sem UAC).
; ═══════════════════════════════════════════════════════════════════════════

; deixa a janela do instalador no tema escuro do Windows (barra de titulo)
!define MUI_CUSTOMFUNCTION_GUIINIT "VLDarkWindow"

!macro customHeader
  Function VLDarkWindow
    ; barra de titulo escura (Windows 10/11)
    System::Call 'dwmapi::DwmSetWindowAttribute(i $HWNDPARENT, i 20, *i 1, i 4)'
    System::Call 'dwmapi::DwmSetWindowAttribute(i $HWNDPARENT, i 19, *i 1, i 4)'
    ; fundo do rodape (a faixa onde ficam os botoes)
    System::Call 'gdi32::CreateSolidBrush(i 0x0007030B) i .r0'
    System::Call 'user32::SetClassLong(i $HWNDPARENT, i -10, i r0)'
    System::Call 'user32::InvalidateRect(i $HWNDPARENT, i 0, i 1)'
    ; botoes nativos no tema escuro
    System::Call 'uxtheme::SetWindowTheme(i $HWNDPARENT, w "", w "")'
    GetDlgItem $1 $HWNDPARENT 1
    System::Call 'uxtheme::SetWindowTheme(i $1, w "", w "")'
    SetCtlColors $1 "F5F1F6" "1A0710"
    GetDlgItem $1 $HWNDPARENT 2
    System::Call 'uxtheme::SetWindowTheme(i $1, w "", w "")'
    SetCtlColors $1 "F5F1F6" "1A0710"
  FunctionEnd
!macroend

!define MUI_BGCOLOR "0B0307"
!define MUI_TEXTCOLOR "F5F1F6"
!define MUI_INSTFILESPAGE_COLORS "0B0307 F5F1F6"
!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao VL Optimizer"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o VL Optimizer no seu PC.$\r$\n$\r$\nEm poucos segundos o programa fica pronto, com atalho na Area de Trabalho e no menu Iniciar. Depois e so entrar com a sua conta."
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TITLE "VL Optimizer instalado"
!define MUI_FINISHPAGE_TEXT "O VL Optimizer esta pronto. Abra pelo atalho da Area de Trabalho ou pelo menu Iniciar e comece a otimizar."

; Troca o desenho dos botoes nativos por imagens do VL, mantendo os mesmos IDs
; (o MUI continua controlando habilitar/desabilitar e a navegacao).
Function VLBotoesImagem
  InitPluginsDir
  File /oname=$PLUGINSDIR\vl-btn-next.bmp "instalador\btn-proximo.bmp"
  File /oname=$PLUGINSDIR\vl-btn-cancel.bmp "instalador\btn-cancelar.bmp"
  File /oname=$PLUGINSDIR\vl-btn-finish.bmp "instalador\btn-concluir.bmp"

  ; botoes 1 (Proximo/Concluir) e 2 (Cancelar)
  GetDlgItem $0 $HWNDPARENT 1
  System::Call 'user32::GetWindowLong(i $0, i -16) i .r1'
  IntOp $1 $1 | 0x80
  System::Call 'user32::SetWindowLong(i $0, i -16, i r1)'
  SendMessage $0 0x000C 0 0
  System::Call 'user32::LoadImage(i 0, w "$PLUGINSDIR\vl-btn-next.bmp", i 0, i 0, i 0, i 0x10) i .r2'
  SendMessage $0 0x00F7 0 $2
  System::Call 'user32::InvalidateRect(i $0, i 0, i 1)'

  GetDlgItem $0 $HWNDPARENT 2
  System::Call 'user32::GetWindowLong(i $0, i -16) i .r1'
  IntOp $1 $1 | 0x80
  System::Call 'user32::SetWindowLong(i $0, i -16, i r1)'
  SendMessage $0 0x000C 0 0
  System::Call 'user32::LoadImage(i 0, w "$PLUGINSDIR\vl-btn-cancel.bmp", i 0, i 0, i 0, i 0x10) i .r2'
  SendMessage $0 0x00F7 0 $2
  System::Call 'user32::InvalidateRect(i $0, i 0, i 1)'
FunctionEnd

Function VLBoasVindasShow
  Call VLBotoesImagem
FunctionEnd

Function VLConclusaoShow
  Call VLBotoesImagem
  ; na conclusao o botao 1 vira "Concluir"
  GetDlgItem $0 $HWNDPARENT 1
  System::Call 'user32::LoadImage(i 0, w "$PLUGINSDIR\vl-btn-finish.bmp", i 0, i 0, i 0, i 0x10) i .r2'
  SendMessage $0 0x00F7 0 $2
  System::Call 'user32::InvalidateRect(i $0, i 0, i 1)'
FunctionEnd

!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW VLBoasVindasShow
  !insertmacro MUI_PAGE_WELCOME
  !undef MUI_PAGE_CUSTOMFUNCTION_SHOW
!macroend

!macro customFinishPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW VLConclusaoShow
  !insertmacro MUI_PAGE_FINISH
  !undef MUI_PAGE_CUSTOMFUNCTION_SHOW
!macroend

; Pula a pagina padrao "escolha uma opcao de instalacao".
!macro customInstallmode
  StrCpy $isForceCurrentInstall "1"
!macroend
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
  ; INSTALACAO SILENCIOSA = atualizacao automatica (/S). Aqui NAO existe janela para o
  ; UAC aparecer: o ExecShell "runas" era negado na hora e o laco abaixo esperava os
  ; 85 x 700 ms (~60 s) por um marcador que nunca ia chegar. Era ISSO que fazia a
  ; instalacao parecer travada (72,7 s medidos com /S; a copia dos 448 MB leva ~12 s).
  ; Na atualizacao a tarefa ja existe desde a primeira instalacao, entao pular e' seguro.
  IfSilent vl_fim

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
  FileWriteUTF16LE $1 '<Triggers><LogonTrigger><UserId>$9'
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
    Sleep 500
    ClearErrors
    FileOpen $1 "$0\concluido.txt" r
    FileRead $1 $2
    FileClose $1
    StrCmp $2 "ok" vl_ok
    StrCmp $2 "falhou" vl_falhou
    IntOp $3 $3 + 1
    IntCmp $3 24 vl_sem_marcador vl_esperar vl_sem_marcador

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
