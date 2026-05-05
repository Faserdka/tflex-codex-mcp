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
    $BridgeBuildDir = Join-Path $projectRoot "bridge\Bin\$Configuration"
}

$dllPath = Join-Path $BridgeBuildDir "TflexCodexBridge.dll"
$tfaPath = Join-Path $BridgeBuildDir "TflexCodexBridge.tfa"

# Auto-compile if missing
if (-not (Test-Path -LiteralPath $dllPath) -or -not (Test-Path -LiteralPath $tfaPath)) {
    Write-Host "Bridge DLL not found. Attempting to auto-compile using MSBuild..."

    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $msbuildPath = $null
    if (Test-Path $vswhere) {
        $msbuildPath = & $vswhere -latest -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
    }

    if (-not $msbuildPath) {
        $msbuildPath = Get-Command msbuild.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    }

    if (-not $msbuildPath) {
        # Fallback to .NET Framework directory
        $frameworkDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
        $msbuildPath = Join-Path $frameworkDir "MSBuild.exe"
    }

    if (-not (Test-Path $msbuildPath)) {
        throw "MSBuild could not be found. Please ensure .NET Framework or Visual Studio Build Tools are installed."
    }

    $csproj = Join-Path $projectRoot "bridge\TflexCodexBridge.csproj"
    & $msbuildPath $csproj /p:Configuration=$Configuration /p:Platform=AnyCPU /p:TflexCadDir="$programDir"

    if ($LASTEXITCODE -ne 0) {
        throw "Auto-compilation failed. Please build bridge\TflexCodexBridge.csproj manually."
    }

    if (-not (Test-Path -LiteralPath $dllPath)) {
        throw "Compilation succeeded, but DLL was not found at expected path: $dllPath"
    }
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
