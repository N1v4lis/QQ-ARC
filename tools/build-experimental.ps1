param(
    [string]$FlutterBinary,
    [string]$CargoHome,
    [string]$RustupHome,
    [string]$CompilerBin,
    [switch]$SkipCoreBuild,
    [switch]$CleanRelease
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    if ((git branch --show-current) -notin @('Rust+Slint','RS0.2.0')) { throw 'Experimental builds require the Rust+Slint branch.' }
    if (-not $FlutterBinary) { $FlutterBinary = (Get-Command flutter -ErrorAction Stop).Source }
    $flutterExe = [IO.Path]::GetFullPath($FlutterBinary)
    & "$PSScriptRoot/sync-flutter-assets.ps1"
    if (-not $SkipCoreBuild) {
        & "$PSScriptRoot/run-native.ps1" -Mode release -CargoHome $CargoHome -RustupHome $RustupHome -CompilerBin $CompilerBin -CleanRelease:$CleanRelease
    }
    $coreExe = Join-Path $repoRoot 'native/target/release/qqaf-native.exe'
    if (-not (Test-Path -LiteralPath $coreExe)) { throw 'Rust release executable missing.' }
    Push-Location flutter
    try {
        & $flutterExe pub get
        if ($LASTEXITCODE -ne 0) { throw 'Flutter dependencies failed; ensure plugin symlink permissions are available.' }
        & $flutterExe analyze --no-pub
        if ($LASTEXITCODE -ne 0) { throw 'Flutter analysis failed.' }
        & $flutterExe test --no-pub
        if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed.' }
        & $flutterExe build windows --release --no-pub
        if ($LASTEXITCODE -ne 0) { throw 'Flutter Windows build failed.' }
    } finally { Pop-Location }
    $version = ((Get-Content flutter/pubspec.yaml | Select-String '^version:').Line -split ':',2)[1].Trim().Split('+')[0]
    $bundle = Join-Path $repoRoot "dist/qqaf-experimental-$version"
    # Unique output directory avoids retaining old binaries from a previous build.
    if (Test-Path -LiteralPath $bundle) { $bundle += '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    New-Item -ItemType Directory -Path $bundle | Out-Null
    $runner = Join-Path $repoRoot 'flutter/build/windows/x64/runner/Release'
    foreach ($name in @('qqaf.exe', 'flutter_windows.dll', 'native_assets.json')) {
        $file = Join-Path $runner $name
        if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $bundle }
    }
    Get-ChildItem -LiteralPath $runner -File -Filter '*_plugin.dll' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $bundle }
    Copy-Item -LiteralPath (Join-Path $runner 'data') -Destination $bundle -Recurse
    # A user may install SnowLuma beside a development executable. Its config,
    # data and native components are never inherited by the QQAF clean build.
    Copy-Item -LiteralPath $coreExe -Destination (Join-Path $bundle 'qqaf-native.exe')
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $vsRoot = & $vswhere -latest -products '*' -property installationPath
        $crt = Get-ChildItem -LiteralPath (Join-Path $vsRoot 'VC/Redist/MSVC') -Directory |
            Where-Object { $_.Name -match '^\d+\.' } |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($crt) {
            $crtPath = Join-Path $crt.FullName 'x64/Microsoft.VC143.CRT'
            if (-not (Test-Path -LiteralPath $crtPath)) { throw 'VC runtime directory missing; do not distribute an incomplete bundle.' }
            Copy-Item -Path (Join-Path $crtPath '*.dll') -Destination $bundle
        } else {
            throw 'VC runtime not found; do not distribute an incomplete bundle.'
        }
    }
    Copy-Item -LiteralPath 'flutter/README.md' -Destination (Join-Path $bundle 'EXPERIMENTAL.md')
    $licenses = Join-Path $bundle 'LICENSES'
    New-Item -ItemType Directory -Path $licenses | Out-Null
    Copy-Item -LiteralPath 'tools/host/QQ-AGENT-LICENSE.txt' -Destination $licenses
    foreach ($assetDir in @('app/ui/assets/model-logos', 'app/ui/assets/mc/fonts')) {
        Get-ChildItem -LiteralPath $assetDir -File | Where-Object { $_.Name -match '(?i)license|source|notice|OFL' } |
            ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $licenses }
    }
    $manifest = @{version=$version;branch=(git branch --show-current);commit=(git rev-parse HEAD);experimental=$true;cleanRelease=[bool]$CleanRelease;snowlumaBundled=$false;workingTreeDirty=[bool](git status --porcelain --untracked-files=no)}
    $manifest | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $bundle 'build-info.json')
    $zip = $bundle + '.zip'
    Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $zip
    Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Select-Object Hash,Path
    Write-Output "Built: $bundle"
} finally { Pop-Location }
