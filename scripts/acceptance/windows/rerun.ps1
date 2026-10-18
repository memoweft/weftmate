param(
 [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
 [ValidateSet('local','dev')][string]$Mode='local',
 [ValidateRange(1,30)][int]$ScenarioTimeoutMinutes=30,
 [string[]]$Cases=@('onboarding','firstReply','createWaterReminder','createTimedReminder','healthNoData','healthWithData','queueAndStop','rapidThree','switchDuringReply','memoryForm','memoryCorrect','memoryForgetPage','memoryForgetChat','historyPagination','uiPages')
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$evidence=[IO.Path]::GetFullPath($EvidenceDirectory)
if(Test-Path (Join-Path $evidence 'ready.json')){throw 'Use a fresh run directory; preserve the previous observations'}
$controller=$null
function Wait-Ready {
 $end=(Get-Date).AddSeconds(120)
 while(!(Test-Path (Join-Path $evidence 'ready.json'))){if((Get-Date)-gt $end-or $controller.HasExited){throw 'Installed application startup failed; inspect fatal.json'};Start-Sleep -Milliseconds 500}
}
try{
 if(!(Test-Path (Join-Path $evidence 'installation.json'))){if($Mode-eq 'dev'){throw 'Prepare the explicit-Core descriptor first'};node "$PSScriptRoot\install-local.mjs" $evidence;if($LASTEXITCODE-ne 0){throw 'Default installation failed'}}
 $controllerArguments=@("$PSScriptRoot\controller.mjs",$repo,$evidence,$Mode)|ForEach-Object {'"'+$_+'"'}
 $controller=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $controllerArguments -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $evidence 'controller.stdout.log') -RedirectStandardError (Join-Path $evidence 'controller.stderr.log') -PassThru
 Wait-Ready
 foreach($case in $Cases){
  if($case-notmatch '^[a-zA-Z]+$'){throw 'Invalid scenario name'}
  $id=[Guid]::NewGuid().ToString();$code="const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(ctx.input+'/scripts/acceptance/windows/scenarios.mjs'));return m.$case(ctx);"
  [IO.File]::WriteAllText((Join-Path $evidence 'request.json'),(@{id=$id;code=$code}|ConvertTo-Json -Compress))
  $end=(Get-Date).AddMinutes($ScenarioTimeoutMinutes);$received=$false
  while((Get-Date)-lt $end){try{$r=Get-Content (Join-Path $evidence 'response.json') -Raw -ErrorAction Stop|ConvertFrom-Json;if($r.id-eq $id){$r|ConvertTo-Json -Depth 30|Set-Content (Join-Path $evidence "$case-result.json");Write-Output "$case completed=$($r.ok)";$received=$true;break}}catch{};Start-Sleep -Milliseconds 500}
  if(!$received){throw "Scenario action timed out: $case"}
 }
}finally{
 if($controller){[IO.File]::WriteAllText((Join-Path $evidence 'stop.json'),'{}');if(!$controller.WaitForExit(45000)){taskkill.exe /PID $controller.Id /T /F|Out-Null}}
}
