param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeProject = Join-Path $projectRoot "bridge\TflexCodexBridge.csproj"
$releaseDir = Join-Path $projectRoot "dist"
$zipPath = Join-Path $projectRoot "tflex-codex-mcp-release.zip"

Write-Host "Building T-FLEX Codex Bridge..."
# Find msbuild.exe
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $msbuildPath = & $vswhere -latest -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
}

if (-not $msbuildPath) {
    # Fallback to checking PATH
    $msbuildPath = Get-Command msbuild.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $msbuildPath) {
        throw "MSBuild could not be found. Please ensure Visual Studio or Build Tools are installed."
    }
}

& $msbuildPath $bridgeProject /p:Configuration=$Configuration /p:Platform=AnyCPU
if ($LASTEXITCODE -ne 0) {
    throw "Build failed."
}

Write-Host "Preparing release folder..."
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

$bridgeBinDir = Join-Path $projectRoot "bridge\Bin\$Configuration"
Copy-Item (Join-Path $bridgeBinDir "TflexCodexBridge.dll") $releaseDir
Copy-Item (Join-Path $bridgeBinDir "TflexCodexBridge.tfa") $releaseDir
Copy-Item (Join-Path $projectRoot "install-tflex-plugin.ps1") $releaseDir
Copy-Item (Join-Path $projectRoot "README.md") $releaseDir
Copy-Item (Join-Path $projectRoot "LICENSE") $releaseDir
Copy-Item (Join-Path $projectRoot "mcp") (Join-Path $releaseDir "mcp") -Recurse
Copy-Item (Join-Path $projectRoot "examples") (Join-Path $releaseDir "examples") -Recurse

Write-Host "Creating ZIP archive..."
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}
Compress-Archive -Path "$releaseDir\*" -DestinationPath $zipPath

Write-Host "Cleaning up..."
Remove-Item -Recurse -Force $releaseDir

Write-Host "Success! Created release package: $zipPath"
