param([ValidateSet('gradle','required','vendor','mobile')][string]$Mode='gradle')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$orchestrator='D:\AIProjects\WeftMate\Runtime\Orchestrator'
$owned=$null
while(-not $owned) {
    $busy=Get-ChildItem -LiteralPath $orchestrator -Filter 'heavy-*.lock' | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue) -like 'AND-7*' }
    if($busy){Write-Output 'Waiting for the current AND-7 heavy operation';Start-Sleep -Seconds 120;continue}
    foreach($slot in 1..3) {
        $candidate=Join-Path $orchestrator "heavy-$slot.lock"
        try { New-Item -ItemType File -Path $candidate -ErrorAction Stop | Out-Null; $owned=$candidate; Set-Content -LiteralPath $owned "AND-7 $(Get-Date -Format o) $Mode"; break } catch { if((Get-Content -LiteralPath $candidate -Raw -ErrorAction SilentlyContinue) -like 'AND-7*'){break} }
    }
    if(-not $owned){Write-Output 'Waiting for a heavy slot';Start-Sleep -Seconds 120}
}
try {
    Set-Location $repo
    if(Test-Path .local/and-7/npm-stage.txt) {
        $stage=Get-Content .local/and-7/npm-stage.txt
        $env:ELECTRON_OVERRIDE_DIST_PATH=Join-Path $stage 'node_modules/electron/dist'
    }
    $log=Join-Path $repo ".local/and-7/$Mode.txt"
    if($Mode -eq 'gradle') {
        . 'D:/AIProjects/AIGame/Repository/runtime/toolchains/activate-android.ps1'
        # Windows PowerShell treats harmless native stderr as NativeCommandError.
        # The process exit code, rather than an SDK metadata warning, decides success.
        $ErrorActionPreference='Continue'
        $env:JAVA_TOOL_OPTIONS="-Dweftmate.and7.workspace=$repo"
        Set-Location apps/android
        gradle --offline --no-daemon '-PweftmateApplicationId=com.memoweft.weftmate.mobile.and7qa' :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain *> $log
    } elseif($Mode -eq 'mobile') {
        node --test tests/personal-cloud-web.test.ts apps/mobile-ui/tests/cloud-login.test.mjs apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/visual-interactions.test.mjs apps/mobile-ui/tests/approval-interactions.test.mjs *> $log
    } else {
        node .github/scripts/ci-unit-tests.mjs $Mode --report ".local/and-7/$Mode.json" *> $log
    }
    $result=$LASTEXITCODE
    Get-Content -LiteralPath $log -Tail 28
    exit $result
} finally { Set-Location $repo; if($owned){Remove-Item -LiteralPath $owned -ErrorAction SilentlyContinue} }
