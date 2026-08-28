# WeftMate 自签代码签名证书（内部 Dogfood 用）
# 用法（PowerShell）：.\scripts\make-self-signed-cert.ps1
# 产出：.certs\weftmate-codesign.pfx（gitignored，不进仓库）
# 签名打包：
#   $env:CSC_LINK = 'D:\AIProjects\WeftMate\Repository\.certs\weftmate-codesign.pfx'
#   $env:CSC_KEY_PASSWORD = '<本脚本输出的密码>'
#   npm run dist:win
#
# 诚实边界：自签证书 = 签名有效（完整性 + 自动更新一致性校验可用），但 Windows 不认识该发布者，
# SmartScreen 仍会提示「未知发布者」。本机可选信任（管理员 PowerShell）：
#   Import-Certificate -FilePath .certs\weftmate-codesign.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
# 正式发布前把 CSC_LINK/CSC_KEY_PASSWORD 换成正式证书即可，管线不变。
$ErrorActionPreference = 'Stop'
$passwordPlain = 'weftmate-dev-sign-2026'
$passwordB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($passwordPlain))
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) '.certs'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$pfxPath = Join-Path $dir 'weftmate-codesign.pfx'
$cerPath = Join-Path $dir 'weftmate-codesign.cer'

$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=WeftMate Dev (self-signed), O=Memoweft' } | Select-Object -First 1
if ($null -eq $existing) {
  $existing = New-SelfSignedCertificate -Type CodeSigningCert `
    -Subject 'CN=WeftMate Dev (self-signed), O=Memoweft' `
    -FriendlyName 'WeftMate Code Signing (self-signed, internal dogfood only)' `
    -NotAfter (Get-Date).AddYears(5) -KeyAlgorithm RSA -KeyLength 3072 `
    -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My
  Write-Output "新建证书：$($existing.Thumbprint)"
} else {
  Write-Output "复用已有证书：$($existing.Thumbprint)"
}
Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password (ConvertTo-SecureString -String $passwordB64 -AsPlainText -Force) | Out-Null
Export-Certificate -Cert $existing -FilePath $cerPath | Out-Null
Write-Output "PFX：$pfxPath"
Write-Output "CER（信任用）：$cerPath"
Write-Output "CSC_KEY_PASSWORD=$passwordB64"
Write-Output 'THUMB=' + $existing.Thumbprint
