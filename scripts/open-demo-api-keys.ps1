[CmdletBinding(SupportsShouldProcess)]
param([string]$RuntimeDir = '.runtime/current', [switch]$PathOnly)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot '.runtime'))
$runtimePath = if ([System.IO.Path]::IsPathRooted($RuntimeDir)) { [System.IO.Path]::GetFullPath($RuntimeDir) } else { [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $RuntimeDir)) }
if (-not $runtimePath.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Choose an existing demo directory below this repository .runtime directory.' }
$keyFile = Join-Path $runtimePath 'presenter/demo-api-keys.txt'
if (-not (Test-Path -LiteralPath $keyFile -PathType Leaf)) { throw 'No presenter file exists. Initialize a new runtime or explicitly run lab migrate-auth-demo first.' }
Write-Output ('DEMO ONLY: synthetic credentials for local Mock services; keep the editor off screen while projecting. File: ' + $keyFile)
if (-not $PathOnly -and $PSCmdlet.ShouldProcess($keyFile, 'Open the local presenter file for manual copying')) {
    Invoke-Item -LiteralPath $keyFile
}
