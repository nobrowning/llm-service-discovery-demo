[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Distro = 'Ubuntu',
    [string]$RuntimeDir = '.runtime/current',
    [string]$DockerContext = '',
    [switch]$SkipBuild,
    [switch]$SkipDiscoveryCheck,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$report = & (Join-Path $PSScriptRoot 'doctor.ps1') -Distro $Distro -RuntimeDir $RuntimeDir -DockerContext $DockerContext -AsObject
if (-not $report.ReadyToStart) { throw ($report.Problems -join "`n") }
$image = 'llm-discovery-demo:0.5.1'
$releaseImage = $report.ReleaseImage
$useReleaseImage = $null -ne $releaseImage
$socket = 'unix:///var/tmp/llm-discovery-docker-0/docker.sock'
$helper = $report.RepositoryWslPath + '/spikes/network/wsl-engine.sh'
$composeFile = $report.RepositoryWslPath + '/deploy/compose.yaml'
$overrideFile = Join-Path $report.RuntimePath 'compose.runtime.json'
$overrideWsl = $report.RuntimeWslPath + '/compose.runtime.json'
$plan = [PSCustomObject][ordered]@{
    Mode = 'container-owned mDNS on existing WSL link'
    Distro = $Distro
    ServiceAddress = $report.ServiceAddress
    WindowsInterfaceAddress = $report.WindowsInterfaceAddress
    Runtime = $report.RuntimePath
    RuntimeAction = $(if ($report.RuntimeExists) { 'Reuse existing tokens and trust' } else { 'Initialize new runtime once' })
    BuildEngine = $(if ($useReleaseImage) { 'verified release archive, isolated WSL daemon' } else { 'isolated WSL daemon, offline curated context' })
    BaseImageSource = $(if ($useReleaseImage) { 'not required for the prebuilt release image' } elseif ($report.BaseImageCached) { 'isolated daemon cache' } elseif ($report.BaseArchiveAvailable) { 'local base tar' } else { 'check retained daemon cache, then local Docker bootstrap' })
    Image = $image
    ReleaseImage = $releaseImage
    RebuildImage = -not ($SkipBuild -or $useReleaseImage)
    Project = 'llm-discovery-demo'
    DaemonSocket = $socket
    ComposeFile = $composeFile
    RuntimeOverride = $overrideWsl
    DiscoveryCheck = -not $SkipDiscoveryCheck
    ComposeBootstrap = $report.ComposeBootstrapRequired
    HarnessChanged = $false
}
if ($DryRun -or $WhatIfPreference) { $plan | ConvertTo-Json -Depth 4; return }
if (-not $PSCmdlet.ShouldProcess('llm-discovery-demo in the isolated Ubuntu Docker daemon', 'Build/load image and start two mock nodes with three services')) { return }

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Executable @Arguments; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $savedPreference }
    if ($code -ne 0) { throw "$Executable failed with exit code $code." }
}
function Invoke-IsolatedDocker {
    param([string[]]$Arguments)
    Invoke-Checked 'wsl.exe' (@('-d', $Distro, '-u', 'root', '--exec', 'sh', $helper, 'docker') + $Arguments)
}
function Read-ImageId {
    param([string]$Executable, [string[]]$Prefix, [string]$ImageName)
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $result = @(& $Executable @Prefix image inspect $ImageName --format '{{.Id}}' 2>$null); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $savedPreference }
    $text = (($result | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ($code -eq 0 -and $text -match '^sha256:[a-f0-9]{64}$') { return $text }
    return $null
}

Push-Location $report.RepositoryRoot
try {
    if (-not $report.DependenciesInstalled) { Invoke-Checked 'npm.cmd' @('ci', '--ignore-scripts') }
    $downloadDirectory = Join-Path $report.RepositoryRoot 'spikes/network/.runtime'
    New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
    $archive = Join-Path $downloadDirectory 'docker-27.5.1.tgz'
    if (-not $report.StaticBinariesPresent) {
        if (-not (Test-Path -LiteralPath $archive)) {
            Invoke-WebRequest -Uri 'https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz' -OutFile $archive -TimeoutSec 180 -UseBasicParsing
        }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640') {
            throw 'Docker static archive SHA-256 mismatch. Preserve the file for inspection; nothing was installed.'
        }
    }
    Invoke-Checked 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'sh', $helper, 'start')
    # Desktop's WSL CLI symlinks can disappear while our daemon and image cache
    # remain available. Keep a verified Compose plugin in this project's cache.
    if ($report.ComposeBootstrapRequired) {
        $composeDirectory = Join-Path $downloadDirectory 'docker-cli/cli-plugins'
        New-Item -ItemType Directory -Force -Path $composeDirectory | Out-Null
        $composeBinary = Join-Path $composeDirectory 'docker-compose'
        if (-not (Test-Path -LiteralPath $composeBinary)) {
            Invoke-WebRequest -Uri 'https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64' -OutFile $composeBinary -TimeoutSec 180 -UseBasicParsing
        }
        if ((Get-FileHash -LiteralPath $composeBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'ed1917fb54db184192ea9d0717bcd59e3662ea79db48bff36d3475516c480a6b') {
            throw 'Docker Compose archive SHA-256 mismatch. Preserve the file for inspection; it was not executed.'
        }
        Invoke-Checked 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'chmod', '+x', ($report.RepositoryWslPath + '/spikes/network/.runtime/docker-cli/cli-plugins/docker-compose'))
        Invoke-IsolatedDocker @('compose', 'version', '--short')
    }
    $isolatedPrefix = @('-d', $Distro, '-u', 'root', '--exec', 'sh', $helper, 'docker')
    if ($useReleaseImage) {
        # Recheck immediately before loading; doctor has already checked the path,
        # manifest schema/version, expected tag, and archive completeness.
        if ((Get-FileHash -LiteralPath $releaseImage.Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $releaseImage.Sha256) {
            throw 'Release image SHA-256 changed after the preflight check. The archive was not loaded.'
        }
        Invoke-IsolatedDocker @('image', 'load', '-i', ($report.RepositoryWslPath + '/' + $releaseImage.File))
        $loadedImageId = Read-ImageId 'wsl.exe' $isolatedPrefix $image
        if (-not $loadedImageId -or ($releaseImage.Id -and $loadedImageId -cne $releaseImage.Id)) {
            throw 'The loaded image does not match the release manifest. Containers were not started.'
        }
    } elseif (-not $SkipBuild -and -not (Read-ImageId 'wsl.exe' $isolatedPrefix 'node:24-alpine')) {
        $baseArchive = Join-Path $downloadDirectory 'node-24-alpine.tar'
        if (-not (Test-Path -LiteralPath $baseArchive)) {
            if (-not $report.BuildEngineVersion) { throw 'The isolated daemon has no cached node:24-alpine image. Provide spikes/network/.runtime/node-24-alpine.tar or start the existing local Docker Desktop engine; no system settings were changed.' }
            $desktopPrefix = @('--context', $report.DockerContext)
            if (-not (Read-ImageId 'docker.exe' $desktopPrefix 'node:24-alpine')) { Invoke-Checked 'docker.exe' ($desktopPrefix + @('pull', 'node:24-alpine')) }
            Invoke-Checked 'docker.exe' ($desktopPrefix + @('image', 'save', '-o', $baseArchive, 'node:24-alpine'))
        }
        Invoke-IsolatedDocker @('image', 'load', '-i', ($report.RepositoryWslPath + '/spikes/network/.runtime/node-24-alpine.tar'))
    }
    # initializeLab reuses matching runtime state and rejects address changes.
    Invoke-Checked 'node.exe' @('packages/lab-controller/cli.mjs', 'init', '--address', $report.ServiceAddress, '--interface', $report.WindowsInterfaceAddress, '--runtime', $report.RuntimePath)
    $lab = Get-Content -LiteralPath (Join-Path $report.RuntimePath 'lab.json') -Raw | ConvertFrom-Json
    $serviceIds = @($lab.nodes | ForEach-Object { $_.services } | ForEach-Object { $_.id } | Sort-Object)
    if (($serviceIds -join ',') -ne 'a-text,a-vision,b-tools') {
        throw 'This runtime needs the explicit three-service migration. Exit Harness, run node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime <runtime-directory>, then restart the Demo.'
    }
    if (-not $useReleaseImage -and -not $SkipBuild) {
        Invoke-Checked 'node.exe' @('scripts/prepare-offline-image.mjs')
        Invoke-Checked 'wsl.exe' @('-d', $Distro, '-u', 'root', '--exec', 'env', 'DOCKER_BUILDKIT=0', 'sh', $helper, 'docker', 'build', '--pull=false', '-t', $image, ($report.RepositoryWslPath + '/.runtime/container-build'))
    } else { Invoke-IsolatedDocker @('image', 'inspect', $image, '--format', '{{.Id}}') }

    # Compose merges mounts by target, replacing /lab with this runtime's server-only path.
    $services = [ordered]@{}
    foreach ($service in @('node-a', 'node-b')) {
        $services[$service] = @{ volumes = @(@{ type = 'bind'; source = ($report.RuntimeWslPath + '/server'); target = '/lab'; read_only = $true }) }
    }
    $override = @{ services = $services } | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($overrideFile, $override + "`n", [Text.UTF8Encoding]::new($false))
    $composeArguments = @('compose', '--project-name', 'llm-discovery-demo', '-f', $composeFile, '-f', $overrideWsl)
    Invoke-IsolatedDocker ($composeArguments + @('config', '--quiet'))
    # Remove only retired services belonging to this explicit Compose project.
    Invoke-IsolatedDocker ($composeArguments + @('up', '-d', '--no-build', '--remove-orphans'))
    Invoke-IsolatedDocker ($composeArguments + @('ps'))
    if (-not $SkipDiscoveryCheck) {
        $snapshot = Join-Path $report.RuntimePath 'discovery-latest.json'
        Invoke-Checked 'node.exe' @('packages/lab-controller/cli.mjs', 'browse', '--runtime', $report.RuntimePath, '--interface', $report.WindowsInterfaceAddress, '--seconds', '10', '--output', $snapshot)
        # Windows PowerShell 5.1 emits a JSON array as one pipeline object.
        # Assign first so @() counts its elements, not the outer pipeline item.
        $found = Get-Content -LiteralPath $snapshot -Raw | ConvertFrom-Json
        $foundCount = if ($null -eq $found) { 0 } else { @($found).Count }
        $lab = Get-Content -LiteralPath (Join-Path $report.RuntimePath 'lab.json') -Raw | ConvertFrom-Json
        $expected = @($lab.nodes | ForEach-Object { $_.services }).Count
        if ($foundCount -ne $expected) { throw "Containers started, but discovery found $foundCount of $expected services. Inspect the runtime snapshot and node logs; the containers remain available for diagnosis." }
    }
    Write-Host "Demo ready. Runtime: $($report.RuntimePath)"
    Write-Host "Harness trust file: $(Join-Path $report.RuntimePath 'client/trust.json')"
    Write-Host 'Install or configure the Harness plugin separately using the integration guide.'
} finally { Pop-Location }
