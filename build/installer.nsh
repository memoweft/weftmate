!include nsDialogs.nsh
!include LogicLib.nsh
!include MUI2.nsh
!ifdef BUILD_UNINSTALLER
Var WeftDeleteData
Var WeftDeleteCheck
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend

!macro preInit
  ${GetParameters} $R0
  ${GetOptions} $R0 "/allusers" $R1
  ${IfNot} ${Errors}
    MessageBox MB_ICONSTOP "WeftMate 仅支持当前用户安装，无需管理员权限。"
    Quit
  ${EndIf}
!macroend

!macro customUnWelcomePage
  UninstPage custom un.WeftDataPage un.WeftDataLeave
!macroend

!ifdef BUILD_UNINSTALLER
Function un.WeftDataPage
  !insertmacro MUI_HEADER_TEXT "卸载 WeftMate" "默认保留对话、记忆和配置，重新安装后可以继续使用。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 48u "卸载只删除程序。数据目录会保留。$\r$\n选择下面的选项会永久删除当前配置所指向的本机数据。$\r$\n自定义数据目录也包含在内，请先备份。"
  Pop $0
  ${NSD_CreateCheckbox} 0 58u 100% 20u "同时删除数据（不可恢复）"
  Pop $WeftDeleteCheck
  ${NSD_Uncheck} $WeftDeleteCheck
  nsDialogs::Show
FunctionEnd

Function un.WeftDataLeave
  ${NSD_GetState} $WeftDeleteCheck $WeftDeleteData
  ${If} $WeftDeleteData == ${BST_CHECKED}
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "永久删除本机的对话、记忆、凭据和配置？此操作不可恢复。" IDYES +2
    Abort
  ${EndIf}
FunctionEnd
!endif

!macro customUnInstall
  StrCpy $1 ""
  ${If} $WeftDeleteData == ${BST_CHECKED}
  ${AndIfNot} ${Silent}
    StrCpy $1 "--delete-data"
  ${EndIf}
  ${IfNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup $1' $0
    ${If} $0 != 0
      ${IfNot} ${Silent}
        MessageBox MB_ICONSTOP "清理未完成，数据已保留。请重新安装后从设置中删除。"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
