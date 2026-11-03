[CmdletBinding()]
param(
    [ValidateSet('native', 'windows-x64-wsl')][string]$Platform = 'windows-x64-wsl',
    [string]$ImageArchive,
    [string]$ImageId,
    [string]$OutputDirectory = '.release'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$name = "llm-service-discovery-demo-$version-$Platform"
$stage = Join-Path $output $name
$zip = Join-Path $output ($name + '.zip')
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zip)) { throw 'Release output exists. Select a new output directory; previous files are never overwritten.' }
$prepareArgs = @('--platform', $Platform, '--output', $stage)
if ($Platform -eq 'windows-x64-wsl') {
    if (-not $ImageArchive -or -not $ImageId) { throw 'The WSL release requires ImageArchive and ImageId.' }
    $prepareArgs += @('--image', $ImageArchive, '--image-id', $ImageId)
} elseif ($ImageArchive -or $ImageId) { throw 'The native release does not use a Docker image.' }
& node (Join-Path $PSScriptRoot 'prepare-release.mjs') @prepareArgs
if ($LASTEXITCODE -ne 0) { throw 'Release staging failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# .NET Framework on Windows uses backslashes in CreateFromDirectory entries.
# Emit portable ZIP paths explicitly so macOS/Linux unzip exits successfully.
$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in (Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName)) {
        $entryName = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$digest = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::AppendAllText((Join-Path $output 'SHA256SUMS'), "$digest  $name.zip`n", [Text.UTF8Encoding]::new($false))
Write-Host "Release ZIP: $zip"
Write-Host "SHA-256: $digest"
