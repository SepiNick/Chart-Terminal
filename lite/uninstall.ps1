<#
 Chart Terminal lite - removes the program, shortcuts and autostart. User data (%APPDATA%\ChartTerminal) is KEPT;
 delete that folder by hand if you want everything gone.   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#>
param(
  [string]$InstallDir  = (Join-Path $env:LOCALAPPDATA 'Programs\ChartTerminal'),
  [string]$ShortcutDir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string]$StartupDir  = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup')
)
$ErrorActionPreference = 'Stop'
$node = Join-Path $InstallDir 'node.exe'
if (Test-Path $node) { & $node (Join-Path $InstallDir 'launcher.mjs') --stop | Out-Null }
foreach ($d in $ShortcutDir, $StartupDir) { Remove-Item (Join-Path $d 'Chart Terminal.lnk') -Force -ErrorAction SilentlyContinue }
Set-Location $env:TEMP   # not inside the folder being deleted
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Write-Host "Removed. Your data was kept."
