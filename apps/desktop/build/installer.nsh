!include "WinMessages.nsh"

!macro customInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\desktop\cli-path.ps1" -Action Add -Directory "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" dsh_cli_path_installed
  MessageBox MB_ICONSTOP "DeepSeek Harness could not register the dsh CLI in your user PATH.$\r$\n$1"
  Abort
  dsh_cli_path_installed:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\desktop\cli-path.ps1" -Action Remove -Directory "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" dsh_cli_path_removed
  MessageBox MB_ICONEXCLAMATION "DeepSeek Harness could not remove the dsh CLI directory from your user PATH.$\r$\n$1"
  dsh_cli_path_removed:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
