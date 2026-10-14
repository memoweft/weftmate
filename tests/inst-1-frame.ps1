param([Parameter(Mandatory=$true)][string]$Installer,[string]$Out=(Join-Path $(if ($env:WEFTMATE_EVIDENCE_DIR) { $env:WEFTMATE_EVIDENCE_DIR } else { '.local/evidence' }) 'inst-1'))
$ErrorActionPreference='Stop';$started=Get-Date
$Installer=(Resolve-Path -LiteralPath $Installer).Path;$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Out=[IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $workspace $Out }))
[IO.Directory]::CreateDirectory($Out)|Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'helpers/installer-window.cs') -ReferencedAssemblies System.Drawing
$root=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('wi1-frame-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
$target=Join-Path $root 'WeftMate';[IO.Directory]::CreateDirectory($target)|Out-Null
$desktop=[InstallerDesktop]::new('WeftMateInst1Frame-'+[Guid]::NewGuid().ToString('N'));$rows=@();$failures=@();$pids=@();$cleaned=0
$env:WEFTMATE_INSTALLER_TEST_PICK_FOLDER=$null
$env:WEFTMATE_INSTALLER_TEST_PICK_ROOT=$target
function Await([string]$kind,[string]$title=''){$end=[DateTime]::UtcNow.AddSeconds(30);do{$h=$desktop.Find($kind,$title);if($h){return $h};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $end);throw "Missing $kind window"}
function Exit-Check([int]$processId,[int]$expected){$p=Get-Process -Id $processId -ErrorAction SilentlyContinue;if($p -and !$p.WaitForExit(30000)){throw 'Window did not close'};if($desktop.ExitCode($processId)-ne$expected){throw 'Unexpected installer exit'}}
try{
  foreach($theme in 'light','dark'){
    $env:WEFTMATE_INSTALLER_TEST_THEME=$theme
    foreach($dpi in 120,144,192){
      $env:WEFTMATE_INSTALLER_TEST_DPI=[string]$dpi
      $pidInstall=$desktop.Launch($Installer,"/currentuser /D=$target",$workspace);$pids+=$pidInstall
      $h=Await progress '准备安装 WeftMate';Start-Sleep -Milliseconds 350
      if(!$desktop.Frameless($h)-or$desktop.HeaderHit($h)-ne2){throw 'Own frame/drag missing'}
      $tabs=@($desktop.FocusId($h));foreach($n in 1..3){$desktop.Key($h,9);Start-Sleep -Milliseconds 150;$tabs+=$desktop.FocusId($h)}
      if(($tabs-join',')-ne'80,90,81,80'){throw "Tab order: $($tabs-join',')"}
      $desktop.Capture($h,(Join-Path $Out "ready-dpi-$dpi-$theme.png"))
      if($dpi-eq144){
        $desktop.Button($h,81);$picker=Await picker;Start-Sleep -Milliseconds 350
        $text=$desktop.DetailText($picker)-join' '
        if($text.Contains('暂时无法完成安装') -or !$text.Contains('DirectUIHWND')){throw 'Real system picker was intercepted'}
        $desktop.Capture($picker,(Join-Path $Out "system-picker-$theme.png"));$desktop.Button($picker,1);Start-Sleep -Milliseconds 500
        if($desktop.Find('picker','')){throw 'System picker did not confirm'}
        if(!(($desktop.DetailText($h)-join' ').Contains($target))){throw 'Selected existing WeftMate folder became nested'}
      }
      $desktop.Key($h,27);Exit-Check $pidInstall 1
      $rows+=@{theme=$theme;renderDpi=$dpi;tabOrder=$tabs;frameless=$true;draggable=$true;escapeCanceled=$true;realSystemPicker=($dpi-eq144)}
    }
    $env:WEFTMATE_INSTALLER_TEST_DPI='144';$env:WEFTMATE_INSTALLER_TEST_ABORT='1'
    $pidInstall=$desktop.Launch($Installer,"/currentuser /D=$target",$workspace);$pids+=$pidInstall
    $h=Await progress '准备安装 WeftMate';$desktop.Button($h,80)
    $failed=Await prompt;Start-Sleep -Milliseconds 350
    $failedFrameless=$desktop.Frameless($failed);if(!$failedFrameless){throw 'Failure window has a system title bar'}
    $desktop.Capture($failed,(Join-Path $Out "failure-$theme.png"));$desktop.Escape($failed);Exit-Check $pidInstall 2
    $failures+=@{theme=$theme;syntheticFailureExit=2;frameless=$failedFrameless}
    $env:WEFTMATE_INSTALLER_TEST_ABORT=$null
  }
}finally{
  foreach($pidOwn in $pids){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$pidOwn" -ErrorAction SilentlyContinue;if($p -and $p.CreationDate -ge $started -and $p.ExecutablePath-eq$Installer -and $p.CommandLine.Contains($root)){Stop-Process -Id $pidOwn -Force;$cleaned++}}
  $measurements=@($desktop.CaptureMeasurements()|ForEach-Object {$_|ConvertFrom-Json});$desktop.Dispose()
  @{privateDesktop=$true;globalInputUsed=$false;hostDpi=144;renderScaleOverride=$true;checks=$rows;failures=$failures;captureGeometry=$measurements;cleanedProcesses=$cleaned}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $Out 'frame-results.json') -Encoding UTF8
  if($root -notmatch '^[A-Z]:\\wi1-frame-[a-f0-9]{12}$'){throw 'Synthetic cleanup boundary'}
  Remove-Item -LiteralPath $root -Recurse -Force
}
