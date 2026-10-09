# Run by a Windows Scheduled Task under the signed-in user's InteractiveToken.
# The Node launcher stays in the foreground so Task Scheduler owns its lifetime.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Probe', 'Production')]
    [string] $Mode,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
$repository = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'run-personal-host.mjs'
$runtime = 'D:\AIProjects\WeftMate\Runtime\UnifiedAssistant'

try {
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Node executable is missing' }
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Personal host launcher is missing' }

    if ($Mode -eq 'Probe') {
        $profile = Join-Path $runtime 'Stage07Acceptance-20260927\personal-fixture'
        $mobileUi = Join-Path $runtime 'Stage07Acceptance-20260927\mobile-ui-releases'
        $port = '18188'
    } else {
        $profile = Join-Path $runtime 'personal-account-20260926'
        $mobileUi = Join-Path $runtime 'mobile-ui-releases'
        $port = '18186'
    }
    if (-not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'Personal host profile is missing' }
    if (-not (Test-Path -LiteralPath $mobileUi -PathType Container)) { throw 'Mobile UI release directory is missing' }

    $hostArgs = @($launcher, '--user-data-dir', $profile, '--access-port', $port,
        '--mobile-ui-dir', $mobileUi)
    if ($Mode -eq 'Production') {
        $env:WEFTMATE_CLOUD_ISSUER = 'https://api.weftmate.com/personal/v1/cloud/oidc'
        $env:WEFTMATE_CLOUD_DESKTOP_CLIENT_ID = 'weftmate-desktop'
        $env:WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI = 'http://127.0.0.1:18186/personal/v1/ui/'
        $env:WEFTMATE_CLOUD_WEB_CLIENT_ID = 'weftmate-desktop'
        $env:WEFTMATE_RELAY_ENABLED = 'true'
        $env:WEFTMATE_RELAY_ACME_ENABLED = 'true'
        $env:WEFTMATE_ACME_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory'
        # Official, checksum-verified frpc and public CA roots; no account credentials.
        $env:WEFTMATE_FRPC_FILE = Join-Path $repository '.local\frp\frp_0.71.0_windows_amd64\frpc.exe'
        if (-not (Test-Path -LiteralPath $env:WEFTMATE_FRPC_FILE -PathType Leaf)) {
            Push-Location -LiteralPath $repository
            try {
                & $node (Join-Path $PSScriptRoot 'download-frp.mjs')
                if ($LASTEXITCODE -ne 0) { throw 'Official frpc installation failed' }
            } finally { Pop-Location }
        }
        $env:WEFTMATE_RELAY_CA_FILE = Join-Path $repository '.local\frp\transport-ca.pem'
        & $node -e "require('node:fs').writeFileSync(process.env.WEFTMATE_RELAY_CA_FILE, require('node:tls').rootCertificates.join('\n') + '\n')"
        if ($LASTEXITCODE -ne 0) { throw 'Relay transport CA preparation failed' }
        # Content certificates use the host's private default path. Optional
        # WEFTMATE_ACME_EMAIL is inherited from the user's environment.
        $androidPackage = Join-Path $runtime 'android-candidate.apk'
        $memoryConfig = Join-Path $runtime 'personal-memory-config-20260927.json'
        if (-not (Test-Path -LiteralPath $androidPackage -PathType Leaf)) { throw 'Android package is missing' }
        if (-not (Test-Path -LiteralPath $memoryConfig -PathType Leaf)) { throw 'Personal memory configuration is missing' }
        $hostArgs += @('--public-origin', 'https://home.weftmate.com:8443',
            '--trust-loopback-proxy', '--android-package-path', $androidPackage,
            '--personal-memory-config', $memoryConfig)
    }
    if ($DryRun) { $hostArgs += '--dry-run' }

    Push-Location -LiteralPath $repository
    try {
        if ($DryRun) {
            & $node @hostArgs
            if ($null -eq $LASTEXITCODE) { exit 1 }
            exit $LASTEXITCODE
        }

        # Scheduler restart settings are a fallback; keep supervising within this task.
        # Stop the Scheduled Task before intentionally taking the host offline.
        $delaySeconds = 5
        while ($true) {
            $uptime = [System.Diagnostics.Stopwatch]::StartNew()
            $global:LASTEXITCODE = $null
            try {
                & $node @hostArgs
                $result = $LASTEXITCODE
            } catch {
                [Console]::Error.WriteLine('Personal host launch failed: ' + $_.Exception.Message)
                $result = 1
            }
            $uptime.Stop()
            if ($null -eq $result) { $result = 1 }

            # A normal exit is unexpected in unattended mode too.
            if ($uptime.Elapsed.TotalMinutes -ge 5) { $delaySeconds = 5 }
            [Console]::Error.WriteLine(
                ('Personal host exited code={0}; restarting in {1}s' -f $result, $delaySeconds))
            Start-Sleep -Seconds $delaySeconds
            $delaySeconds = [Math]::Min($delaySeconds * 2, 60)
        }
    } finally {
        Pop-Location
    }
} catch {
    [Console]::Error.WriteLine('Personal host task failed: ' + $_.Exception.Message)
    exit 1
}
