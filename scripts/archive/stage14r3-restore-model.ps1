# One-use Stage14R3 recovery after a worker StrictMode empty-listener failure.
# Starts only the original NInfer argv via a new yun/S4U task, updates the
# runtime PID state, then starts only the registered ModelSwitcher task.
param([switch]$Run,[switch]$ResumeSwitcher,[string]$EvidenceFile)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'D:\AIProjects\WeftMate\Runtime\UnifiedAssistant\Stage14R3Acceptance-20261004'
$manifestFile = Join-Path $root 'emergency-recovery-manifest-f333ad66-4d10-4794-ae96-1fe22244b4ff.json'
$manifestHash = '7f1c1d690a006270ba2246ee0a1e2f298d0b9d2f51d6003bf14afefa8b548c34'
$oldManifestFile = Join-Path $root 'manifest-26f8ad11-8718-43ba-90af-b22e0dd8049c.json'
$oldManifestHash = 'ecbd251ea4655ef162777c8e6e7a00d13ddecda873327854def392796d6319db'
$reportFile = Join-Path $root ('emergency-model-restore-' + [guid]::NewGuid().ToString('N') + '.json')
$phase = 'preflight'; $code = 'UNCONFIRMED'
$newModelPid = $null; $newProxyPid = $null; $newSupervisorPid = $null
$taskName = $null; $taskRegistered = $false; $stateUpdated = $false
$taskTriggered = $false; $fallbackTriggered = $false
function Hash([string]$file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Listener([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
}
function Ready-Model {
  try {
    $models = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/models' -TimeoutSec 5 -DisableKeepAlive
    return @($models.data.id) -contains 'qwen3.8-27b'
  } catch { return $false }
}
function Ready-Switcher([int]$modelPid) {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { return $false }
  try {
    $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 `
      -DisableKeepAlive -Headers @{ Authorization = "Bearer $key" }
    return $s.currentModelId -eq 'qwen3.8-27b' -and $s.probe.health -eq $true -and
      [int]$s.state.pid -eq $modelPid -and $s.switching -eq $false
  } catch { return $false }
}
$source = @'
using System;
using System.Runtime.InteropServices;
public static class WeftMateEmergencyArgv {
  [DllImport("shell32.dll",CharSet=CharSet.Unicode)]
  private static extern IntPtr CommandLineToArgvW(string line,out int count);
  [DllImport("kernel32.dll",EntryPoint="LocalFree")]
  private static extern IntPtr LocalFree(IntPtr value);
  public static string[] Parse(string line) {
    int count; IntPtr values=CommandLineToArgvW(line,out count);
    if(values==IntPtr.Zero||count<1||count>64)throw new InvalidOperationException();
    try{string[] result=new string[count];
      for(int i=0;i<count;i++)result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(values,i*IntPtr.Size));
      return result;}finally{LocalFree(values);}
  }
}
'@
Add-Type -TypeDefinition $source
function Exact-Process([int]$processId,[string]$notBefore,[string[]]$argv,[object]$owner) {
  $entry=Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if($null -eq $entry -or -not $entry.CommandLine -or -not $entry.ExecutablePath -or
      [int]$entry.SessionId -ne 0 -or
      ([datetime]$entry.CreationDate).ToUniversalTime().Ticks -le
        ([datetime]$notBefore).ToUniversalTime().Ticks -or
      -not [string]::Equals([string]$entry.ExecutablePath,$argv[0],[StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $who=Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction SilentlyContinue
  if($who.ReturnValue -ne 0 -or
      -not [string]::Equals([string]$who.User,[string]$owner.user,[StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$who.Domain,[string]$owner.domain,[StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $actual=[WeftMateEmergencyArgv]::Parse([string]$entry.CommandLine)
  if($actual.Count -ne $argv.Count){return $false}
  for($index=0;$index -lt $argv.Count;$index++){
    $comparison=if($index -lt 2){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal}
    if(-not [string]::Equals($actual[$index],$argv[$index],$comparison)){return $false}
  }
  return $true
}
function Exact-OriginalTask($plan) {
  $task=Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  $actions=@($task.Actions)
  return $task.Principal.UserId -eq $plan.switcher.principalUserId -and
    [string]$task.Principal.LogonType -eq 'S4U' -and
    [string]$task.Principal.RunLevel -eq 'Limited' -and $actions.Count -eq 1 -and
    [string]::Equals([string]$actions[0].Execute,[string]$plan.switcher.registeredTaskAction.execute,
      [StringComparison]::OrdinalIgnoreCase) -and
    [string]::Equals([string]$actions[0].Arguments,[string]$plan.switcher.registeredTaskAction.arguments,
      [StringComparison]::Ordinal) -and
    [string]::Equals([string]$actions[0].WorkingDirectory,
      [string]$plan.switcher.registeredTaskAction.workingDirectory,[StringComparison]::OrdinalIgnoreCase)
}
function No-SwitcherProcesses($plan) {
  $supervisorScript=[string]$plan.switcher.supervisorArgv[-1]
  $proxyScript=[string]$plan.switcher.proxyArgv[1]
  $supervisors=@(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop|
    Where-Object { $_.CommandLine -and ([string]$_.CommandLine).IndexOf(
      $supervisorScript,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
  $proxies=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop|
    Where-Object { $_.CommandLine -and ([string]$_.CommandLine).IndexOf(
      $proxyScript,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
  return $supervisors.Count -eq 0 -and $proxies.Count -eq 0
}
function Resume-Switcher($plan,[string]$evidencePath) {
  if(-not $evidencePath -or
      [IO.Path]::GetFullPath($evidencePath) -ne [IO.Path]::GetFullPath((Join-Path $root (Split-Path -Leaf $evidencePath))) -or
      (Split-Path -Leaf $evidencePath) -notmatch '^emergency-model-restore-[0-9a-f]{32}\.json$'){
    throw 'RESUME_EVIDENCE_PATH_INVALID'
  }
  $prior=Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8|ConvertFrom-Json
  if($prior.kind -ne 'stage14r3-original-model-emergency' -or $prior.run -ne $true -or
      $prior.stateUpdated -ne $true -or [int]$prior.newModelPid -lt 1){
    throw 'RESUME_EVIDENCE_UNCONFIRMED'
  }
  $modelPid=[int]$prior.newModelPid
  $modelListener=@(Listener 8080)
  $state=Get-Content 'D:\AI\Control\State\ModelSwitcher\current.json' -Raw -Encoding UTF8|ConvertFrom-Json
  if($modelListener.Count -ne 1 -or [int]$modelListener[0].OwningProcess -ne $modelPid -or
      $state.dshModelId -ne 'qwen3.8-27b' -or [int]$state.pid -ne $modelPid -or
      -not (Exact-Process $modelPid $plan.acceptedAt @($plan.original.argv) $plan.original.owner -New) -or
      -not (Ready-Model) -or -not (Exact-OriginalTask $plan)){
    throw 'RESUME_MODEL_IDENTITY_UNCONFIRMED'
  }
  $loopback=@(Listener 8081)
  if($loopback.Count -eq 1 -and (Ready-Switcher $modelPid)){
    $existingProxy=[int]$loopback[0].OwningProcess
    $existingState=Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8|ConvertFrom-Json
    $existingSupervisor=[int]$existingState.supervisorPid
    if(-not (Exact-Process $existingProxy $plan.acceptedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner -New) -or
        -not (Exact-Process $existingSupervisor $plan.acceptedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner -New)){
      throw 'RESUME_EXISTING_SWITCHER_IDENTITY_UNCONFIRMED'
    }
    return [pscustomobject]@{modelPid=$modelPid;proxyPid=[int]$loopback[0].OwningProcess;
      supervisorPid=$existingSupervisor;triggered=$false}
  }
  if($loopback.Count -ne 0 -or -not (No-SwitcherProcesses $plan)){
    throw 'RESUME_UNKNOWN_SWITCHER_PROCESS'
  }
  $task=Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  if([string]$task.State -eq 'Running'){throw 'RESUME_ORIGINAL_TASK_BUSY'}
  Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  $until=(Get-Date).AddSeconds(45)
  do{
    $loopback=@(Listener 8081)
    if($loopback.Count -eq 1 -and (Ready-Switcher $modelPid)){break}
    Start-Sleep -Milliseconds 500
  }while((Get-Date) -lt $until)
  if($loopback.Count -ne 1 -or -not (Ready-Switcher $modelPid)){
    throw 'RESUME_SWITCHER_UNCONFIRMED'
  }
  $proxyPid=[int]$loopback[0].OwningProcess
  $switcherState=Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8|ConvertFrom-Json
  $supervisorPid=[int]$switcherState.supervisorPid
  if(-not (Exact-Process $proxyPid $plan.acceptedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner -New) -or
      -not (Exact-Process $supervisorPid $plan.acceptedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner -New)){
    throw 'RESUME_SWITCHER_IDENTITY_UNCONFIRMED'
  }
  return [pscustomobject]@{modelPid=$modelPid;proxyPid=$proxyPid;supervisorPid=$supervisorPid;
    triggered=$true}
}
try {
  if($Run -and $ResumeSwitcher){throw 'MODE_CONFLICT'}
  $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  if((Hash $manifestFile) -ne $manifestHash -or (Hash $oldManifestFile) -ne $oldManifestHash){throw 'MANIFEST_CHANGED'}
  $plan=Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8|ConvertFrom-Json
  $old=Get-Content -LiteralPath $oldManifestFile -Raw -Encoding UTF8|ConvertFrom-Json
  $old.workerSha256=$plan.workerSha256
  if($plan.runId -ne '9d8af3ed-de38-4637-bc4a-8cba9c66bb09' -or
      $old.runId -ne $plan.runId -or $plan.original.pid -ne 25644 -or
      $plan.original.argv.Count -ne 26 -or
      (ConvertTo-Json $plan -Depth 12 -Compress) -cne (ConvertTo-Json $old -Depth 12 -Compress) -or
      (Hash 'D:\AI\Config\qwen3.8-27b-ninfer.json') -ne $plan.expectedConfigSha256 -or
      (Hash (Join-Path $PSScriptRoot 'stage14r3-worker.ps1')) -ne $plan.workerSha256) {
    throw 'RECOVERY_MANIFEST_IDENTITY_INVALID'
  }
  if($ResumeSwitcher){
    $phase='resume_original_switcher'
    $resumed=Resume-Switcher $plan $EvidenceFile
    $newModelPid=$resumed.modelPid
    $newProxyPid=$resumed.proxyPid
    $newSupervisorPid=$resumed.supervisorPid
    $taskTriggered=$resumed.triggered
    $stateUpdated=$true
    $phase='restored';$code='OK'
  }else{
  $stateFile='D:\AI\Control\State\ModelSwitcher\current.json'
  if((Hash $stateFile) -ne $plan.currentStateSha256){throw 'MODEL_SWITCHER_STATE_CHANGED'}
  $state=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8|ConvertFrom-Json
  if($state.dshModelId -ne 'qwen3.8-27b' -or [int]$state.pid -ne 25644){throw 'MODEL_SWITCHER_STATE_PID_CHANGED'}
  if(@(Listener 8080).Count -ne 0 -or @(Listener 8081).Count -ne 0 -or
      @(Get-CimInstance Win32_Process -Filter "Name = 'ninfer-serve.exe'" -ErrorAction Stop).Count -ne 0){
    throw 'MODEL_OR_PROXY_ALREADY_PRESENT'
  }
  if(-not (No-SwitcherProcesses $plan)){throw 'SWITCHER_PROCESS_ALREADY_PRESENT'}
  if(-not (Exact-OriginalTask $plan)){throw 'ORIGINAL_TASK_CHANGED'}
  $phase='verified'
  if($Run){
    $nonce=[guid]::NewGuid().ToString('N')
    $taskName="WeftMate-Stage14R3-UrgentRecover-$($nonce.Substring(0,8))"
    $statusFile=Join-Path $root "worker-status-Recover-$($plan.runId)-$nonce.json"
    $worker=Join-Path $PSScriptRoot 'stage14r3-worker.ps1'
    $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden' +
      ' -File "' + $worker + '" -Action Recover -Manifest "' + $manifestFile +
      '" -ManifestSha256 ' + $manifestHash + ' -StatusFile "' + $statusFile + '" -Nonce ' + $nonce
    $taskAction=New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $PSScriptRoot
    $taskPrincipal=New-ScheduledTaskPrincipal -UserId "$($plan.original.owner.domain)\$($plan.original.owner.user)" `
      -LogonType S4U -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
      -MultipleInstances IgnoreNew -RestartCount 0
    Register-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -Action $taskAction `
      -Principal $taskPrincipal -Settings $settings -ErrorAction Stop|Out-Null
    $taskRegistered=$true
    $phase='start_original_model'
    $triggeredAt=Get-Date
    Start-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -ErrorAction Stop
    $restoreFile=Join-Path $root "restore-$($plan.runId)-$nonce.json"
    $restored=$null
    $until=(Get-Date).AddSeconds(175)
    do{
      if(Test-Path -LiteralPath $statusFile){
        $workerStatus=Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8|ConvertFrom-Json
        if($workerStatus.phase -eq 'failed' -and $workerStatus.nonce -eq $nonce){throw 'ORIGINAL_WORKER_FAILED'}
      }
      if(Test-Path -LiteralPath $restoreFile){
        $restored=Get-Content -LiteralPath $restoreFile -Raw -Encoding UTF8|ConvertFrom-Json
        if($restored.runId -eq $plan.runId -and $restored.nonce -eq $nonce -and
            $restored.action -eq 'Recover' -and $restored.ready -eq $true){break}
      }
      Start-Sleep -Milliseconds 500
    }while((Get-Date) -lt $until)
    if(-not (Test-Path -LiteralPath $restoreFile) -or $null -eq $restored -or
        $restored.ready -ne $true){throw 'ORIGINAL_WORKER_TIMEOUT'}
    $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\AI\' -ErrorAction Stop
    if($info.LastRunTime -lt $triggeredAt.AddSeconds(-2) -or [int]$info.LastTaskResult -ne 0){throw 'ORIGINAL_TASK_RESULT_UNCONFIRMED'}
    $newModelPid=[int]$restored.pid
    $modelListener=@(Listener 8080)
    if($modelListener.Count -ne 1 -or [int]$modelListener[0].OwningProcess -ne $newModelPid -or
        -not (Exact-Process $newModelPid $plan.acceptedAt @($plan.original.argv) $plan.original.owner) -or
        -not (Ready-Model)){throw 'RESTORED_NINFER_UNCONFIRMED'}
    $phase='update_state'
    $state.pid=$newModelPid
    $state.outcome='stage14r3-restored'
    $state.switchedAt=(Get-Date).ToString('o')
    $state.elapsedSeconds=0
    $state.switcherPid=$PID
    $temp="$stateFile.$nonce.tmp"
    $backup=Join-Path $root "current-before-emergency-$nonce.json"
    try{
      $state|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $temp -Encoding UTF8
      [IO.File]::Replace($temp,$stateFile,$backup)
    }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}}
    $stateUpdated=$true
    $phase='start_original_switcher_task'
    if(-not (Exact-OriginalTask $plan)){throw 'ORIGINAL_TASK_CHANGED'}
    if(-not (No-SwitcherProcesses $plan) -or @(Listener 8081).Count -ne 0){
      throw 'SWITCHER_PROCESS_ALREADY_PRESENT'
    }
    Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
    $taskTriggered = $true
    $until=(Get-Date).AddSeconds(45)
    do{
      $proxy=@(Listener 8081)
      if($proxy.Count -eq 1 -and (Ready-Switcher $newModelPid)){break}
      Start-Sleep -Milliseconds 500
    }while((Get-Date) -lt $until)
    if($proxy.Count -ne 1 -or -not (Ready-Switcher $newModelPid)){throw 'RESTORED_SWITCHER_UNCONFIRMED'}
    $newProxyPid=[int]$proxy[0].OwningProcess
    $switcherState=Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8|ConvertFrom-Json
    $newSupervisorPid=[int]$switcherState.supervisorPid
    if(-not (Exact-Process $newProxyPid $plan.acceptedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner) -or
        -not (Exact-Process $newSupervisorPid $plan.acceptedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner)){
      throw 'RESTORED_SWITCHER_IDENTITY_UNCONFIRMED'
    }
    $phase='restored';$code='OK'
    Unregister-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -Confirm:$false -ErrorAction Stop
    $taskRegistered=$false
  }else{$code='READY_READ_ONLY'}
  }
}catch{
  $code=if($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$'){$_.Exception.Message}else{'EMERGENCY_MODEL_RESTORE_FAILED'}
  if($Run -and $stateUpdated -and $newModelPid -and $phase -ne 'restored'){
    try{
      $modelListener=@(Listener 8080)
      $task=Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
      $currentState=Get-Content 'D:\AI\Control\State\ModelSwitcher\current.json' -Raw -Encoding UTF8|ConvertFrom-Json
      if($modelListener.Count -ne 1 -or [int]$modelListener[0].OwningProcess -ne $newModelPid -or
          -not (Exact-Process $newModelPid $plan.acceptedAt @($plan.original.argv) $plan.original.owner) -or
          -not (Ready-Model) -or [int]$currentState.pid -ne $newModelPid -or
          @(Listener 8081).Count -ne 0 -or -not (No-SwitcherProcesses $plan) -or
          [string]$task.State -eq 'Running' -or -not (Exact-OriginalTask $plan)){
        throw 'FALLBACK_GATE_UNCONFIRMED'
      }
      $phase='fallback_original_task'
      Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
      $fallbackTriggered=$true
      $until=(Get-Date).AddSeconds(45)
      do{
        $proxy=@(Listener 8081)
        if($proxy.Count -eq 1 -and (Ready-Switcher $newModelPid)){break}
        Start-Sleep -Milliseconds 500
      }while((Get-Date) -lt $until)
      if($proxy.Count -ne 1 -or -not (Ready-Switcher $newModelPid)){throw 'FALLBACK_SWITCHER_UNCONFIRMED'}
      $newProxyPid=[int]$proxy[0].OwningProcess
      $switcherState=Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8|ConvertFrom-Json
      $newSupervisorPid=[int]$switcherState.supervisorPid
      if(-not (Exact-Process $newProxyPid $plan.acceptedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner) -or
          -not (Exact-Process $newSupervisorPid $plan.acceptedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner)){
        throw 'FALLBACK_IDENTITY_UNCONFIRMED'
      }
      $phase='restored';$code='OK_AFTER_FALLBACK'
      if($taskRegistered){
        Unregister-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -Confirm:$false -ErrorAction Stop
        $taskRegistered=$false
      }
    }catch{if($code -eq 'UNCONFIRMED'){$code='FALLBACK_UNCONFIRMED'}}
  }
}finally{
  [ordered]@{schemaVersion=1;kind='stage14r3-original-model-emergency';at=(Get-Date).ToString('o');
    phase=$phase;code=$code;run=$Run.IsPresent;resumeSwitcher=$ResumeSwitcher.IsPresent;
    newModelPid=$newModelPid;
    newProxyPid=$newProxyPid;newSupervisorPid=$newSupervisorPid;
    stateUpdated=$stateUpdated;taskTriggered=$taskTriggered;
    fallbackTriggered=$fallbackTriggered;ownedTaskRetained=$taskRegistered;taskName=$taskName}|
    ConvertTo-Json -Depth 4|Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Output("modelRecoveryReport={0} phase={1} code={2}" -f $reportFile,$phase,$code)
}
if($code -notin @('OK','OK_AFTER_FALLBACK','READY_READ_ONLY')){exit 2}
