[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Distro = 'Ubuntu',
    [string]$RuntimeDir = '.runtime/current',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.runtime'))
$runtimePath = if ([IO.Path]::IsPathRooted($RuntimeDir)) { [IO.Path]::GetFullPath($RuntimeDir) } else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $RuntimeDir)) }
if (-not $runtimePath.StartsWith($runtimeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'RuntimeDir must be under this repository''s .runtime directory.' }

function Read-WslPath {
    param([string]$WindowsPath)
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $lines = @(& wsl.exe -d $Distro -u root --exec wslpath -a -u $WindowsPath 2>$null); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $savedPreference }
    $converted = (($lines | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ($code -ne 0 -or -not $converted.StartsWith('/')) { throw "Could not map path into WSL: $WindowsPath" }
    return $converted
}
$repositoryWslPath = Read-WslPath $repositoryRoot
$runtimeWslPath = Read-WslPath $runtimePath
$socket = 'unix:///var/tmp/llm-discovery-docker-0/docker.sock'
$arguments = @('-d', $Distro, '-u', 'root', '--exec', 'sh', ($repositoryWslPath + '/spikes/network/wsl-engine.sh'), 'docker', 'compose', '--project-name', 'llm-discovery-demo', '-f', ($repositoryWslPath + '/deploy/compose.yaml'))
if (Test-Path -LiteralPath (Join-Path $runtimePath 'compose.runtime.json')) { $arguments += @('-f', ($runtimeWslPath + '/compose.runtime.json')) }
$arguments += @('down', '--timeout', '10')
if ($DryRun -or $WhatIfPreference) {
    [PSCustomObject]@{ Action = 'compose down'; Project = 'llm-discovery-demo'; DaemonSocket = $socket; Runtime = $runtimePath; KeepDaemon = $true; KeepRuntimeAndTrust = $true; HarnessChanged = $false } | ConvertTo-Json
    return
}
if ($PSCmdlet.ShouldProcess('llm-discovery-demo in the isolated Ubuntu Docker daemon', 'Stop and remove this Compose project')) {
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & wsl.exe @arguments; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $savedPreference }
    if ($code -ne 0) { throw "Compose down failed with exit code $code. Inspect the isolated daemon before retrying." }
    Write-Host 'Demo project stopped. Runtime, trust, images and the isolated Docker daemon are retained.'
}
