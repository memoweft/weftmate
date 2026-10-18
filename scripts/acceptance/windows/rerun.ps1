param(
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
 [Parameter(Mandatory=$true)][string]$LockDirectory,
 [string[]]$Cases=@('onboarding','firstReply','createWaterReminder','createTimedReminder','queueAndStop','rapidThree','switchDuringReply','healthNoData','healthWithData','memoryForm','memoryCorrect')
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$installerPath=(Resolve-Path -LiteralPath $Installer).Path
$evidence=[IO.Path]::GetFullPath($EvidenceDirectory)
if(Test-Path -LiteralPath $evidence){throw 'Use a new evidence directory for each clean sandbox run'}
if(Get-Process WindowsSandboxClient,WindowsSandboxRemoteSession -ErrorAction SilentlyContinue){throw 'A sandbox is already running; preserve it'}
$slot=$null
foreach($n in 1..3){try{$candidate=Join-Path $LockDirectory "heavy-$n.lock";New-Item -ItemType File -Path $candidate -Value "Windows baseline $(Get-Date -Format o)" -ErrorAction Stop|Out-Null;$slot=$candidate;break}catch{}}
if(!$slot){throw 'All heavy slots are occupied; retry after two minutes'}
$inputDirectory=Join-Path $evidence 'input';$guestDirectory=Join-Path $evidence 'guest'
$sandboxStarted=$false
function Wait-File([string]$Name,[int]$Seconds){$end=(Get-Date).AddSeconds($Seconds);while(!(Test-Path -LiteralPath (Join-Path $guestDirectory $Name))){if((Get-Date)-gt $end){throw "Timed out waiting for $Name"};Start-Sleep -Milliseconds 500}}
function Invoke-Case([string]$Name){
 if($Name-notmatch '^[a-zA-Z]+$'){throw 'Invalid scenario action'}
 $id=[Guid]::NewGuid().ToString();$code="const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(ctx.input+'/scripts/scenarios.mjs'));return m.$Name(ctx);"
 [IO.File]::WriteAllText((Join-Path $guestDirectory 'request.json'),(@{id=$id;code=$code}|ConvertTo-Json -Compress))
 $end=(Get-Date).AddMinutes(4)
 while((Get-Date)-lt $end){try{$r=Get-Content (Join-Path $guestDirectory 'response.json') -Raw|ConvertFrom-Json;if($r.id-eq $id){$r|ConvertTo-Json -Depth 30|Set-Content (Join-Path $guestDirectory "$Name-result.json");return $r.ok}}catch{};Start-Sleep -Milliseconds 500}
 throw "Scenario action timed out: $Name"
}
try{
 New-Item -ItemType Directory -Path "$inputDirectory\scripts","$inputDirectory\node_modules",$guestDirectory -Force|Out-Null
 Copy-Item -LiteralPath $installerPath -Destination $inputDirectory
 Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination "$inputDirectory\node.exe"
 foreach($name in 'playwright','playwright-core'){Copy-Item -LiteralPath "$repo\node_modules\$name" -Destination "$inputDirectory\node_modules" -Recurse}
 Copy-Item -Path "$PSScriptRoot\*" -Destination "$inputDirectory\scripts"
 [IO.File]::WriteAllText("$inputDirectory\package.json",'{"type":"module"}')
 $xmlInput=[Security.SecurityElement]::Escape($inputDirectory);$xmlGuest=[Security.SecurityElement]::Escape($guestDirectory)
 $sandboxInput=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) 'B1Input';$sandboxOutput=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) 'B1Output'
 $xml="<Configuration><MemoryInMB>6144</MemoryInMB><MappedFolders><MappedFolder><HostFolder>$xmlInput</HostFolder><SandboxFolder>$sandboxInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>$xmlGuest</HostFolder><SandboxFolder>$sandboxOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders><LogonCommand><Command>powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $sandboxInput\scripts\guest.ps1 -InputDirectory $sandboxInput -OutputDirectory $sandboxOutput</Command></LogonCommand></Configuration>"
 [IO.File]::WriteAllText((Join-Path $evidence 'baseline.wsb'),$xml)
 $started=Start-Process (Join-Path $env:SystemRoot 'System32\WindowsSandboxClient.exe') -ArgumentList (Join-Path $evidence 'baseline.wsb') -WindowStyle Hidden -PassThru;$sandboxStarted=$true
 Wait-File 'guest-public.pem' 240
 $priorKey=$env:B1_MODEL_KEY
 try{$env:B1_MODEL_KEY=[Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine');node "$PSScriptRoot\handoff.mjs" $guestDirectory;if($LASTEXITCODE-ne 0){throw 'Credential handoff failed'}}finally{$env:B1_MODEL_KEY=$priorKey}
 Wait-File 'ready.json' 120
 foreach($case in $Cases){$ok=Invoke-Case $case;Write-Output "$case completed=$ok"}
 Get-FileHash -LiteralPath $installerPath -Algorithm SHA256|Select-Object Algorithm,Hash|ConvertTo-Json|Set-Content (Join-Path $evidence 'installer-hash.json')
}finally{
 if($sandboxStarted){[IO.File]::WriteAllText((Join-Path $guestDirectory 'shutdown.request'),'');[IO.File]::WriteAllText((Join-Path $guestDirectory 'stop.json'),'{}');try{Wait-File 'controller-done.json' 45}catch{Write-Warning 'Guest cleanup unconfirmed; heavy lock retained';$slot=$null}}
 if($slot){Remove-Item -LiteralPath $slot}
}
