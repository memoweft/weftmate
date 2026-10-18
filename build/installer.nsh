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
  ${If} $installMode == "all"
    StrCpy $isForceCurrentInstall "0"
    StrCpy $isForceMachineInstall "1"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
    StrCpy $isForceMachineInstall "0"
  ${EndIf}
!macroend
!macro customPageAfterChangeDir
  Page custom WeftChoose WeftChooseLeave
!macroend
!macro WeftLoad
  InitPluginsDir
  ; Both initialization and process-check hooks use this helper. Never rewrite
  ; the DLL after System::Call has loaded it into the installer.
  ${IfNot} ${FileExists} "$PLUGINSDIR\WeftInstaller.dll"
    File /oname=$PLUGINSDIR\WeftInstaller.dll "${BUILD_RESOURCES_DIR}\..\.local\installer-ui\WeftInstaller.dll"
    File /oname=$PLUGINSDIR\WeftIcon.ico "${BUILD_RESOURCES_DIR}\icon.ico"
  ${EndIf}
!macroend
!macro preInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--silent" $R1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
  ; Upstream's unsupported-platform checks display MessageBox without /SD.
  ; Exit before those checks when silent, including the --silent alias.
  ${If} ${Silent}
    ${If} ${IsWin2000}
    ${OrIf} ${IsWinME}
    ${OrIf} ${IsWinXP}
    ${OrIf} ${IsWinVista}
      !insertmacro WeftFail 1633 "UNSUPPORTED_SYSTEM: this Windows version is unsupported"
    ${EndIf}
    !ifdef APP_64
      !ifndef APP_ARM64
        !ifndef APP_32
          ${IfNot} ${RunningX64}
            !insertmacro WeftFail 1633 "UNSUPPORTED_SYSTEM: a 64-bit Windows system is required"
          ${EndIf}
        !endif
      !endif
    !endif
  ${EndIf}
  SetRegView 64
  ReadRegStr $weftOldUser HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $weftOldMachine HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ; electron-builder runs this script once more to write the uninstaller (BUILD_UNINSTALLER).
  ; That pass installs nothing: it must not be refused because the build machine has an all-users install.
  !ifndef BUILD_UNINSTALLER
  ; Refuse unavailable elevation before the upstream silent UAC branch.
  StrCpy $R2 0
  ${If} $weftOldMachine != ""
  ${AndIf} $weftOldUser == ""
    StrCpy $R2 1
  ${EndIf}
  ${If} ${isForAllUsers}
    StrCpy $R2 1
  ${EndIf}
  ${If} ${isForCurrentUser}
    StrCpy $R2 0
  ${EndIf}
  ${If} $R2 == 1
  ${OrIf} $weftOldMachine != ""
    ${IfNot} ${UAC_IsAdmin}
      ${IfNot} ${Silent}
        !insertmacro WeftLoad
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Initialize(p $HWNDPARENT, w "$PLUGINSDIR\WeftIcon.ico")'
        System::Call '$PLUGINSDIR\WeftInstaller.dll::AdminRequired()'
      ${EndIf}
      !insertmacro WeftFail 740 "ADMIN_REQUIRED: run setup from an elevated terminal"
    ${EndIf}
  ${EndIf}
  !endif
!macroend
!macro WeftDefaultDirectory
  ; Only a fresh automatically generated per-user destination may be shortened.
  !insertmacro GetDParameter $R0
  ${If} $weftOldUser == ""
  ${AndIf} $weftOldMachine == ""
  ${AndIf} $R0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    System::Call '$PLUGINSDIR\WeftInstaller.dll::DefaultDirectory(w "$INSTDIR") w.r0'
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend
!macro customInit
  SetOutPath $TEMP
  ; Upstream's silent section otherwise switches back to all users even when
  ; /currentuser was explicitly requested. Keep the selected target scope.
  ${If} ${isForCurrentUser}
    StrCpy $hasPerMachineInstallation "0"
  ${EndIf}
  !insertmacro WeftLoad
  !insertmacro WeftDefaultDirectory
  ${IfNot} ${Silent}
    ; The upstream init starts in $INSTDIR. Keep the UI and its Windows DLL
    ; search outside the old app directory while an upgrade removes that tree.
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Initialize(p $HWNDPARENT, w "$PLUGINSDIR\WeftIcon.ico")'
  ${EndIf}
