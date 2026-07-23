python tools/build.py > pyinstaller_log.txt 2>&1
if ($LASTEXITCODE -eq 0) {
    $compilerCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
    )
    $compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $compiler) {
        throw "Inno Setup 6 wurde nicht gefunden."
    }
    & $compiler installer\EnergyRadar.iss > inno_log.txt 2>&1
    Write-Output "Build Process Complete"
} else {
    Write-Output "PyInstaller failed"
}
