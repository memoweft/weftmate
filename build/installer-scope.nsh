!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ; Elevation used for the one-time removal of a legacy machine install must
    ; not make the replacement a machine install again.
    StrCpy $isForceCurrentInstall "1"
    StrCpy $isForceMachineInstall "0"
  !else
  ${If} $installMode == "all"
    StrCpy $isForceCurrentInstall "0"
    StrCpy $isForceMachineInstall "1"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
    StrCpy $isForceMachineInstall "0"
  ${EndIf}
  !endif
!macroend
