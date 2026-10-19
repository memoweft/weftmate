$ErrorActionPreference='Stop'
$folder=Join-Path ([IO.Path]::GetTempPath()) ('apk-session-'+[Guid]::NewGuid())
New-Item -ItemType Directory -Path $folder|Out-Null
$script:installs=@();$script:instrumentStarted=$false;$script:failInstall=$false
function Invoke-TestManager { param([Parameter(ValueFromRemainingArguments)]$Arguments)
  if($Arguments[0] -eq 'info'){ '{"is_process_started":false,"is_android_started":true,"adb_port":12345}' }
}
function Invoke-TestAdb { param([Parameter(ValueFromRemainingArguments)]$Arguments)
  $global:LASTEXITCODE=0
  if($Arguments -contains 'install'){
    $script:installs+=,@($Arguments)
    if($script:failInstall){$global:LASTEXITCODE=1;'Failure [synthetic]'}else{'Success'}
  } elseif($Arguments -contains 'packages'){'package:com.memoweft.weftmate.mobile.b2qa'
  } elseif($Arguments -contains 'cat'){'321'
  } elseif($Arguments -contains 'forward' -and $Arguments -notcontains '--remove'){'12346'}
}
function Start-Sleep {}
function Start-Process { $script:instrumentStarted=$true;[pscustomobject]@{HasExited=$true} }
try {
  New-Item -ItemType File -Path (Join-Path $folder 'stop-session')|Out-Null
  . "$PSScriptRoot/session.ps1" -Evidence $folder -Locks $folder -Manager Invoke-TestManager -Adb Invoke-TestAdb -Instance 42
  $baseline=@($script:installs|Where-Object {$_[-1] -eq (Join-Path $folder 'baseline.apk')})
  if($baseline.Count -ne 1 -or $baseline[0] -notcontains '-r'){throw 'Reused instance did not reinstall candidate baseline with -r'}
  if(!$script:instrumentStarted){throw 'Driver did not start after successful installs'}
  $script:failInstall=$true;$script:instrumentStarted=$false
  $failed=$false
  try{. "$PSScriptRoot/session.ps1" -Evidence $folder -Locks $folder -Manager Invoke-TestManager -Adb Invoke-TestAdb -Instance 42}catch{$failed=$true}
  if(!$failed -or $script:instrumentStarted){throw 'Failed candidate installation must stop before driver startup'}
  Write-Output '2 APK session checks passed'
} finally {Remove-Item -LiteralPath $folder -Recurse -Force}
