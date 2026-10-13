$ErrorActionPreference='Stop'
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
Set-Location (Join-Path $PSScriptRoot '../../../apps/android')
& gradle --offline :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest '-PweftmateApplicationId=com.memoweft.weftmate.mobile.and5qa' '-Pkotlin.compiler.execution.strategy=in-process' '-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Dweftmate.and5.workspace=D:/AIProjects/WeftMate/Worktrees/w5' --console=plain --no-daemon --max-workers=2
exit $LASTEXITCODE
