; SYS-3: current-user legacy Explorer verbs, isolated by APP_ID.
!macro WeftSendToInstall
  ReadRegDWORD $R0 HKCU "Software\WeftMate\SystemIntegration\${APP_ID}" "SendToEnabled"
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    WriteRegStr HKCU "Software\Classes\*\shell\${APP_ID}.SendTo" "" "发送到 WeftMate"
    WriteRegStr HKCU "Software\Classes\*\shell\${APP_ID}.SendTo" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
    WriteRegStr HKCU "Software\Classes\*\shell\${APP_ID}.SendTo" "MultiSelectModel" "Player"
    WriteRegStr HKCU "Software\Classes\*\shell\${APP_ID}.SendTo\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --send-to-weftmate "%1"'
    WriteRegStr HKCU "Software\Classes\Directory\shell\${APP_ID}.SendTo" "" "发送到 WeftMate"
    WriteRegStr HKCU "Software\Classes\Directory\shell\${APP_ID}.SendTo" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
    WriteRegStr HKCU "Software\Classes\Directory\shell\${APP_ID}.SendTo" "MultiSelectModel" "Player"
    WriteRegStr HKCU "Software\Classes\Directory\shell\${APP_ID}.SendTo\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --send-to-weftmate "%1"'
  ${EndIf}
!macroend
!macro WeftSendToUninstall
  DeleteRegKey HKCU "Software\Classes\*\shell\${APP_ID}.SendTo"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\${APP_ID}.SendTo"
  DeleteRegKey HKCU "Software\WeftMate\SystemIntegration\${APP_ID}"
!macroend
