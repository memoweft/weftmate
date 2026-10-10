param([Parameter(Mandatory)][string]$Worktree)
$ErrorActionPreference = 'Stop'
. D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1
Set-Location (Join-Path $Worktree 'apps/android')
& gradle --offline :app:assembleDebug :app:assembleDebugAndroidTest '-PweftmateApplicationId=com.memoweft.weftmate.mobile.nightly' --console=plain --no-daemon --max-workers=2
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
