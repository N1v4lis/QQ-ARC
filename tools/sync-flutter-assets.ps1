$ErrorActionPreference = 'Stop'
$taskRepoRoot = Split-Path $PSScriptRoot -Parent
$taskAssetRoot = Join-Path $taskRepoRoot 'flutter/assets'
foreach ($taskAssetFolder in @('startup', 'model-logos', 'brand', 'default-icons', 'mc/bg', 'mc/fonts','mc/sfx')) {
    $taskSource = Join-Path $taskRepoRoot ('app/ui/assets/' + $taskAssetFolder)
    $taskDestination = Join-Path $taskAssetRoot $taskAssetFolder
    New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
    Get-ChildItem -LiteralPath $taskSource -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskDestination -Force }
}
Push-Location $taskRepoRoot
try { node tools/native-theme-icons.mjs; if ($LASTEXITCODE -ne 0) { throw 'Pixel icon generation failed' } }
finally { Pop-Location }
