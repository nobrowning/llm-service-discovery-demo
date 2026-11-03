# Run with Windows PowerShell 5.1 or PowerShell 7. No Docker, WSL, or Node
# process is executed: the launcher runs against a disposable mocked fixture.
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$fixtureRoot = Join-Path $temporaryRoot ('llm-discovery-release-test-' + [guid]::NewGuid().ToString('N'))
$fixtureCreated = $false
$script:passed = 0
$mockGlobalNames = @('LlmReleaseLauncherTestCommands', 'LlmReleaseLauncherTestImageId', 'LlmReleaseLauncherTestDiscoveryJson')
foreach ($name in $mockGlobalNames) {
    if (Get-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue) { throw "Test state already exists: $name" }
}
$previousExitCode = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue

function Assert-True([bool]$Value, [string]$Label) {
    if (-not $Value) { throw "FAIL: $Label" }
    $script:passed++
    Write-Output "PASS: $Label"
}
function Write-Manifest([hashtable]$Changes = @{}) {
    $value = @{
        schema = 'llm-discovery-demo-release/v1'
        version = $expectedVersion
        image = @{ file = 'images/demo.tar.gz'; tag = $expectedTag; sha256 = $expectedHash; id = $expectedId }
    }
    foreach ($key in $Changes.Keys) {
        if ($key -in @('schema', 'version')) { $value[$key] = $Changes[$key] }
        else { $value.image[$key] = $Changes[$key] }
    }
    [IO.File]::WriteAllText($manifestFile, ($value | ConvertTo-Json -Depth 4))
}
function Assert-Rejected([hashtable]$Changes, [string]$Expected, [string]$Label) {
    Write-Manifest $Changes
    $rejected = $false
    try { $null = Read-ReleaseImage $fixtureRoot }
    catch { $rejected = $_.Exception.Message -like "*$Expected*" }
    Assert-True $rejected $Label
}
function Save-Report {
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'report.json'), ($report | ConvertTo-Json -Depth 5))
}

try {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'images') -Force | Out-Null
    $fixtureCreated = $true
    $expectedVersion = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json).version
    $expectedTag = 'llm-discovery-demo:' + $expectedVersion
    $expectedId = 'sha256:' + ('a' * 64)
    $manifestFile = Join-Path $fixtureRoot 'release-manifest.json'
    $imageFile = Join-Path $fixtureRoot 'images/demo.tar.gz'
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'package.json'), (@{ version = $expectedVersion } | ConvertTo-Json))
    [IO.File]::WriteAllText($imageFile, 'fixture image bytes')
    $expectedHash = (Get-FileHash -LiteralPath $imageFile -Algorithm SHA256).Hash.ToLowerInvariant()

    # Exercise the implementation's actual validation function without running
    # the remainder of doctor against this computer's network or runtime.
    $parseTokens = $null; $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repositoryRoot 'scripts/doctor.ps1'), [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'doctor.ps1 contains PowerShell syntax errors.' }
    $helper = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-ReleaseImage' }, $true)
    if (-not $helper) { throw 'Read-ReleaseImage was not found in doctor.ps1.' }
    . ([scriptblock]::Create($helper.Extent.Text))

    Assert-True ($null -eq (Read-ReleaseImage $fixtureRoot)) 'source checkout without manifest remains source mode'
    Write-Manifest
    $info = Read-ReleaseImage $fixtureRoot
    Assert-True ($info.Tag -eq $expectedTag -and $info.Sha256 -eq $expectedHash -and $info.Path -eq $imageFile) 'valid release archive metadata and SHA-256'
    Assert-Rejected @{ schema = 'other' } 'schema/version' 'wrong schema rejected'
    Assert-Rejected @{ version = '0.0.0-invalid' } 'schema/version' 'wrong package version rejected'
    Assert-Rejected @{ tag = 'llm-discovery-demo:0.0.0-invalid' } 'image tag' 'wrong image tag rejected'
    Assert-Rejected @{ tag = @($expectedTag) } 'image tag' 'array image tag rejected'
    Assert-Rejected @{ file = '../escape.tar.gz' } 'relative images' 'parent path traversal rejected'
    Assert-Rejected @{ file = 'C:/escape.tar.gz' } 'relative images' 'absolute archive path rejected'
    Assert-Rejected @{ file = 'images\..\escape.tar.gz' } 'relative images' 'backslash traversal rejected'
    Assert-Rejected @{ sha256 = 'xyz' } '64 hexadecimal' 'malformed hash rejected'
    Assert-Rejected @{ sha256 = ('0' * 64) } 'SHA-256 mismatch' 'tampered archive rejected'
    Assert-Rejected @{ file = 'images/missing.tar.gz' } 'archive is missing' 'missing archive rejected'
    Assert-Rejected @{ id = 'wrong' } 'Docker sha256 image id' 'invalid optional image id rejected'
    Write-Manifest @{ id = $null }
    Assert-True ($null -eq (Read-ReleaseImage $fixtureRoot).Id) 'image id is optional'
    Write-Manifest

    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'scripts') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'scripts/doctor.ps1') -Destination (Join-Path $fixtureRoot 'scripts/doctor.ps1')
    $report = & {
        function Get-Command { param($Name, $ErrorAction) return $null }
        & (Join-Path $fixtureRoot 'scripts/doctor.ps1') -AsObject
    }
    Assert-True (-not $report.ReadyToStart -and $report.ReleaseBundlePresent -and $report.ReleaseImage.Tag -eq $expectedTag) 'doctor recognizes release without calling real executables'
    Assert-True (@($report.Problems | Where-Object { $_ -like '*Node.js 24*' }).Count -eq 1) 'doctor explains Node 24 requirement'
    Assert-True (@($report.Problems | Where-Object { $_ -like '*WSL is required*' }).Count -eq 1) 'doctor explains missing WSL'
    Assert-True (@($report.Problems | Where-Object { $_ -like '*base-image export*' }).Count -eq 0) 'release preflight needs no Docker Desktop/base image'

    # Supply a fixed preflight report and mock every external startup command.
    # All file writes made by the copied launcher stay inside this fixture.
    $runtimePath = Join-Path $fixtureRoot '.runtime/current'
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $runtimePath 'lab.json'), '{"nodes":[{"services":[{"id":"a-text"},{"id":"a-vision"},{"id":"b-tools"}]}]}')
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'scripts/start-demo.ps1') -Destination (Join-Path $fixtureRoot 'scripts/start-demo.ps1')
    @'
