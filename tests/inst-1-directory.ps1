param([string]$Out='.local/inst-1b-directory')
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Out=[IO.Path]::GetFullPath((Join-Path $workspace $Out))
[IO.Directory]::CreateDirectory($Out)|Out-Null
$fixture=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('wi1-dir-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
[IO.Directory]::CreateDirectory($fixture)|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $fixture 'WeftMate'))|Out-Null
$old=Join-Path $fixture 'old/WeftMate'
[IO.Directory]::CreateDirectory((Join-Path $old 'data'))|Out-Null
[IO.File]::WriteAllText((Join-Path $old 'WeftMate-inst1qa.exe'),'synthetic old-program marker')
$alias=Join-Path $fixture 'data-link'
New-Item -ItemType Junction -Path $alias -Target (Join-Path $old 'data')|Out-Null
$vs=& "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$command=Join-Path $Out 'compile.cmd'
"#define WEFT_INSTALL_MAX_SUFFIX 192" | Set-Content -LiteralPath (Join-Path $Out 'installer-payload.h')
@"
@call "$vs\VC\Auxiliary\Build\vcvars32.bat" >nul
@cd /d "$Out"
@cl /nologo /std:c++17 /EHsc /DUNICODE /D_UNICODE /utf-8 /W4 /WX /I"$Out" "$workspace\tests\helpers\installer-directory-check.cpp" "$workspace\build\installer-directory.cpp" /Fecheck.exe /link shell32.lib shlwapi.lib ole32.lib
"@ | Set-Content -LiteralPath $command
try{
  & cmd.exe /d /c $command
  if($LASTEXITCODE){throw 'Directory check compilation failed'}
  & (Join-Path $Out 'check.exe') $fixture
  if($LASTEXITCODE){throw 'Directory checks failed'}
}finally{
  if([IO.Path]::GetFullPath($fixture) -notmatch '^[A-Z]:\\wi1-dir-[a-f0-9]{12}$'){throw 'Synthetic cleanup boundary'}
  [IO.Directory]::Delete($alias,$false)
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
