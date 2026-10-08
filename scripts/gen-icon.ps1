# 兼容旧命令；唯一母版位于 design/icons。
node (Join-Path $PSScriptRoot 'generate-icons.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
