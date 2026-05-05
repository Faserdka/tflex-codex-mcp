param(
    [string]$TflexRoot = "C:\Program Files\T-FLEX CAD 17",
    [string]$Configuration = "Release",
    [string]$BridgeBuildDir = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$programDir = Join-Path $TflexRoot "Program"
$apiDir = Join-Path $TflexRoot "API"
$targetDir = Join-Path $apiDir "TflexCodexBridge"
$applicationsIni = Join-Path $programDir "Applications.ini"
$bridgeId = "76E1DCB8-4336-4B3A-B775-FD4E67F54A21"

if (-not $BridgeBuildDir) {
    # If bridge\Bin\Release exists, assume dev environment. Otherwise, assume release zip.
    $devPath = Join-Path $projectRoot "bridge\Bin\$Configuration"
    if (Test-Path -LiteralPath $devPath) {
        $BridgeBuildDir = $devPath
    } else {
        $BridgeBuildDir = $projectRoot
    }
}

$dllPath = Join-Path $BridgeBuildDir "TflexCodexBridge.dll"
$tfaPath = Join-Path $BridgeBuildDir "TflexCodexBridge.tfa"

if (-not (Test-Path -LiteralPath $dllPath)) {
    throw "Bridge DLL was not found: $dllPath. If building from source, build bridge\TflexCodexBridge.csproj first."
}
if (-not (Test-Path -LiteralPath $tfaPath)) {
    throw "Bridge descriptor was not found: $tfaPath. If building from source, build bridge\TflexCodexBridge.csproj first."
}
if (-not (Test-Path -LiteralPath $programDir)) {
    throw "T-FLEX Program directory was not found: $programDir"
}
if (-not (Test-Path -LiteralPath $applicationsIni)) {
    throw "Applications.ini was not found: $applicationsIni"
}

$bridgeEntry = @"

[$bridgeId]
Type=1
Dll=TflexCodexBridge.dll
Name=Codex MCP Bridge
AutoStart=1
Managed=1
"@

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $dllPath -Destination $targetDir -Force
Copy-Item -LiteralPath $tfaPath -Destination $targetDir -Force

# T-FLEX resolves managed plugins more reliably when the DLL is also beside the host executable.
Copy-Item -LiteralPath $dllPath -Destination $programDir -Force

$applicationsText = Get-Content -Raw -LiteralPath $applicationsIni
if ($applicationsText -notmatch "\[$([regex]::Escape($bridgeId))\]") {
    Add-Content -LiteralPath $applicationsIni -Value $bridgeEntry
}

Write-Host "Installed T-FLEX Codex Bridge to $targetDir"
Write-Host "Registered Codex MCP Bridge in $applicationsIni"
