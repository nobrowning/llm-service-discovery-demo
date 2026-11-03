[CmdletBinding()]
param(
    [string]$Distro = 'Ubuntu',
    [string]$RuntimeDir = '.runtime/current',
    [string]$DockerContext = '',
    [switch]$AsObject
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.runtime'))
$runtimePath = if ([IO.Path]::IsPathRooted($RuntimeDir)) { [IO.Path]::GetFullPath($RuntimeDir) } else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $RuntimeDir)) }
if (-not $runtimePath.StartsWith($runtimeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'RuntimeDir must be a subdirectory of this repository''s .runtime directory.'
}

function Read-Command {
    param([string]$Executable, [string[]]$Arguments)
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $Executable @Arguments 2>$null)
        $code = $LASTEXITCODE
        return [PSCustomObject]@{ Code = $code; Text = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim() }
    } finally { $ErrorActionPreference = $savedPreference }
}
function Test-SameSubnet {
    param([string]$First, [string]$Second, [int]$Prefix)
    $a = [Net.IPAddress]::Parse($First).GetAddressBytes()
    $b = [Net.IPAddress]::Parse($Second).GetAddressBytes()
    for ($index = 0; $index -lt 4; $index++) {
        $bits = [Math]::Min(8, [Math]::Max(0, $Prefix - 8 * $index))
        $mask = [int](256 - [Math]::Pow(2, 8 - $bits))
        if (($a[$index] -band $mask) -ne ($b[$index] -band $mask)) { return $false }
    }
    return $true
}

$problems = [Collections.Generic.List[string]]::new()
$nodeVersion = $null
$nodeReady = [bool](Get-Command node.exe -ErrorAction SilentlyContinue)
if ($nodeReady) {
    $nodeResult = Read-Command 'node.exe' @('--version')
    $nodeVersion = $nodeResult.Text
    $nodeReady = $nodeResult.Code -eq 0 -and $nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22
}
if (-not $nodeReady) { $problems.Add('Install Node.js 22 or later on Windows.') }

