<#
 Chart Terminal lite - per-user install (no admin). Run from the unzipped portable folder:
   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Autostart]
 Upgrading = run it again from the newer folder (user data is never touched).
 -InstallDir / -ShortcutDir / -StartupDir exist for testing; the defaults are the real per-user locations.
#>
param(
  [string]$InstallDir  = (Join-Path $env:LOCALAPPDATA 'Programs\ChartTerminal'),
  [string]$ShortcutDir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string]$StartupDir  = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'),
  [switch]$Autostart
)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
if (-not (Test-Path (Join-Path $src 'node.exe'))) { throw "node.exe not found next to install.ps1 - run it from the unzipped portable folder." }

# Stop a running copy first so its files are not locked.
$old = Join-Path $InstallDir 'node.exe'
if (Test-Path $old) { & $old (Join-Path $InstallDir 'launcher.mjs') --stop | Out-Null }

New-Item -ItemType Directory -Force $InstallDir | Out-Null
# Replace the program files only; a clean copy avoids stale files from an older version.
Get-ChildItem $InstallDir -Force | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src '*') $InstallDir -Recurse -Force

# Shortcuts need an .ico: write one that wraps icon.png (PNG-in-ICO, supported since Vista).
$png = [IO.File]::ReadAllBytes((Join-Path $InstallDir 'icon.png'))
$ms = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
$w.Write([uint32]$png.Length); $w.Write([uint32]22); $w.Write($png); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $InstallDir 'icon.ico'), $ms.ToArray())

function New-Link($dir, $name) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $dir "$name.lnk"))
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $s.Arguments = '"' + (Join-Path $InstallDir 'chart-terminal.vbs') + '"'
  $s.WorkingDirectory = $InstallDir
  $s.IconLocation = Join-Path $InstallDir 'icon.ico'
  $s.Description = 'Chart Terminal'
  $s.Save()
}
New-Link $ShortcutDir 'Chart Terminal'
$auto = Join-Path $StartupDir 'Chart Terminal.lnk'
if ($Autostart) { New-Link $StartupDir 'Chart Terminal' } elseif (Test-Path $auto) { Remove-Item $auto -Force }

Write-Host "Installed to $InstallDir"
Write-Host "Start Menu: 'Chart Terminal'. Autostart: $([bool]$Autostart). Stop the background server: chart-terminal.cmd --stop"
