# Installs the newest Python 3 (through winget) and the packages the app's Python tool and ML features use.
# Run by the installer after it asks the user. -DryRun only prints what it would do.
param([string]$AppDir = '', [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'chart-terminal-python-setup.log'
function Say($m) { Write-Host $m; Add-Content -Path $log -Value "$(Get-Date -Format s) $m" }

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Say 'winget is not available on this Windows: opening the Python download page instead.'
  if (-not $DryRun) { Start-Process 'https://www.python.org/downloads/windows/' }
  exit 0
}
# Newest "Python.Python.3.x" id the catalog lists (3.9 < 3.14: compare as versions, not text).
$ids = (winget search Python.Python --source winget --accept-source-agreements | Out-String) -split '\s+' |
  Where-Object { $_ -match '^Python\.Python\.3\.\d+$' } | Sort-Object { [version]($_ -replace '^Python\.Python\.', '') } -Unique
$id = $ids | Select-Object -Last 1
if (-not $id) { Say 'Could not find a Python package in winget.'; exit 1 }
Say "Newest Python in winget: $id"
if ($DryRun) { exit 0 }

winget install -e --id $id --scope user --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Say "winget exited with $LASTEXITCODE"; exit 1 }   # -1978335189: already installed and up to date

$req = if ($AppDir) { Get-ChildItem -Path $AppDir -Recurse -Filter requirements.txt -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\/]ml[\\/]' } | Select-Object -First 1 }
if ($req) {
  Say "Installing packages from $($req.FullName)"
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  & py -3 -m pip install --upgrade pip 2>&1 | Out-Null
  & py -3 -m pip install --upgrade -r $req.FullName
  if ($LASTEXITCODE -ne 0) { Say 'pip could not install every package. The app still runs; the Python tool will say which package is missing.'; exit 1 }
}
Say 'Python setup finished.'
