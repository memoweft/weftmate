<# Run only on migration day. Prepare is read-only with respect to the task and original data. #>
[CmdletBinding()]
param(
  [ValidateSet('Prepare','Apply','Verify','Finalize','Rollback')][string]$Action = 'Prepare',
  [string]$TaskName = 'WeftMate Personal Host',
  [string]$SourceTaskScript,
  [string]$DataDirectory,
  [string]$Installer,
  [string]$InstalledExe = (Join-Path $env:LOCALAPPDATA 'Programs\WeftMate\WeftMate.exe'),
  [string]$ConfigFile = (Join-Path $env:APPDATA 'WeftMate\desktop-config.json'),
  [string]$MigrationDirectory = (Join-Path $env:APPDATA 'WeftMate\source-migration'),
  [switch]$Rehearsal
)
$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $MigrationDirectory 'state.json'
$taskXml = Join-Path $MigrationDirectory 'original-task.xml'
function Save-State($value) { $value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stateFile -Encoding UTF8 }
function Stop-Installed {
  $target = [IO.Path]::GetFullPath($InstalledExe)
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object {
    & taskkill.exe /PID $_.ProcessId /T /F | Out-Null
  }
  # Disable the installed login item before restoring the source task, preserving data.
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $cleanup = Start-Process -FilePath $target -ArgumentList '--uninstall-cleanup' -WindowStyle Hidden -PassThru -Wait
    if ($cleanup.ExitCode -ne 0) { throw 'Installed login item cleanup failed' }
  }
}
if ($Rehearsal -and $Action -in @('Apply','Finalize','Rollback')) { throw 'Rehearsal must never control the real scheduled task. Use the integration runner.' }
if ($Action -eq 'Prepare') {
  if (-not $SourceTaskScript) { throw 'SourceTaskScript is required; it will be read, never executed.' }
  New-Item -ItemType Directory -Path $MigrationDirectory -Force | Out-Null
  $previousConfig = Join-Path $MigrationDirectory 'previous-config.json'
  $hadConfig = Test-Path -LiteralPath $ConfigFile
  if ($hadConfig) { Copy-Item -LiteralPath $ConfigFile -Destination $previousConfig -Force }
  $args = @((Join-Path $PSScriptRoot 'migrate-desktop-config.mjs'), '--source', $SourceTaskScript, '--output', $ConfigFile)
  if ($DataDirectory) { $args += @('--data', $DataDirectory) }
  if ($Rehearsal) { $args += @('--rehearsal', 'true') }
  & node @args
  if ($LASTEXITCODE -ne 0) { throw 'Configuration import failed' }
  Save-State @{ phase='prepared'; hadConfig=$hadConfig; taskName=$TaskName; executable=$InstalledExe; config=$ConfigFile; wasEnabled=$null }
  Write-Output '配置已准备；任务和原数据未改。核对配置后再 Apply。'
  return
}
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($Action -eq 'Apply') {
  if ($state.phase -ne 'prepared') { throw 'Prepare must run first.' }
  if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Installer missing' }
  $task = Get-ScheduledTask -TaskName $state.taskName
  Export-ScheduledTask -TaskName $state.taskName | Set-Content -LiteralPath $taskXml -Encoding Unicode
  $state.wasEnabled = $task.State -ne 'Disabled'; $state.phase = 'stopped'; Save-State $state
  Disable-ScheduledTask -TaskName $state.taskName | Out-Null
  Stop-ScheduledTask -TaskName $state.taskName
  try {
    $install = Start-Process -FilePath $Installer -ArgumentList '/S','/currentuser' -WindowStyle Hidden -PassThru -Wait
    if ($install.ExitCode -ne 0) { throw 'Installation failed' }
    Start-Process -FilePath $InstalledExe -ArgumentList ('--desktop-config="' + $ConfigFile + '"') -WindowStyle Hidden
    $state.phase = 'awaiting-verification'; Save-State $state
    Write-Output '安装版已启动；原任务已停用并保留。Verify 和本人登录验收后才能 Finalize。'
  } catch {
    Stop-Installed
    if ($state.wasEnabled) { Enable-ScheduledTask -TaskName $state.taskName | Out-Null }
    Start-ScheduledTask -TaskName $state.taskName
    throw
  }
} elseif ($Action -eq 'Verify') {
  $config = Get-Content -LiteralPath $state.config -Raw | ConvertFrom-Json
  $uri = 'http://127.0.0.1:' + $config.accessPort + '/personal/v1/config'
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing
  if ($response.StatusCode -ne 200) { throw 'Local host unavailable' }
  Write-Output '端口与公开配置可访问。请在程序中登录旧账户，并核对设置 → 系统状态的记忆桥、中继与证书；成功后 Finalize。'
} elseif ($Action -eq 'Finalize') {
  if ($state.phase -ne 'awaiting-verification') { throw 'Installed program has not reached verification.' }
  Unregister-ScheduledTask -TaskName $state.taskName -Confirm:$false
  $state.phase = 'finalized'; Save-State $state
  Write-Output '原任务已删除；原始 XML 留在私有迁移目录，仍可 Rollback。'
} elseif ($Action -eq 'Rollback') {
  Stop-Installed
  if ($state.hadConfig) { Copy-Item -LiteralPath (Join-Path $MigrationDirectory 'previous-config.json') -Destination $state.config -Force }
  if (-not (Get-ScheduledTask -TaskName $state.taskName -ErrorAction SilentlyContinue)) {
    Register-ScheduledTask -TaskName $state.taskName -Xml (Get-Content -LiteralPath $taskXml -Raw) | Out-Null
  }
  if ($state.wasEnabled) { Enable-ScheduledTask -TaskName $state.taskName | Out-Null }
  Start-ScheduledTask -TaskName $state.taskName
  $state.phase = 'rolled-back'; Save-State $state
  Write-Output '安装版已停止，原数据路径未复制，原任务已恢复。'
}
