param(
  [string]$BundlePath,
  [string]$FlutterBinary = '_scratch/flutter-toolchain/flutter/bin/flutter.bat',
  [string]$CargoHome,
  [string]$RustupHome,
  [string]$CompilerBin,
  [string]$PubCache,
  [switch]$CreateInstaller,
  [string]$OutputRoot = 'E:/QQAF'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
  if ((git branch --show-current) -notin @('Rust+Slint','RS0.2.0')) { throw 'Clean experimental builds require Rust+Slint.' }
  if (-not $BundlePath) {
    $previousCache = $env:PUB_CACHE
    $previousData = $env:QQAF_NATIVE_DATA_DIR
    $previousCore = $env:QQAF_CORE_EXECUTABLE
    try {
      if ($PubCache) { $env:PUB_CACHE = [IO.Path]::GetFullPath($PubCache) }
      elseif (-not $env:PUB_CACHE) { $env:PUB_CACHE = [IO.Path]::GetFullPath('_scratch/flutter-toolchain/pub-cache') }
      $env:QQAF_NATIVE_DATA_DIR = [IO.Path]::GetFullPath('_scratch/storage-clean-tests-' + [Guid]::NewGuid().ToString('N'))
      $env:QQAF_CORE_EXECUTABLE = [IO.Path]::GetFullPath('native/target/release/qqaf-native.exe')
      & "$PSScriptRoot/build-experimental.ps1" -FlutterBinary $FlutterBinary -CargoHome $CargoHome -RustupHome $RustupHome -CompilerBin $CompilerBin -CleanRelease
    } finally {
      $env:PUB_CACHE = $previousCache
      $env:QQAF_NATIVE_DATA_DIR = $previousData
      $env:QQAF_CORE_EXECUTABLE = $previousCore
    }
    $latest = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'dist') -Directory -Filter 'qqaf-experimental-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw 'Clean bundle was not produced.' }
    $BundlePath = $latest.FullName
  }
  & python "$PSScriptRoot/package-clean-experimental.py" ([IO.Path]::GetFullPath($BundlePath)) --output ([IO.Path]::GetFullPath($OutputRoot))
  if ($LASTEXITCODE -ne 0) { throw 'Clean package verification failed.' }
  if ($CreateInstaller) {
    $version = (Get-Content -LiteralPath (Join-Path $BundlePath 'build-info.json') -Raw | ConvertFrom-Json).version
    & python "$PSScriptRoot/build-windows-installer.py" --version $version --output ([IO.Path]::GetFullPath($OutputRoot))
    if ($LASTEXITCODE -ne 0) { throw 'Installer validation failed.' }
  }
} finally { Pop-Location }
