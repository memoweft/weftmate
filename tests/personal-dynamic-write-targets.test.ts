import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPersonalRisk } from '../src/plugins/personal-approval-policy.mjs'

const forms = [
  ['pwsh', '$p="$($PWD.Path)/TARGET"; Set-Content $p data'],
  ['pwsh', '$p="${PWD}/TARGET"; Set-Content $p data'],
  ['bash', 'PWD=unused; cd sub; echo data > "$PWD/TARGET"'],
  ['bash', 'OLDPWD=unused; cd sub; echo data > "$OLDPWD/TARGET"'],
  ['pwsh', "[string]$p='TARGET'; Set-Content $p data"],
  ['pwsh', "$p='TARGET'; Invoke-WebRequest https://example.org -OutFile:$p"],
  ['bash', 'P=TARGET; curl --output="$P" https://example.org'],
  ['bash', 'P=TARGET; curl -o"$P" https://example.org'],
  ['pwsh', "$p=Join-Path -ChildPath ('TARGET' + '') -Path $PWD; Set-Content $p data"],
  ['pwsh', "$p=(Join-Path -Path $PWD -ChildPath 'TARGET'); [IO.File]::WriteAllText($p, 'data')"],
  ['pwsh', "if (-not (Test-Path -LiteralPath 'TARGET')) { New-Item -ItemType File -Path 'TARGET' }; Set-Content TARGET data"],
  ['pwsh', "$p='TARGET'; [IO.File]::WriteAllText($p, 'data')"],
  ['pwsh', "$dir=$PWD; $p=Join-Path $dir 'TARGET'; [System.IO.File]::WriteAllBytes($p, $bytes)"],
  ['pwsh', "$p=$PWD.Path + '/TARGET'; [IO.File]::AppendAllText($p, 'data')"],
  ['pwsh', '$dir=$PWD; $p="$dir/TARGET"; Set-Content -Value data -LiteralPath $p'],
  ['pwsh', "$p='TARGET'; New-Item -Path $p -ItemType File -Force"],
  ['pwsh', "$p='TARGET'; 'data' | Out-File -Encoding utf8 -FilePath $p"],
  ['pwsh', "$p='TARGET'; Add-Content -Path $p -Value data"],
  ['pwsh', "$p='TARGET'; 'data' > $p"],
  ['pwsh', "$p='TARGET'; 'data' >> $p"],
  ['pwsh', "$p='TARGET'; Invoke-WebRequest -Uri https://example.org -OutFile $p"],
  ['pwsh', "$p='TARGET'; curl -o $p https://example.org"],
  ['pwsh', "Set-Location sub; $p='TARGET'; Set-Content $p data"],
  ['pwsh', "Push-Location sub; $p='TARGET'; Set-Content $p data; Pop-Location"],
  ['pwsh', "Push-Location sub; Pop-Location; Set-Content TARGET data"],
  ['pwsh', "$env:APR_TEST_DIR=$PWD.Path; $p=Join-Path $env:APR_TEST_DIR 'TARGET'; Out-File $p"],
  ['pwsh', "$p=Join-Path $env:TEMP 'APR_TEST_TARGET'; Set-Content $p data"],
  ['bash', 'DIR=$(pwd); P="$DIR/TARGET"; echo data > "$P"'],
  ['bash', 'cd sub; P=TARGET; echo data >> "$P"'],
  ['bash', 'P=TARGET; curl https://example.org -o "$P"'],
  ['bash', 'P="$PWD/TARGET"; curl --output "$P" https://example.org'],
] as const

for (const [shell, template] of forms) test(`${shell}: new and existing targets: ${template}`, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-dynamic-'))
  const previousTemp = process.env.TEMP
  process.env.TEMP = cwd
  const tempTarget = `weftmate-apr-${process.pid}-${Date.now()}.txt`
  try {
    mkdirSync(join(cwd, 'sub'))
    const command = template.replaceAll('APR_TEST_TARGET', tempTarget).replaceAll('TARGET', 'out.txt')
    assert.deepEqual(classifyPersonalRisk(shell, { command }, cwd), [], 'new target')
    writeFileSync(join(cwd, 'out.txt'), 'user original')
    writeFileSync(join(cwd, 'sub', 'out.txt'), 'user original')
    writeFileSync(join(process.env.TEMP ?? tmpdir(), tempTarget), 'user original')
    assert.ok(classifyPersonalRisk(shell, { command }, cwd).includes('overwrite'), 'existing target')
  } finally {
    rmSync(join(process.env.TEMP ?? tmpdir(), tempTarget), { force: true })
    rmSync(cwd, { recursive: true, force: true })
    if (previousTemp === undefined) delete process.env.TEMP
    else process.env.TEMP = previousTemp
  }
})

