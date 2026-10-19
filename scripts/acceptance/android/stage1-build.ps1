param(
  [Parameter(Mandatory)][string]$Toolchain,
  [Parameter(Mandatory)][string]$Evidence,
  [Parameter(Mandatory)][string]$Locks
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$owned=$null
$owner='R-B2 build '+[DateTimeOffset]::UtcNow.ToString('o')
try {
  foreach($n in 1..3) {
    $candidate=Join-Path $Locks "heavy-$n.lock"
    try { New-Item -ItemType File -Path $candidate -Value $owner -ErrorAction Stop|Out-Null; $owned=$candidate; break } catch [System.IO.IOException] {}
  }
  if(!$owned){throw 'No heavy slot available'}
  New-Item -ItemType Directory -Path $Evidence -Force|Out-Null
  $env:JAVA_HOME=Join-Path $Toolchain 'jdk/jdk-17.0.20.1+1'
  $env:ANDROID_HOME=Join-Path $Toolchain 'android-sdk'
  $env:ANDROID_USER_HOME=Join-Path $Toolchain 'android-user-home'
  $env:GRADLE_USER_HOME=Join-Path $Toolchain 'gradle-user-home'
  $env:PATH=(Join-Path $env:JAVA_HOME 'bin')+';'+$env:PATH
  $psi=[Diagnostics.ProcessStartInfo]::new('cmd.exe')
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
  $psi.WorkingDirectory=Join-Path $repo 'apps/android'
  $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  $gradle=Join-Path $Toolchain 'gradle/gradle-8.9/bin/gradle.bat'
  $psi.Arguments='/d /c ""'+$gradle+'" --offline --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process -PweftmateApplicationId=com.memoweft.weftmate.mobile.b2qa --init-script "'+(Join-Path $PSScriptRoot 'stage1-driver.init.gradle')+'" :app:assembleDebug :app:assembleDebugAndroidTest"'
  $process=[Diagnostics.Process]::Start($psi)
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  if(!$process.WaitForExit(900000)){$process.Kill($true);throw 'Gradle exceeded 15 minutes'}
  ($stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult())|Set-Content (Join-Path $Evidence 'build.log')
  if($process.ExitCode -ne 0){throw 'Build failed; see build.log'}
  Copy-Item (Join-Path $repo 'apps/android/app/build/outputs/apk/debug/app-debug.apk') (Join-Path $Evidence 'baseline.apk')
  Copy-Item (Join-Path $repo 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk') (Join-Path $Evidence 'driver.apk')
  $apk=Get-Item (Join-Path $Evidence 'baseline.apk')
  @{source=(git -C $repo rev-parse HEAD);package='com.memoweft.weftmate.mobile.b2qa';bytes=$apk.Length;sha256=(Get-FileHash $apk.FullName -Algorithm SHA256).Hash.ToLowerInvariant();metadata=(Get-Content (Join-Path $repo 'apps/android/app/build/outputs/apk/debug/output-metadata.json') -Raw|ConvertFrom-Json)}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $Evidence 'apk-metadata.json')
  Get-Content (Join-Path $Evidence 'build.log') -Tail 8
} finally {
  if($process -and !$process.HasExited){$process.Kill($true)}
  if($owned -and (Get-Content $owned -Raw).Trim() -eq $owner){Remove-Item -LiteralPath $owned}
}
