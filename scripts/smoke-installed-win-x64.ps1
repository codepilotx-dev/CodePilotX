param(
  [string]$ReleaseDirectory = "release",
  [string]$InstallDirectory = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$installers = @(Get-ChildItem -LiteralPath $releaseRoot -Filter "CodePilotX-*-x64.exe" -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows x64 installer, found $($installers.Count)"
}

if (-not $InstallDirectory) {
  $InstallDirectory = Join-Path $releaseRoot "installed"
}

$installerProcess = Start-Process `
  -FilePath $installers[0].FullName `
  -ArgumentList "/S", "/D=$InstallDirectory" `
  -Wait `
  -PassThru
if ($installerProcess.ExitCode -ne 0) {
  throw "NSIS silent install failed: $($installerProcess.ExitCode)"
}

& bun scripts/verify-win-x64-package.ts "--unpacked=$InstallDirectory"
if ($LASTEXITCODE -ne 0) {
  throw "Installed package verification failed"
}

& bun scripts/smoke-win-x64.ts "--application=$InstallDirectory/CodePilotX.exe"
if ($LASTEXITCODE -ne 0) {
  throw "Installed desktop smoke failed"
}
