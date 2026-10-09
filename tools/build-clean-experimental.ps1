param(
  [string]$FlutterBinary = '_scratch/flutter-toolchain/flutter/bin/flutter.bat',
  [string]$CargoHome = '_scratch/rust-toolchain/cargo',
  [string]$RustupHome = '_scratch/rust-toolchain/rustup',
  [string]$CompilerBin = 'E:/CodeX-YSM/qqaf-gnu-compiler/bin',
  [string]$OutputRoot = 'E:/QQAF'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
  if ((git branch --show-current) -ne 'Rust+Slint') { throw 'Clean experimental builds require Rust+Slint.' }
  $env:QQAF_CLEAN_DEFAULTS = '1'
  $env:QQAF_NATIVE_DATA_DIR = [IO.Path]::GetFullPath('_scratch/clean-build-data')
  & "$PSScriptRoot/build-experimental.ps1" -FlutterBinary $FlutterBinary -CargoHome $CargoHome -RustupHome $RustupHome -CompilerBin $CompilerBin
  if ($LASTEXITCODE -ne 0) { throw 'Clean experimental build failed.' }
  $latest = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'dist') -Directory -Filter 'qqaf-experimental-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'Clean bundle was not produced.' }
  $target = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) 'RS0.1.0-First-Light'
  New-Item -ItemType Directory -Path ([IO.Path]::GetFullPath($OutputRoot)) -Force | Out-Null
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $latest.FullName '*') -Destination $target -Recurse -Force
  $archive = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) 'RS0.1.0-First-Light-clean.zip'
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  Compress-Archive -Path (Join-Path $target '*') -DestinationPath $archive
  Get-FileHash -LiteralPath $archive -Algorithm SHA256
  Write-Output "Clean package: $target"
  Write-Output "Clean archive: $archive"
} finally {
  Remove-Item Env:QQAF_CLEAN_DEFAULTS -ErrorAction SilentlyContinue
  Remove-Item Env:QQAF_NATIVE_DATA_DIR -ErrorAction SilentlyContinue
  Pop-Location
}
