param([Parameter(Mandatory)][string]$Worktree)
$ErrorActionPreference = 'Stop'
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
Set-Location (Join-Path $Worktree 'apps/android')
$jvmArguments = '-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Dweftmate.nightly.workspace=' + $Worktree.Replace('\', '/')
# A single-use Gradle process carries this tree's path for 4c timeout cleanup.
# Keep the Kotlin compiler in that process instead of an unmarked shared daemon.
& gradle --offline :app:assembleDebug :app:assembleDebugAndroidTest '-PweftmateApplicationId=com.memoweft.weftmate.mobile.nightly' '-Pkotlin.compiler.execution.strategy=in-process' $jvmArguments --console=plain --no-daemon --max-workers=2
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