$wslReady = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
$serviceAddress = $null
$windowsAddress = $null
$windowsInterface = $null
$repositoryWslPath = $null
$runtimeWslPath = $null
$isolatedRoot = $null
$isolatedVersion = $null
$composeVersion = $null
$composeBootstrapRequired = $false
$baseImageCached = $false
$staticBinariesPresent = $false
if ($wslReady) {
    $ipResult = Read-Command 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'ip', '-j', '-4', 'address', 'show', 'dev', 'eth0')
    if ($ipResult.Code -eq 0 -and $ipResult.Text.StartsWith('[')) {
        $addresses = @((ConvertFrom-Json $ipResult.Text).addr_info | Where-Object { $_.family -eq 'inet' -and $_.scope -eq 'global' })
        if ($addresses.Count -eq 1) {
            $serviceAddress = [string]$addresses[0].local
            $servicePrefix = [int]$addresses[0].prefixlen
            $windowsCandidates = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
                $_.InterfaceAlias -like 'vEthernet*' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
                (Test-SameSubnet $serviceAddress $_.IPAddress $servicePrefix) -and
                (Test-SameSubnet $serviceAddress $_.IPAddress ([int]$_.PrefixLength))
            })
            if ($windowsCandidates.Count -gt 1) {
                $routeResult = Read-Command 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'ip', '-j', '-4', 'route', 'show', 'default', 'dev', 'eth0')
                if ($routeResult.Code -eq 0 -and $routeResult.Text.StartsWith('[')) {
                    $gateways = @((ConvertFrom-Json $routeResult.Text).gateway)
                    $windowsCandidates = @($windowsCandidates | Where-Object { $_.IPAddress -in $gateways })
                }
            }
            if ($windowsCandidates.Count -eq 1) {
                $windowsAddress = [string]$windowsCandidates[0].IPAddress
                $windowsInterface = [string]$windowsCandidates[0].InterfaceAlias
            } else { $problems.Add('Could not uniquely match Ubuntu eth0 to a Windows vEthernet address; inspect the existing WSL network.') }
        } else { $problems.Add('Ubuntu eth0 must have one global IPv4 address for this lightweight mode.') }
    } else { $problems.Add("The existing WSL distribution '$Distro' could not report eth0. Install/configure it separately; this script does not create a distribution.") }
    $repoResult = Read-Command 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', $repositoryRoot)
    $runtimeResult = Read-Command 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', $runtimePath)
    if ($repoResult.Code -eq 0 -and $repoResult.Text.StartsWith('/')) { $repositoryWslPath = $repoResult.Text }
    if ($runtimeResult.Code -eq 0 -and $runtimeResult.Text.StartsWith('/')) { $runtimeWslPath = $runtimeResult.Text }
    if (-not $repositoryWslPath -or -not $runtimeWslPath) { $problems.Add('The repository/runtime paths must be accessible from the existing WSL distribution.') }
    $isolatedPrefix = @('-d', $Distro, '-u', 'root', '--exec', 'sh', ($repositoryWslPath + '/spikes/network/wsl-engine.sh'), 'docker')
    $daemonResult = Read-Command 'wsl.exe' ($isolatedPrefix + @('info', '--format', '{{.DockerRootDir}}|{{.ServerVersion}}'))
    if ($daemonResult.Text -match '^(/var/tmp/llm-discovery-docker-0/data)\|(.+)$') { $isolatedRoot = $Matches[1]; $isolatedVersion = $Matches[2] }
    $baseResult = Read-Command 'wsl.exe' ($isolatedPrefix + @('image', 'inspect', 'node:24-alpine', '--format', '{{.Id}}'))
    $baseImageCached = $baseResult.Code -eq 0 -and $baseResult.Text -match '^sha256:[a-f0-9]{64}$'
    $binaryResult = Read-Command 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'test', '-x', '/var/tmp/llm-discovery-docker-0/bin/docker/dockerd')
    $staticBinariesPresent = $binaryResult.Code -eq 0
    $composeResult = Read-Command 'wsl.exe' ($isolatedPrefix + @('compose', 'version', '--short'))
    if ($composeResult.Code -eq 0 -and $composeResult.Text -match '^v?\d+\.') { $composeVersion = $composeResult.Text }
    else { $composeBootstrapRequired = $true }
} else { $problems.Add('WSL is required. This script does not install or reconfigure WSL.') }

