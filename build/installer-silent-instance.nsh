; Loaded by customHeader after upstream defines its instance macro.
!macroundef ALLOW_ONLY_ONE_INSTALLER_INSTANCE
!macro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  System::Call 'kernel32::CreateMutex(p 0, i 1, t "${APP_GUID}") ?e'
  Pop $0
  ${If} $0 == 183
    !insertmacro WeftFail 1638 "INSTALLER_BUSY: another setup is running"
  ${EndIf}
  ${IfNot} ${Silent}
    BringToFront
  ${EndIf}
!macroend
