param([Parameter(Mandatory=$true)][string]$InputDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$harness=Join-Path $env:TEMP 'weftmate-baseline-harness'
New-Item -ItemType Directory -Path $harness -Force | Out-Null
Copy-Item -LiteralPath "$InputDirectory\node.exe" -Destination "$harness\node.exe"
$before=@{at=(Get-Date -Format o);os=(Get-CimInstance Win32_OperatingSystem).Caption;build=[Environment]::OSVersion.Version.ToString();pythonPresent=[bool](Get-Command python.exe -ErrorAction SilentlyContinue);existingApp=(Test-Path "$env:LOCALAPPDATA\Programs\WeftMate");existingProfile=(Test-Path "$env:APPDATA\com.memoweft.weftmate")}
$before | ConvertTo-Json | Set-Content "$OutputDirectory\guest-before.json" -Encoding UTF8
$installer=Get-ChildItem -LiteralPath $InputDirectory -Filter 'WeftMate-Setup-*.exe' | Select-Object -First 1
if(!$installer){throw 'Candidate installer missing'}
$install=Start-Process -FilePath $installer.FullName -ArgumentList '--updated','/S','/currentuser' -WindowStyle Hidden -PassThru
if(!$install.WaitForExit(180000)){taskkill.exe /PID $install.Id /T /F | Out-Null;throw 'Installer timed out'}
@{exitCode=$install.ExitCode;sha256=(Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash;defaultInstall=$true} | ConvertTo-Json | Set-Content "$OutputDirectory\installation.json" -Encoding UTF8
& "$harness\node.exe" "$InputDirectory\scripts\controller.mjs" $InputDirectory $OutputDirectory *> "$OutputDirectory\controller.log"
if(Test-Path -LiteralPath "$OutputDirectory\shutdown.request") { shutdown.exe /s /t 0 }
