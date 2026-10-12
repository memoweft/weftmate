param([ValidateSet('start','wait','worker')][string]$Action, [string]$Scope)
$ErrorActionPreference = 'Stop'
if (-not $Scope) { $Scope = Join-Path $env:RUNNER_TEMP "weftmate-ci-media-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT" }
$resultFile = Join-Path $Scope 'result.json'
$infoFile = Join-Path $Scope 'worker.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($Action -eq 'worker') {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $code = 0
  try {
    # Same dependency as Playwright's install_media_pack.ps1. Run while Node
    # and cached binaries are prepared; no UI launch occurs before the wait.
    $os = Get-CimInstance Win32_OperatingSystem
    if ($os.ProductType -eq 3) {
      $installed = Install-WindowsFeature Server-Media-Foundation
      if (-not $installed.Success) { throw 'Media Foundation installation failed' }
    }
  } catch { $code = 1; Write-Output $_.Exception.GetType().FullName }
  $result = @{exitCode=$code;seconds=$watch.Elapsed.TotalSeconds}
  [IO.File]::WriteAllText("$resultFile.tmp", ($result | ConvertTo-Json -Compress), $utf8)
  Move-Item -LiteralPath "$resultFile.tmp" -Destination $resultFile -Force
  exit $code
}
if ($Action -eq 'start') {
  New-Item -ItemType Directory -Path $Scope -Force | Out-Null
  $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  & node (Join-Path $PSScriptRoot 'ci-windows-media-start.mjs') $exe $PSCommandPath $Scope
  if ($LASTEXITCODE -ne 0) { throw 'Windows UI dependency worker could not start' }
  $child = Get-Process -Id ([int](Get-Content -LiteralPath (Join-Path $Scope 'worker.pid')))
  $info = @{pid=$child.Id;createdTicks=$child.StartTime.ToUniversalTime().Ticks.ToString();executable=$exe;script=$PSCommandPath}
  [IO.File]::WriteAllText($infoFile, ($info | ConvertTo-Json -Compress), $utf8)
  Write-Output 'Windows UI system dependency install started in background.'
  exit 0
}
if ($Action -eq 'wait') {
  $info = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
  while (-not (Test-Path -LiteralPath $resultFile)) {
    try {
      $child = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
      $line = if ($child) { (Get-CimInstance Win32_Process -Filter ('ProcessId='+$child.Id)).CommandLine } else { $null }
      if (-not $child -or $child.StartTime.ToUniversalTime().Ticks.ToString() -ne $info.createdTicks -or $child.Path -ne $info.executable -or -not $line.Contains($info.script)) {
        throw 'Windows UI dependency worker exited without its completion result'
      }
    } catch {
      # Completion can be committed between the file check and process query.
      if (Test-Path -LiteralPath $resultFile) { break }
      Write-Output "Windows media worker evidence: present=$([bool]$child); creationMatches=$(if($child){$child.StartTime.ToUniversalTime().Ticks.ToString() -eq $info.createdTicks}); executableMatches=$(if($child){$child.Path -eq $info.executable}); scriptMatches=$(if($line){$line.Contains($info.script)})"
      foreach ($stream in 'stdout.log','stderr.log') {
        $log = Join-Path $Scope $stream
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 12 }
      }
      throw
    }
    Start-Sleep -Seconds 1
  }
  $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  Write-Output "Windows UI system dependency install: $($result.seconds)s; exit $($result.exitCode)."
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "Windows Media Foundation setup (overlapped with Node preparation): $([Math]::Round($result.seconds,1))s; exit $($result.exitCode)." }
  exit $result.exitCode
}