param($Distro, $RuntimeDir, $DockerContext, [switch]$AsObject)
Get-Content -LiteralPath (Join-Path $PSScriptRoot '../report.json') -Raw | ConvertFrom-Json
'@ | Set-Content -LiteralPath (Join-Path $fixtureRoot 'scripts/doctor.ps1') -Encoding utf8
    $releaseImage = @{ File = 'images/demo.tar.gz'; Path = $imageFile; Tag = $expectedTag; Sha256 = $expectedHash; Id = $expectedId }
    $report = @{
        ReadyToStart = $true; Problems = @(); RepositoryRoot = $fixtureRoot; RepositoryWslPath = '/fixture'
        RuntimePath = $runtimePath; RuntimeWslPath = '/fixture/.runtime/current'; RuntimeExists = $true
        ReleaseImage = $releaseImage; StaticBinariesPresent = $true; ComposeBootstrapRequired = $false
        DependenciesInstalled = $true; ServiceAddress = '192.0.2.2'; WindowsInterfaceAddress = '192.0.2.1'
        BaseImageCached = $true; BaseArchiveAvailable = $false; BuildEngineVersion = $null
    }
    # Explicitly named globals keep mocks available across script scopes. They
    # are reserved above and removed in finally, including after a failed test.
    $global:LlmReleaseLauncherTestCommands = [Collections.Generic.List[string]]::new()
    $global:LlmReleaseLauncherTestImageId = $expectedId
    $global:LlmReleaseLauncherTestDiscoveryJson = '[{"id":"a-text"},{"id":"a-vision"},{"id":"b-tools"}]'
    function wsl.exe {
        $global:LlmReleaseLauncherTestCommands.Add('wsl ' + ($args -join ' '))
        if ($args -contains 'inspect') { Write-Output $global:LlmReleaseLauncherTestImageId }
        $global:LASTEXITCODE = 0
    }
    function node.exe {
        $global:LlmReleaseLauncherTestCommands.Add('node ' + ($args -join ' '))
        if ($args -contains 'browse') {
            $outputIndex = [array]::IndexOf($args, '--output')
            if ($outputIndex -lt 0) { throw 'The discovery fixture requires an output path.' }
            [IO.File]::WriteAllText($args[$outputIndex + 1], $global:LlmReleaseLauncherTestDiscoveryJson)
        }
        $global:LASTEXITCODE = 0
    }
    function docker.exe { throw 'The test must not invoke Docker Desktop.' }
    function npm.cmd { throw 'The test must not install dependencies.' }
    function Invoke-WebRequest { throw 'The test must not download files.' }
    Save-Report
    $plan = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -DryRun | ConvertFrom-Json
    Assert-True (-not $plan.RebuildImage -and $global:LlmReleaseLauncherTestCommands.Count -eq 0 -and $plan.BaseImageSource -like 'not required*') 'release dry-run plans no build and invokes no runtime commands'
    $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -SkipDiscoveryCheck
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*docker image load -i /fixture/images/demo.tar.gz*' }).Count -eq 1) 'release loads archive into isolated daemon'
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*docker build*' -or $_ -like '*prepare-offline-image*' -or $_ -like '*node:24-alpine*' }).Count -eq 0) 'release skips source build and base-image preparation'
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*up -d --no-build*' }).Count -eq 1) 'verified release continues to compose startup'
    $global:LlmReleaseLauncherTestCommands.Clear()
    $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1')
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*cli.mjs browse*' }).Count -eq 1) 'default discovery check accepts three services from an actual JSON array'
    $global:LlmReleaseLauncherTestDiscoveryJson = '[]'
    $rejected = $false
    try { $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') }
    catch { $rejected = $_.Exception.Message -like '*discovery found 0 of 3 services*' }
    Assert-True $rejected 'empty discovery JSON array reports zero services'
    $global:LlmReleaseLauncherTestDiscoveryJson = '[{"id":"a-text"}]'
    $rejected = $false
    try { $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') }
    catch { $rejected = $_.Exception.Message -like '*discovery found 1 of 3 services*' }
    Assert-True $rejected 'single-service discovery JSON array reports one service'
    $global:LlmReleaseLauncherTestCommands.Clear()
    $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -SkipDiscoveryCheck -SkipBuild
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*docker image load*' }).Count -eq 1) 'SkipBuild still verifies and loads release archive'
    $global:LlmReleaseLauncherTestCommands.Clear(); $global:LlmReleaseLauncherTestImageId = 'sha256:' + ('b' * 64)
    $rejected = $false
    try { $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -SkipDiscoveryCheck }
    catch { $rejected = $_.Exception.Message -like '*does not match the release manifest*' }
    Assert-True ($rejected -and @($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*up -d*' }).Count -eq 0) 'wrong loaded image id stops before compose startup'
    $global:LlmReleaseLauncherTestCommands.Clear(); $global:LlmReleaseLauncherTestImageId = $expectedId
    $report.ReleaseImage = $null; Save-Report
    $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -SkipDiscoveryCheck
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like "*docker build --pull=false -t $expectedTag*" }).Count -eq 1) 'source checkout still builds expected current image'
    Assert-True (@($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*docker image load*' }).Count -eq 0) 'source mode does not load a release archive'
    $report.ReleaseImage = $releaseImage; Save-Report
    $global:LlmReleaseLauncherTestCommands.Clear()
    [IO.File]::WriteAllText($imageFile, 'tampered after doctor')
    $rejected = $false
    try { $null = & (Join-Path $fixtureRoot 'scripts/start-demo.ps1') -SkipDiscoveryCheck }
    catch { $rejected = $_.Exception.Message -like '*SHA-256 changed after*' }
    Assert-True ($rejected -and @($global:LlmReleaseLauncherTestCommands | Where-Object { $_ -like '*docker image load*' -or $_ -like '*up -d*' }).Count -eq 0) 'archive changed after preflight is never loaded'
    Write-Output "RESULT: $script:passed release launcher checks passed; all runtime commands were mocked."
} finally {
    foreach ($name in $mockGlobalNames) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    if ($previousExitCode) { $global:LASTEXITCODE = $previousExitCode.Value }
    else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    if ($fixtureCreated) {
        $resolvedFixture = [IO.Path]::GetFullPath((Get-Item -LiteralPath $fixtureRoot -Force).FullName)
        if ($resolvedFixture -cne $fixtureRoot -or -not $resolvedFixture.StartsWith($temporaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path -Leaf $resolvedFixture) -notmatch '^llm-discovery-release-test-[a-f0-9]{32}$' -or
            ((Get-Item -LiteralPath $resolvedFixture -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing to clean an unexpected or redirected fixture path.'
        }
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