test('unknown values, control flow, reassignment and mutations cannot grant writes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-unknown-'))
  try {
    writeFileSync(join(cwd, 'user.txt'), 'original')
    const unknown = [
      "$p=Read-Host; Set-Content $p data",
      "$p='user.txt'; $r=& Get-UserPath; Set-Content $p data",
      "$p='user.txt'; $r=[Unknown]::ChangePath(); Set-Content $p data",
      "$p='new.txt'; $r=Update-Path; Set-Content $p data",
      "Set-Content -Path 'new.txt','user.txt' -Value data",
      "pwsh -Command \"[IO.File]::AppendAllText($unknown, 'data')\"",
      'PWD=user.txt; curl -o "$PWD" https://example.org',
      'P=new.txt; source paths.sh; echo data > "$P"',
      "$p=Get-UserPath; [IO.File]::WriteAllText($p, 'data')",
      "$r=Invoke-WebRequest https://example.org; $p=$r.Content; Out-File $p",
      "$p='new.txt'; $p=Read-Host; Add-Content $p data",
      "Set-Content $p data; $p='new.txt'",
      "$p=Join-Path $unknown 'new.txt'; New-Item -Path $p",
      "$p=($unknown + '/new.txt'); 'data' >> $p",
      "foreach ($p in (Get-Content paths.txt)) { Set-Content $p data }",
      "$p='new.txt'; if ($input) { $p='user.txt' }; Set-Content $p data",
      "function target { 'new.txt' }; $p=target; Out-File $p",
      "$p='new.txt'; Set-Variable p 'user.txt'; Set-Content $p data",
      "$p='new.txt'; Update-Path; Set-Content $p data",
      "Set-Location (Read-Host); Set-Content 'new.txt' data",
      "Push-Location $unknown; Set-Content 'new.txt' data",
      "$p='user.txt'; [IO.File]::AppendAllText($p,'data')",
      'P=$(cat paths.txt); echo data > "$P"',
      'P=new.txt; P=$(curl https://example.org); curl -o "$P" https://example.org',
      'cd "$UNKNOWN_DIR"; echo data > new.txt',
      'for P in new.txt; do echo data > "$P"; done',
      '$p="new.txt"; Write-Output "$([IO.File]::WriteAllText($unknown, 1))"',
    ]
    for (const command of unknown) assert.ok(classifyPersonalRisk(command.startsWith('P=') || command.startsWith('PWD=') || command.startsWith('cd ') || command.startsWith('for ') ? 'bash' : 'pwsh', { command }, cwd).includes('overwrite'), command)
    for (const command of ["$p='user.txt'; Remove-Item $p", 'rm -rf sub'])
      assert.ok(classifyPersonalRisk('pwsh', { command }, cwd).includes('delete'), command)
    for (const command of ["$p='user.txt'; Move-Item -Path new.txt -Destination $p -Force", 'P=user.txt; mv new.txt "$P"'])
      assert.ok(classifyPersonalRisk(command.startsWith('P=') ? 'bash' : 'pwsh', { command }, cwd).includes('overwrite'), command)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('fixed literal foreach resolves every write, and existing targets remain protected', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-foreach-'))
  try {
    const command = `$dir='${cwd.replaceAll("'", "''")}'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; foreach ($v in 'v24.0.0','v22.0.0') { $r=Invoke-WebRequest -Uri "https://example.org/$v"; $p=Join-Path $dir "$v.html"; [IO.File]::WriteAllText($p,$r.Content) }`
    assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), [])
    writeFileSync(join(cwd, 'v22.0.0.html'), 'user original')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), ['overwrite'])
    writeFileSync(join(cwd, 'script.ps1'), command)
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'pwsh -File script.ps1' }, cwd), ['overwrite'])
    rmSync(join(cwd, 'v22.0.0.html'))
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'pwsh -File script.ps1' }, cwd), [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('parenthesized move destinations preserve new/existing directory semantics', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-move-'))
  try {
    mkdirSync(join(cwd, 'sub'))
    const command = "$root=$PWD; foreach ($d in @('sub')) { $p=Join-Path $root $d; if (-not (Test-Path -LiteralPath (Join-Path $root $d))) { New-Item -ItemType Directory -Path $p | Out-Null } }; Move-Item -LiteralPath (Join-Path $root 'source.txt') -Destination (Join-Path $root 'sub/out.txt')"
    assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), [])
    writeFileSync(join(cwd, 'sub', 'out.txt'), 'user original')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), ['overwrite'])
    const intoDirectory = "$p=Join-Path $PWD 'sub'; Move-Item -LiteralPath source.txt -Destination $p"
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: intoDirectory }, cwd), [])
    writeFileSync(join(cwd, 'sub', 'source.txt'), 'user original')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: intoDirectory }, cwd), ['overwrite'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every write primitive rejects an unresolved target', () => {
  assert.ok(classifyPersonalRisk('bash', { command: 'curl -O https://example.org/user.txt' }).includes('overwrite'))
  for (const command of [
    "[IO.File]::WriteAllText($input, 'data')", "[IO.File]::WriteAllBytes($input, $bytes)",
    "[IO.File]::AppendAllText($input, 'data')", 'New-Item -Path $input -ItemType File',
    'Out-File -FilePath $input', 'Set-Content -LiteralPath $input data', 'Add-Content $input data',
    "'data' > $input", "'data' >> $input", 'Invoke-WebRequest https://example.org -OutFile $input',
    'curl -o $input https://example.org',
  ]) assert.ok(classifyPersonalRisk('pwsh', { command }).includes('overwrite'), command)
})