$buildVersion = $null
$buildEndpoint = $null
$baseArchiveAvailable = Test-Path -LiteralPath (Join-Path $repositoryRoot 'spikes/network/.runtime/node-24-alpine.tar')
# A cached base makes Desktop irrelevant; avoid waiting on a stopped Desktop engine.
if (-not $baseImageCached -and -not $baseArchiveAvailable -and (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    if (-not $DockerContext) {
        $contexts = Read-Command 'docker.exe' @('context', 'ls', '--format', '{{.Name}}')
        if ('desktop-linux' -in ($contexts.Text -split "`n")) { $DockerContext = 'desktop-linux' }
        else { $DockerContext = (Read-Command 'docker.exe' @('context', 'show')).Text }
    }
    if ($DockerContext) {
        $endpoint = Read-Command 'docker.exe' @('context', 'inspect', $DockerContext, '--format', '{{.Endpoints.docker.Host}}')
        if ($endpoint.Code -eq 0 -and $endpoint.Text -match '^(npipe|unix)://') {
            $buildEndpoint = $endpoint.Text
            $versionResult = Read-Command 'docker.exe' @('--context', $DockerContext, 'version', '--format', '{{.Server.Version}}')
            if ($versionResult.Code -eq 0 -and $versionResult.Text -match '^\d+\.') { $buildVersion = $versionResult.Text }
        }
    }
}
$baseArchiveAvailable = Test-Path -LiteralPath (Join-Path $repositoryRoot 'spikes/network/.runtime/node-24-alpine.tar')
if (-not $baseImageCached -and -not $baseArchiveAvailable -and -not $buildVersion -and -not $staticBinariesPresent) {
    $problems.Add('Provide the cached node:24-alpine image/base tar, or start a local Docker Desktop engine for the one-time base-image export. Runtime builds themselves are offline.')
}

$labFile = Join-Path $runtimePath 'lab.json'
$runtimeExists = Test-Path -LiteralPath $labFile
$runtimeMatches = $null
$runtimeRunId = $null
$runtimeComplete = $true
if ($runtimeExists) {
    $lab = Get-Content -LiteralPath $labFile -Raw | ConvertFrom-Json
    if ($lab.schema -ne 'llm-discovery-demo-lab/v1') { throw 'Existing runtime has an unexpected schema; no files were changed.' }
    $runtimeMatches = $lab.address -eq $serviceAddress -and $lab.interfaceAddress -eq $windowsAddress
    $runtimeRunId = $lab.runId
    $requiredFiles = @('server/lab.json', 'server/server.pem', 'server/server-key.pem', 'server/tokens.json', 'client/trust.json', 'client/ca.pem', 'client/marker.txt')
    $trustPath = Join-Path $runtimePath 'client/trust.json'
    if (Test-Path -LiteralPath $trustPath) {
        $trustDocument = Get-Content -LiteralPath $trustPath -Raw | ConvertFrom-Json
        foreach ($service in $trustDocument.services) {
            if ($service.tokenFile -and -not (Test-Path -LiteralPath (Join-Path (Split-Path $trustPath) $service.tokenFile))) { $runtimeComplete = $false }
        }
    }
    foreach ($relativeFile in $requiredFiles) { if (-not (Test-Path -LiteralPath (Join-Path $runtimePath $relativeFile))) { $runtimeComplete = $false } }
    if (-not $runtimeComplete) { $problems.Add('Existing runtime is incomplete. Preserve it and choose a new RuntimeDir; credentials are never silently regenerated.') }
    if (-not $runtimeMatches) { $problems.Add('Existing runtime addresses differ from the current WSL link. Use a new -RuntimeDir; existing tokens and trust remain unchanged.') }
} elseif ((Test-Path -LiteralPath $runtimePath) -and @(Get-ChildItem -LiteralPath $runtimePath -Force).Count -gt 0) {
    $runtimeComplete = $false
    $problems.Add('Runtime directory is nonempty but lab.json is missing. Preserve the partial state and choose a new RuntimeDir; existing credentials are never overwritten.')
}

$report = [PSCustomObject][ordered]@{
    ReadyToStart = $problems.Count -eq 0
    RepositoryRoot = $repositoryRoot
    RepositoryWslPath = $repositoryWslPath
    Distro = $Distro
    NodeVersion = $nodeVersion
    DependenciesInstalled = @(@('node-forge', '@llm-discovery/discovery-core', '@llm-discovery/advertiser', 'dsh-lan-discovery', 'multicast-dns', 'dns-packet', 'thunky', '@leichtgewicht/ip-codec') | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repositoryRoot ('node_modules/' + $_ + '/package.json'))) }).Count -eq 0
    ServiceAddress = $serviceAddress
    WindowsInterfaceAddress = $windowsAddress
    WindowsInterface = $windowsInterface
    DockerContext = $DockerContext
    BuildEngineVersion = $buildVersion
    BaseImageCached = $baseImageCached
    BaseArchiveAvailable = $baseArchiveAvailable
    StaticBinariesPresent = $staticBinariesPresent
    IsolatedDaemonRoot = $isolatedRoot
    IsolatedDaemonVersion = $isolatedVersion
    ComposeVersion = $composeVersion
    ComposeBootstrapRequired = $composeBootstrapRequired
    RuntimePath = $runtimePath
    RuntimeWslPath = $runtimeWslPath
    RuntimeExists = $runtimeExists
    RuntimeAddressesMatch = $runtimeMatches
    RuntimeComplete = $runtimeComplete
    RuntimeRunId = $runtimeRunId
    Problems = @($problems)
}
if ($AsObject) { return $report }
$report | ConvertTo-Json -Depth 4