!macroend
!macro customUnInit
  SetOutPath $TEMP
  !insertmacro WeftLoad
  ${IfNot} ${Silent}
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Initialize(p $HWNDPARENT, w "$PLUGINSDIR\WeftIcon.ico")'
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Confirm(w "$APPDATA\${WEFT_CONTROL_NAMESPACE}WeftMate\desktop-config.json", w "%APPDATA%\${WEFT_CONTROL_NAMESPACE}com.memoweft.weftmate") i.r0'
    ${If} $0 != 1
      System::Call '$PLUGINSDIR\WeftInstaller.dll::Shutdown() ? u'
      Delete "$PLUGINSDIR\WeftInstaller.dll"
      Quit
    ${EndIf}
  ${EndIf}
!macroend

Var weftOldUser
Var weftOldMachine
!macro WeftFail code message
  FileOpen $R7 "$TEMP\${APP_FILENAME}-setup.log" a
  FileWrite $R7 "${message}$\r$\n"
  FileClose $R7
  SetErrorLevel ${code}
  Quit
!macroend
!macro WeftPleaseQuit directory
  ${If} "${directory}" != ""
    System::Call '$PLUGINSDIR\WeftInstaller.dll::QuitApp(w "${directory}", w "${APP_EXECUTABLE_FILENAME}", i 1) i.r0'
    ${If} $0 != 1
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::WaitForApp(w "${directory}") i.r0'
      ${EndIf}
      ${If} $0 != 1
        !insertmacro WeftFail 3 "QUIT_FAILED: app did not finish saving within 20 seconds"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
!macro customCheckAppRunning
  ; un.onInit invokes this hook before customUnInit, including under /S.
  SetOutPath $TEMP
  !insertmacro WeftLoad
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--silent" $R1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
  ReadRegStr $R6 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R6 != ""
    ${IfNot} ${UAC_IsAdmin}
      !insertmacro WeftFail 740 "ADMIN_REQUIRED: run setup from an elevated terminal"
    ${EndIf}
  ${EndIf}
  ${IfNot} ${Silent}
    System::Call '$PLUGINSDIR\WeftInstaller.dll::Work()'
    !ifdef WEFT_TEST_IDENTITY
      SetDetailsPrint both
      ReadEnvStr $9 WEFTMATE_INSTALLER_TEST_ABORT
      ${If} $9 == "1"
        Abort "Synthetic section failure"
      ${EndIf}
    !endif
  ${EndIf}
  !insertmacro WeftPleaseQuit "$INSTDIR"
  !ifndef BUILD_UNINSTALLER
    ${If} $weftOldUser != $INSTDIR
      !insertmacro WeftPleaseQuit "$weftOldUser"
    ${EndIf}
    ${If} $weftOldMachine != $INSTDIR
      !insertmacro WeftPleaseQuit "$weftOldMachine"
    ${EndIf}
    ; Upstream handles user -> machine; also remove machine -> user.
    ${If} $installMode == "CurrentUser"
    ${AndIf} $weftOldMachine != ""
      ; Upstream derives the old uninstaller's /allusers argument from this
      ; variable, even when an explicit HKLM root was passed.
      StrCpy $installMode "all"
      !insertmacro uninstallOldVersion HKEY_LOCAL_MACHINE
      StrCpy $installMode "CurrentUser"
      !insertmacro handleUninstallResult HKEY_LOCAL_MACHINE
    ${EndIf}
  !endif
!macroend

!macro customUnInstallCheck
  ${If} ${Errors}
    !insertmacro WeftFail 2 "UNINSTALL_FAILED: previous uninstaller could not be started"
  ${EndIf}
  ${If} $R0 != 0
    !insertmacro WeftFail 2 "UNINSTALL_FAILED: previous installation could not be removed"
  ${EndIf}
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

!macro customHeader
  !include "${BUILD_RESOURCES_DIR}\installer-silent-instance.nsh"
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
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Attach(p $HWNDPARENT, i 2)'
      ${EndIf}
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
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      ; The range page calls setInstallModePerUser again after customInit.
      ; Apply the same default after that page, immediately before displaying it.
      !insertmacro WeftDefaultDirectory
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
      SetErrorLevel 2
      ${IfNot} ${Silent}
        System::Call '$PLUGINSDIR\WeftInstaller.dll::Failed()'
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd
    Function WeftProgress
      ${If} ${Silent}
        Return
      ${EndIf}
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
  FileOpen $0 "$INSTDIR\resources\weftmate-install.json" w
  FileWrite $0 '{"scope":"$installMode","externalQuit":true}'
  FileClose $0
  ExecWait '"$appExe" --repair-installation' $0
  ${If} ${Silent}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--launch" $R1
    ${IfNot} ${Errors}
      Exec '"$appExe"'
    ${EndIf}
    !insertmacro quitSuccess
  ${EndIf}
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