test('literal file URL in a launched Node script protects the real destination', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-url-'))
  try {
    writeFileSync(join(cwd, 'sum.mjs'), "import { writeFile } from 'node:fs/promises'; const outPath = new URL('./result.json', import.meta.url); await writeFile(outPath, '{}');")
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'node sum.mjs' }, cwd), [])
    writeFileSync(join(cwd, 'result.json'), 'user original')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'node sum.mjs' }, cwd), ['overwrite'])
    writeFileSync(join(cwd, 'sum.mjs'), "const outPath = new URL(input, import.meta.url); writeFile(outPath, '{}');")
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'node sum.mjs' }, cwd), ['overwrite'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('JavaScript arrows and comparisons are not parsed as shell redirection', () => {
  assert.deepEqual(classifyPersonalRisk('code', { code: 'const f = x => x > 1; return f(2);' }), [])
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-js-'))
  try {
    writeFileSync(join(cwd, 'read.mjs'), 'const f = x => x > 1; console.log(f(2));')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: 'node read.mjs' }, cwd), [])
    assert.ok(classifyPersonalRisk('bash', { command: 'P="new.txt user.txt"; curl -o $P https://example.org' }, cwd).includes('overwrite'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('unsupported adjacent quoted words stay unknown instead of inventing a destination', () => {
  for (const command of ["P='sub'/'user.txt'; echo data > \"$P\"", 'P="sub"/user.txt; curl -o "$P" https://example.org'])
    assert.ok(classifyPersonalRisk('bash', { command }).includes('overwrite'), command)
  assert.ok(classifyPersonalRisk('pwsh', { command: '$p="user""file.txt"; Set-Content $p data' }).includes('overwrite'))
})

test('typed, scoped and incremented variables cannot retain a stale new-file grant', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-reassign-'))
  try {
    writeFileSync(join(cwd, 'user.txt'), 'user fixture')
    writeFileSync(join(cwd, '2'), 'user fixture')
    for (const command of [
      "$p='new.txt'; [string]$p='user.txt'; Set-Content $p data",
      "$p='new.txt'; [System.String]$p=Read-Host; Set-Content $p data",
      "$p='new.txt'; $script:p='user.txt'; Set-Content $p data",
      "$p='new.txt'; $local:p='user.txt'; Set-Content $p data",
      "$p='new.txt'; [object]$p='user.txt'; Set-Content $p data",
      "$p='1'; ++$p; Set-Content $p data",
      "$p='3'; --$p; Set-Content $p data",
    ]) assert.ok(classifyPersonalRisk('pwsh', { command }, cwd).includes('overwrite'), command)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('failed directory switches cannot grant relative writes in a guessed directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-failed-location-'))
  try {
    writeFileSync(join(cwd, 'user.txt'), 'user fixture')
    for (const [shell, command] of [
      ['pwsh', 'Set-Location absent; Set-Content user.txt data'],
      ['pwsh', 'Push-Location absent; Pop-Location; Set-Content user.txt data'],
      ['pwsh', 'Set-Location user.txt; Set-Content user.txt data'],
      ['bash', 'cd absent; echo data > user.txt'],
      ['bash', 'pushd absent; popd; echo data > user.txt'],
    ]) assert.ok(classifyPersonalRisk(shell, { command }, cwd).includes('overwrite'), command)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('unsupported URL literal escapes cannot grant a write to a guessed filename', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-url-escape-'))
  try {
    writeFileSync(join(cwd, 'user.txt'), 'user fixture')
    for (const source of [
      String.raw`const p=new URL('./\u0075ser.txt',import.meta.url); writeFile(p,'data');`,
      String.raw`const p=new URL("./\x75ser.txt",import.meta.url); writeFile(p,'data');`,
    ]) {
      writeFileSync(join(cwd, 'write.mjs'), source)
      assert.ok(classifyPersonalRisk('pwsh', { command: 'node write.mjs' }, cwd).includes('overwrite'))
    }
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('expandable string member text stays literal while explicit subexpressions evaluate', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-expandable-'))
  const cwd = join(root, 'cwd')
  try {
    mkdirSync(cwd); mkdirSync(cwd + '.Path')
    writeFileSync(join(cwd + '.Path', 'user.txt'), 'user fixture')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: '$p="$PWD.Path/user.txt"; Set-Content $p data' }, cwd), ['overwrite'])
    assert.ok(classifyPersonalRisk('pwsh', { command: '$p="${PWD.Path}/user.txt"; Set-Content $p data' }, cwd).includes('overwrite'))
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: '$p="$($PWD.Path)/user.txt"; Set-Content $p data' }, cwd), [])
    writeFileSync(join(cwd, 'user.txt'), 'user fixture')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: '$p="$($PWD.Path)/user.txt"; Set-Content $p data' }, cwd), ['overwrite'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
