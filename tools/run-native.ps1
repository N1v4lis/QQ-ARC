param(
    [ValidateSet('test', 'build', 'release', 'run', 'probe', 'smoke', 'format')]
    [string]$Mode = 'test',
    [string]$CargoHome,
    [string]$RustupHome,
    [string]$CompilerBin
)

$ErrorActionPreference = 'Stop'
$nativeRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'native'
if ($CargoHome) {
    $env:CARGO_HOME = [IO.Path]::GetFullPath($CargoHome)
    $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
}
if ($RustupHome) { $env:RUSTUP_HOME = [IO.Path]::GetFullPath($RustupHome) }
if ($CompilerBin) {
    $compilerDirectory = [IO.Path]::GetFullPath($CompilerBin)
    if (-not (Test-Path -LiteralPath (Join-Path $compilerDirectory 'gcc.exe'))) { throw 'GNU compiler not found' }
    $env:PATH = $compilerDirectory + ';' + $env:PATH
    $env:CC = 'gcc'
    $env:CXX = 'g++'
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = 'gcc'
}
$env:CARGO_BUILD_JOBS = '2'
Push-Location $nativeRoot
try {
    switch ($Mode) {
        'test' { cargo test --locked }
        'build' { cargo build --locked }
        'release' { cargo build --release --locked }
        'run' { cargo run --locked }
        'probe' { cargo run --locked --features slint-prototype --bin slint-prototype -- --probe-gpu }
        'smoke' { cargo run --locked --features slint-prototype --bin slint-prototype -- --smoke-test }
        'format' { cargo fmt --check }
    }
    if ($LASTEXITCODE -ne 0) { throw "Native $Mode failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
