param([Parameter(Mandatory=$true)][string]$ConnectionFile)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
$uri = [Uri]$settings.url
if ($settings.contractVersion -ne 'rover-memory-connection-1.0' -or $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or
    $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw 'Expected a private loopback memory connection.' }
$result = Invoke-RestMethod -Method Post -Uri ($settings.url.TrimEnd('/') + '/internal/local/stop') `
    -Headers @{'X-Relay-Local-Control'=$settings.localControlToken} -TimeoutSec 5
if ($result.status -ne 'stopping') { throw 'Memory service did not confirm graceful shutdown.' }
Write-Output 'Memory service is stopping gracefully. Its store is retained.'
