$ErrorActionPreference = "Stop"

$keyPath = Join-Path $HOME ".tauri\lumaforge.key"
if (-not (Test-Path $keyPath)) {
  Write-Error "Signing key not found at $keyPath"
  exit 1
}

Write-Host "Signing with key: $keyPath"
$env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

npm run tauri build
