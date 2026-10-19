$ErrorActionPreference='Stop'
$folder=Join-Path ([IO.Path]::GetTempPath()) ('scenario-budget-'+[Guid]::NewGuid())
New-Item -ItemType Directory -Path $folder|Out-Null
$script:clock=[datetime]'2026-01-01T00:00:00Z';$script:start=$script:clock
function Get-Date {$script:clock}
function Start-Process {
  [IO.File]::WriteAllText((Join-Path $folder 'ready.json'),'{}')
  $fake=[pscustomobject]@{HasExited=$false;Id=0}
  $fake|Add-Member ScriptMethod WaitForExit {param($Milliseconds) return $true}
  return $fake
}
function Start-Sleep {
  param([int]$Milliseconds)
  $script:clock=$script:clock.AddMilliseconds($Milliseconds)
  $request=Join-Path $folder 'request.json'
  if(($script:clock-$script:start).TotalSeconds -ge 500 -and (Test-Path $request)){
    $id=(Get-Content $request -Raw|ConvertFrom-Json).id
    [IO.File]::WriteAllText((Join-Path $folder 'response.json'),(@{id=$id;ok=$true}|ConvertTo-Json -Compress))
  }
}
try {
  [IO.File]::WriteAllText((Join-Path $folder 'installation.json'),'{}')
  . "$PSScriptRoot/rerun.ps1" -EvidenceDirectory $folder -Cases @('memoryForgetChat')
  if(!(Test-Path (Join-Path $folder 'memoryForgetChat-result.json'))){throw 'Legitimate multi-wait scenario was terminated early'}
  Write-Output 'Long scenario completed at 500 simulated seconds'
  Remove-Item -LiteralPath (Join-Path $folder 'ready.json'),(Join-Path $folder 'response.json'),(Join-Path $folder 'memoryForgetChat-result.json')
  $script:clock=$script:start
  $timedOut=$false
  try{. "$PSScriptRoot/rerun.ps1" -EvidenceDirectory $folder -Cases @('memoryForgetChat') -ScenarioTimeoutMinutes 1}catch{
    if($_.Exception.Message -notmatch 'Scenario action timed out'){throw};$timedOut=$true
  }
  if(!$timedOut -or ($script:clock-$script:start).TotalSeconds -ne 60){throw 'Configured scenario deadline was not enforced'}
  if(!(Test-Path (Join-Path $folder 'stop.json'))){throw 'Controller cleanup was not requested'}
  Write-Output 'Short scenario budget still stops at 60 simulated seconds'
} finally {Remove-Item -LiteralPath $folder -Recurse -Force}
