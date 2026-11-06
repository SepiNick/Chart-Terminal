; Extra installer step: the app's Python tool and ML features need Python 3. If it is missing, offer to install the newest one.
!macro customInstall
  ${IfNot} ${Silent}
    nsExec::ExecToStack 'cmd /c py -3 --version'
    Pop $0
    ${If} $0 != 0
      nsExec::ExecToStack 'cmd /c python --version'
      Pop $0
    ${EndIf}
    ${If} $0 != 0
      MessageBox MB_YESNO|MB_ICONQUESTION "Chart Terminal's Python tool and ML features need Python, which is not installed.$\r$\n$\r$\nDownload and install the newest Python now (about 100 MB, from Microsoft's winget catalog)? You can skip this and the rest of the app still works." IDNO skipPython
      ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-python.ps1" -AppDir "$INSTDIR"'
      skipPython:
    ${EndIf}
  ${EndIf}
!macroend
