$ErrorActionPreference='Stop'
$qa4Root='D:\AIProjects\WeftMate\Worktrees\w2'
do { Start-Sleep -Seconds 10; $qa4Desktop=Get-Content "$qa4Root\tests\evidence\qa-4\desktop\results.json" -Raw | ConvertFrom-Json } until ($qa4Desktop.cleaned)
$env:JAVA_HOME='D:\AIProjects\WeftMate\Runtime\Toolchains\temurin17\jdk-17.0.20.1+1'
$env:ANDROID_HOME='D:\AIProjects\WeftMate\Runtime\Toolchains\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
Set-Location "$qa4Root\apps\android"
$ErrorActionPreference='Continue'
& (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat') --offline --no-daemon --max-workers=2 -p "$qa4Root\apps\android" '-Pkotlin.compiler.execution.strategy=in-process' '-PweftmateApplicationId=com.memoweft.weftmate.mobile.fx9qa' :app:assembleDebug :app:assembleDebugAndroidTest *> "$qa4Root\tests\evidence\qa-4\logs\android-build.log"
$qa4Code=$LASTEXITCODE
@{exitCode=$qa4Code;finishedAt=(Get-Date -Format o);baseline='b64378a9d46b85d24c4f8ae8c9853006ae7784c9';applicationId='com.memoweft.weftmate.mobile.fx9qa'} | ConvertTo-Json | Set-Content "$qa4Root\tests\evidence\qa-4\android-build.json"
exit $qa4Code
