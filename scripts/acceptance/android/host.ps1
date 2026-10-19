param([Parameter(Mandatory)][string]$Evidence,[Parameter(Mandatory)][string]$Locks,[string]$ProfileName='host-profile')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$owner='R-B2 source host '+[DateTimeOffset]::UtcNow.ToString('o');$owned=$null;$process=$null
try {
  foreach($n in 1..3){$p=Join-Path $Locks "heavy-$n.lock";try{New-Item -ItemType File -Path $p -Value $owner -ErrorAction Stop|Out-Null;$owned=$p;break}catch [IO.IOException]{}}
  if(!$owned){throw 'No heavy slot'}
  $psi=[Diagnostics.ProcessStartInfo]::new((Get-Command node).Source)
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.WorkingDirectory=$repo
  $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  foreach($a in @('scripts/run-personal-host.mjs','--user-data-dir',(Join-Path $Evidence $ProfileName),'--access-port','0','--headless')){$psi.ArgumentList.Add($a)}
  $process=[Diagnostics.Process]::Start($psi)
  $log=Join-Path $Evidence 'host.log'
  Set-Content -LiteralPath $log -Value ''
  $readOut=$process.StandardOutput.ReadLineAsync();$readErr=$process.StandardError.ReadLineAsync()
  $process.Id|Set-Content (Join-Path $Evidence 'host-pid.txt')
  $deadline=[DateTimeOffset]::UtcNow.AddMinutes(26)
  while(!$process.HasExited -and [DateTimeOffset]::UtcNow -lt $deadline -and !(Test-Path (Join-Path $Evidence 'stop-host'))){
    while($readOut -and $readOut.IsCompleted){$line=$readOut.GetAwaiter().GetResult();if($null -eq $line){$readOut=$null;break};Add-Content -LiteralPath $log -Value $line;$readOut=$process.StandardOutput.ReadLineAsync()}
    while($readErr -and $readErr.IsCompleted){$line=$readErr.GetAwaiter().GetResult();if($null -eq $line){$readErr=$null;break};Add-Content -LiteralPath $log -Value $line;$readErr=$process.StandardError.ReadLineAsync()}
    $queue=Join-Path $Evidence 'host-command.json'
    if(Test-Path $queue){$line=Get-Content $queue -Raw;Remove-Item -LiteralPath $queue;$process.StandardInput.WriteLine($line);$process.StandardInput.Flush()}
    Start-Sleep 1
  }
} finally {
  if($process -and !$process.HasExited){try{$process.StandardInput.WriteLine('q');$process.StandardInput.Flush()}catch [IO.IOException]{};if(!$process.WaitForExit(15000)){$process.Kill($true)}}
  if($process){
    foreach($pair in @(@($readOut,$process.StandardOutput),@($readErr,$process.StandardError))){if($pair[0]){Add-Content -LiteralPath $log -Value $pair[0].GetAwaiter().GetResult()};Add-Content -LiteralPath $log -Value $pair[1].ReadToEnd()}
  }
  if($owned -and (Get-Content $owned -Raw).Trim() -eq $owner){Remove-Item -LiteralPath $owned}
}
