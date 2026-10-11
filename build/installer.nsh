; Retain electron-builder's default script, archive, blockmap and uninstaller.
!include LogicLib.nsh
!include MUI2.nsh
!include "${BUILD_RESOURCES_DIR}\windows-send-to.nsh"
!include "${BUILD_RESOURCES_DIR}\..\.local\installer-ui\identity.nsh"
!macroundef MUI_UNPAGE_WELCOME
!macro MUI_UNPAGE_WELCOME
!macroend
!macroundef MUI_UNPAGE_COMPONENTS
!macro MUI_UNPAGE_COMPONENTS
!macroend

!macroundef MUI_PAGE_INSTFILES
!macro MUI_PAGE_INSTFILES
  Page instfiles "" WeftProgress
!macroend
!macroundef MUI_UNPAGE_INSTFILES
!macro MUI_UNPAGE_INSTFILES
  UninstPage instfiles "" un.WeftProgress
!macroend
!macroundef MUI_PAGE_FINISH
!macro MUI_PAGE_FINISH
!macroend
!macro customFinishPage
!macroend
!macroundef MUI_UNPAGE_FINISH
!macro MUI_UNPAGE_FINISH
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend
!macro customPageAfterChangeDir
  Page custom WeftChoose WeftChooseLeave
!macroend
!macro WeftLoad
  InitPluginsDir
  File /oname=$PLUGINSDIR\WeftInstaller.dll "${BUILD_RESOURCES_DIR}\..\.local\installer-ui\WeftInstaller.dll"
  File /oname=$PLUGINSDIR\WeftIcon.ico "${BUILD_RESOURCES_DIR}\icon.ico"
!macroend
!macro preInit
  ${GetParameters} $R0
  ${GetOptions} $R0 "/allusers" $R1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
!macro customInit
  ${IfNot} ${Silent}
    ; The upstream init starts in $INSTDIR. Keep the UI and its Windows DLL
    ; search outside the old app directory while an upgrade removes that tree.
    SetOutPath $TEMP
    !insertmacro WeftLoad
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Initialize(p $HWNDPARENT, w "$PLUGINSDIR\WeftIcon.ico")'
  ${EndIf}
!macroend
!macro customUnInit
  ${IfNot} ${Silent}
    !insertmacro WeftLoad
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Initialize(p $HWNDPARENT, w "$PLUGINSDIR\WeftIcon.ico")'
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Confirm(w "$APPDATA\${WEFT_CONTROL_NAMESPACE}WeftMate\desktop-config.json", w "%APPDATA%\${WEFT_CONTROL_NAMESPACE}com.memoweft.weftmate") i.r0'
    ${If} $0 != 1
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Shutdown() ? u'
      Delete "$PLUGINSDIR\WeftInstaller.dll"
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; Preserve the upstream silent process handling, including update flags.
!include getProcessInfo.nsh
Var pid
!macro customCheckAppRunning
  ${If} ${Silent}
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  ${Else}
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Work()'
    !ifdef WEFT_TEST_IDENTITY
      SetDetailsPrint both
      ReadEnvStr $9 WEFTMATE_INSTALLER_TEST_ABORT
      ${If} $9 == "1"
        Abort "Synthetic section failure"
      ${EndIf}
    !endif
    System::Call '$PLUGINSDIR\WeftInstaller.dll::WaitForApp(w "$INSTDIR") i.r0'
    ${If} $0 != 1
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customHeader
  ManifestDPIAware true
  AutoCloseWindow true
  !ifdef BUILD_UNINSTALLER
    Function un.onUninstFailed
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Failed()'
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd
    Function un.WeftProgress
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Attach(p $HWNDPARENT, i 2)'
    FunctionEnd
    Function un.onGUIEnd
      ${IfNot} ${Silent}
        HideWindow
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Shutdown() ? u'
        Delete "$PLUGINSDIR\WeftInstaller.dll"
      ${EndIf}
    FunctionEnd
  !else
    Function WeftChoose
      ${If} ${Silent}
        Abort
      ${EndIf}
      ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 != ""
        ; Upstream already resolved the registered location and any explicit /D.
        Abort
      ${EndIf}
      IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
      Abort
      nsDialogs::Create 1018
      Pop $0
      !ifdef APP_64_UNPACKED_SIZE
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Ready(p $HWNDPARENT, w "$INSTDIR", i ${APP_64_UNPACKED_SIZE}, w "${APP_EXECUTABLE_FILENAME}", w "$APPDATA\${WEFT_CONTROL_NAMESPACE}WeftMate\desktop-config.json", w "%APPDATA%\${WEFT_CONTROL_NAMESPACE}com.memoweft.weftmate")'
      !else
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Ready(p $HWNDPARENT, w "$INSTDIR", i 0, w "${APP_EXECUTABLE_FILENAME}", w "$APPDATA\${WEFT_CONTROL_NAMESPACE}WeftMate\desktop-config.json", w "%APPDATA%\${WEFT_CONTROL_NAMESPACE}com.memoweft.weftmate")'
      !endif
      nsDialogs::Show
    FunctionEnd
    Function WeftChooseLeave
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Validate() i.r0'
      ${If} $0 != 1
        Abort
      ${EndIf}
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Directory() w.r0'
      StrCpy $INSTDIR $0
    FunctionEnd
    Function .onInstFailed
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Failed()'
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd
    Function WeftProgress
      StrCpy $0 0
      IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
      StrCpy $0 1
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Attach(p $HWNDPARENT, i r0)'
    FunctionEnd
    Function .onGUIEnd
      ${IfNot} ${Silent}
        HideWindow
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Shutdown() ? u'
        Delete "$PLUGINSDIR\WeftInstaller.dll"
      ${EndIf}
    FunctionEnd
  !endif
!macroend
; Finish at the end of the actual file/registration section, as the upstream
; one-click path does. There is no hidden Close button to wait for.
!macro customInstall
  !insertmacro WeftSendToInstall
  ${IfNot} ${Silent}
    HideWindow
    StrCpy $1 ""
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${EndIf}
    !ifdef WEFT_TEST_IDENTITY
      StrCpy $1 "$1 --disable-gpu"
      ReadEnvStr $3 WEFTMATE_INSTALLER_TEST_DEBUG_PORT
      ${If} $3 != ""
        StrCpy $1 "$1 --remote-debugging-port=$3"
      ${EndIf}
      ReadEnvStr $2 WEFTMATE_INSTALLER_TEST_THEME
      ${If} $2 == "dark"
        StrCpy $1 "$1 --force-dark-mode"
      ${EndIf}
    !endif
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Launch(w "$appExe", w "$1") i.r0'
    ${If} $0 != 1
      SetErrorLevel 2
      Quit
    ${EndIf}
    !insertmacro quitSuccess
  ${EndIf}
!macroend
!macro customUnInstallSection
  Section "un.WeftFinish"
    ${IfNot} ${Silent}
      !insertmacro quitSuccess
    ${EndIf}
  SectionEnd
!macroend
!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro WeftSendToUninstall
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup' $0
    ${If} $0 != 0
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::CleanupWarning()'
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
