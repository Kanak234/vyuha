# VYUHA — one command: build, test, package, install.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($m) { Write-Host "> $m" -ForegroundColor White }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [x] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "VYUHA - Code & Structure Visualizer" -ForegroundColor Cyan
Write-Host ""

Step "Checking Node"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node is not installed. Get it from https://nodejs.org (version 18 or newer)."
}
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) { Die "Node 18 or newer is required; this is $(node -v)." }
Ok "Node $(node -v)"

Step "Installing dependencies"
npm install --no-audit --no-fund *> "$env:TEMP\vyuha-install.log"
if ($LASTEXITCODE -ne 0) { Get-Content "$env:TEMP\vyuha-install.log" -Tail 20; Die "npm install failed." }
Ok "dependencies ready"

Step "Vendoring three.js into media/"
npm run vendor *> $null
if ($LASTEXITCODE -ne 0) { Die "Could not copy three.js out of node_modules." }
Ok "media/three.min.js in place"

Step "Compiling TypeScript"
npm run compile *> "$env:TEMP\vyuha-compile.log"
if ($LASTEXITCODE -ne 0) { Get-Content "$env:TEMP\vyuha-compile.log"; Die "TypeScript did not compile." }
Ok "out/ built"

Step "Running the test suite"
npm test *> "$env:TEMP\vyuha-test.log"
if ($LASTEXITCODE -ne 0) { Get-Content "$env:TEMP\vyuha-test.log" -Tail 30; Die "Tests failed." }
Select-String -Path "$env:TEMP\vyuha-test.log" -Pattern "PASSED" | ForEach-Object { Write-Host "  $($_.Line)" }
Ok "all suites passed"

Step "Packaging the extension"
Remove-Item *.vsix -ErrorAction SilentlyContinue
npx --yes @vscode/vsce@3.9.2 package --allow-missing-repository *> "$env:TEMP\vyuha-package.log"
if ($LASTEXITCODE -ne 0) { Get-Content "$env:TEMP\vyuha-package.log" -Tail 20; Die "Packaging failed." }
$vsix = Get-ChildItem *.vsix | Select-Object -First 1
if (-not $vsix) { Die "No .vsix was produced." }
Ok "$($vsix.Name)"

Step "Installing into VS Code"
if (Get-Command code -ErrorAction SilentlyContinue) {
  code --uninstall-extension kanak.vyuha *> $null
  code --install-extension $vsix.FullName --force *> $null
  Ok "installed"
  Write-Host ""
  Write-Host "Done." -ForegroundColor Green
  Write-Host "Restart VS Code, open any source file, and press Ctrl+Alt+V."
} else {
  Warn "the 'code' command is not on your PATH"
  Write-Host "  Install it by hand: VS Code -> Extensions -> ... -> Install from VSIX..."
  Write-Host "  then choose: $($vsix.FullName)"
}
