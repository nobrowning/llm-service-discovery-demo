[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ImageArchive,
    [Parameter(Mandatory = $true)][string]$ImageId,
    [string]$OutputDirectory = '.release'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$name = "llm-service-discovery-demo-$version-windows-x64-wsl"
$stage = Join-Path $output $name
$zip = Join-Path $output ($name + '.zip')
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zip)) { throw 'Release output exists. Select a new output directory; previous files are never overwritten.' }
& node (Join-Path $PSScriptRoot 'prepare-release.mjs') --image $ImageArchive --image-id $ImageId --output $stage
if ($LASTEXITCODE -ne 0) { throw 'Release staging failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$digest = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), "$digest  $name.zip`n", [Text.UTF8Encoding]::new($false))
Write-Host "Release ZIP: $zip"
Write-Host "SHA-256: $digest"
