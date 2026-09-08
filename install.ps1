# PlainScript Standalone Binary Installer (Windows PowerShell)
# Installs zero-dependency precompiled plainscript.exe to LocalAppData.
$ErrorActionPreference = "Stop"

$Repo = "ayoistooslick/plainscript"
$InstallDir = Join-Path $env:LOCALAPPDATA "PlainScript\bin"
$ExePath = Join-Path $InstallDir "plainscript.exe"

Write-Host "Fetching latest PlainScript release metadata..." -ForegroundColor Cyan
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{"User-Agent"="PlainScript-Installer"}
    $Tag = $Release.tag_name
} catch {
    $Tag = "v1.1.0"
}

$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/plainscript-windows-x64.exe"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Write-Host "Downloading PlainScript ($Tag) for Windows x64..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing

Write-Host "Adding $InstallDir to user PATH environment variable..." -ForegroundColor Cyan
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
}

Write-Host "✓ Successfully installed PlainScript to $ExePath" -ForegroundColor Green
Write-Host ""
Write-Host "PlainScript is ready to use!" -ForegroundColor Green
Write-Host "  plainscript version"
Write-Host "  plainscript new my-app"
