param(
    [Parameter(Mandatory=$true)][string]$ConnectionFile,
    [string]$DataDirectory = (Join-Path $PSScriptRoot '..\..\.data\rover-memory-integration')
)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
if ($settings.contractVersion -ne 'rover-memory-connection-1.0') { throw 'Invalid private memory connection file.' }
$uri = [Uri]$settings.url
if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) {
    throw 'This local launcher requires a loopback HTTP base URL.'
}
$env:RELAY2_MEMORY_PORT = [string]$uri.Port
$env:RELAY2_MEMORY_DATA_DIR = [IO.Path]::GetFullPath($DataDirectory)
$env:RELAY2_MEMORY_INTERNAL_TOKEN = $settings.internalToken
$env:RELAY2_MEMORY_CONTEXT_SECRET = $settings.contextSecret
$env:RELAY2_MEMORY_LOCAL_CONTROL_TOKEN = $settings.localControlToken
Push-Location (Join-Path $PSScriptRoot '..\..')
try {
    & node --import tsx .\src\rover-memory-server.ts
    if ($LASTEXITCODE -ne 0) { throw 'Memory service exited. Inspect its private logs and writer lock before restarting.' }
} finally { Pop-Location }
