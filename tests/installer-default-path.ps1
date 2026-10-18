param([Parameter(Mandatory=$true)][string]$Payload,[string]$Out='.local/default-path-check')
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Out=[IO.Path]::GetFullPath((Join-Path $workspace $Out))
[IO.Directory]::CreateDirectory($Out)|Out-Null
$Payload=(Resolve-Path -LiteralPath $Payload).Path.TrimEnd('\')
$entries=Get-ChildItem -LiteralPath $Payload -Recurse -Force
if(!$entries.Count){throw 'A real complete unpacked payload is required'}
$suffix=($entries | ForEach-Object { $_.FullName.Length-$Payload.Length+$(if($_.PSIsContainer){12}else{0}) } | Measure-Object -Maximum).Maximum
$fixture=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('w1-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
# Actual classic Sandbox LOCALAPPDATA length, without a user directory in logs.
$sandboxLocalLength=41
$local=$fixture+'\'+('x'*($sandboxLocalLength-$fixture.Length-1))
[IO.Directory]::CreateDirectory((Join-Path $local 'Programs'))|Out-Null
$vs=& "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
"#define WEFT_INSTALL_MAX_SUFFIX $suffix" | Set-Content -LiteralPath (Join-Path $Out 'installer-payload.h')
$command=Join-Path $Out 'compile.cmd'
@"
@call "$vs\VC\Auxiliary\Build\vcvars32.bat" >nul
@cd /d "$Out"
@cl /nologo /std:c++17 /EHsc /DUNICODE /D_UNICODE /utf-8 /W4 /WX /I"$Out" "$workspace\tests\helpers\installer-default-path-check.cpp" "$workspace\build\installer-directory.cpp" /Fecheck.exe /link shell32.lib shlwapi.lib ole32.lib
"@ | Set-Content -LiteralPath $command
try {
  & cmd.exe /d /c $command
  if($LASTEXITCODE){throw 'Default path check compilation failed'}
  & (Join-Path $Out 'check.exe') $local $suffix
  if($LASTEXITCODE){throw "Default path rejected (exit $LASTEXITCODE)"}
} finally {
  if([IO.Path]::GetFullPath($fixture) -notmatch '^[A-Z]:\\w1-[a-f0-9]{8}$'){throw 'Synthetic cleanup boundary'}
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
