param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$InstalledExe,[Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference='Stop'
$started=Get-Date
$rootFull=[IO.Path]::GetFullPath($Root)
if($rootFull -notmatch '^[A-Z]:\\wi1-[a-f0-9]{16}$' -or !$InstalledExe.StartsWith($rootFull+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Synthetic custom installation required'}
$profile=Join-Path $rootFull 'synthetic-data'
if((Get-Content -LiteralPath $ConfigFile -Raw|ConvertFrom-Json).dataDirectory -ne $profile){throw 'Synthetic configuration ownership failed'}
$migration=Join-Path $PSScriptRoot '../../scripts/migrate-installed-desktop.ps1'
$directory=Join-Path $Root 'migration';$source=Join-Path $Root 'synthetic-task.ps1'
@'
$runtime = 'C:\synthetic-runtime'
$profile = Join-Path $runtime 'personal-account-synthetic'
$port = '0'
$mobileUi = Join-Path $runtime 'mobile'
$memoryConfig = Join-Path $runtime 'memory.json'
$androidPackage = Join-Path $runtime 'synthetic.apk'
$options = @('--public-origin', 'https://synthetic.invalid')
'@ | Set-Content -LiteralPath $source
# Only scheduler responses are substituted. The unchanged migration script
# really invokes NSIS, starts the custom exe, queries its random local port,
# and runs --uninstall-cleanup during Rollback. No actual scheduled task exists.
$script:events=@();$taskName='INST-1b-synthetic-'+[Guid]::NewGuid().ToString('N');$script:taskExists=$true
function Get-ScheduledTask {param($TaskName,$ErrorAction);if($TaskName -ne $script:taskName){throw 'Foreign task'};if($script:taskExists){[pscustomobject]@{State='Ready'}}}
function Export-ScheduledTask {param($TaskName);$script:events+='export';'<Task synthetic="true" />'}
function Disable-ScheduledTask {param($TaskName);$script:events+='disable'}
function Stop-ScheduledTask {param($TaskName);$script:events+='stop'}
function Enable-ScheduledTask {param($TaskName);$script:events+='enable'}
function Start-ScheduledTask {param($TaskName);$script:events+='start'}
function Unregister-ScheduledTask {param($TaskName,$Confirm);$script:events+='unregister';$script:taskExists=$false}
function Register-ScheduledTask {param($TaskName,$Xml);if($TaskName-ne$script:taskName){throw 'Foreign task'};$script:events+='register';$script:taskExists=$true}
$common=@{TaskName=$taskName;InstalledExe=$InstalledExe;ConfigFile=$ConfigFile;MigrationDirectory=$directory}
& $migration -Action Prepare @common -SourceTaskScript $source -DataDirectory $profile -Rehearsal
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$config=Get-Content -LiteralPath $ConfigFile -Raw|ConvertFrom-Json;$config.accessPort=$port
[IO.File]::WriteAllText($ConfigFile,($config|ConvertTo-Json -Depth 8))
& $migration -Action Apply @common -Installer $Installer
$end=[DateTime]::UtcNow.AddSeconds(90)
do{$connection=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 200}while(!$connection -and [DateTime]::UtcNow -lt $end)
if(!$connection){throw 'Migrated synthetic program did not listen'}
$owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
if($owner.ExecutablePath -ne $InstalledExe -or $owner.CreationDate -lt $started -or !$owner.CommandLine.Contains($ConfigFile)){throw 'Synthetic migration port ownership failed'}
& $migration -Action Verify @common
& $migration -Action Finalize @common
& $migration -Action Rollback @common
if([IO.File]::ReadAllText((Join-Path $profile 'keep-me.txt')) -ne 'INST-1 synthetic data must survive upgrades and uninstall'){throw 'Migration changed synthetic data'}
if((Get-Content -LiteralPath $ConfigFile -Raw|ConvertFrom-Json).dataDirectory -ne $profile){throw 'Rollback moved data'}
@{prepare=$true;apply=$true;verify=$true;finalize=$true;rollback=$true;actualSilentInstaller=$true;actualCustomProgram=$true;actualCleanup=$true;schedulerSubstituted=$true;dataPreserved=$true;events=$script:events}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $Root 'migration-result.json') -Encoding UTF8
