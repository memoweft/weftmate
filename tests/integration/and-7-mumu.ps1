param([switch]$Single)
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location $repo
$log=Join-Path $repo '.local/and-7/mumu-runner.txt'
while($true) {
    $argv=@(Join-Path $repo 'tests/integration/and-7-android.mjs')
    if($Single){$argv+='--single'}
    $output=& node @argv 2>&1
    $status=$LASTEXITCODE
    $output | Add-Content -LiteralPath $log
    $output | Select-Object -Last 12
    if($status -eq 0){exit 0}
    if(($output -join "`n") -notmatch 'MUMU_BUSY:'){exit $status}
    Write-Output 'Another test package is installed; waiting two minutes with locks and ADB released.'
    Start-Sleep -Seconds 120
}
