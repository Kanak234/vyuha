#!/usr/bin/env bash
# VYUHA — one command: build, test, package, install.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
step() { printf '%s\n' "${BOLD}▸ $1${OFF}"; }
ok()   { printf '%s\n' "  ${GREEN}✓${OFF} $1"; }
warn() { printf '%s\n' "  ${YELLOW}!${OFF} $1"; }
die()  { printf '%s\n' "  ${RED}✗${OFF} $1" >&2; exit 1; }

cd "$(dirname "$0")"
printf '\n%s\n\n' "${BOLD}VYUHA — Code & Structure Visualizer${OFF}"

step "Checking Node"
command -v node >/dev/null 2>&1 || die "Node is not installed. Get it from https://nodejs.org (version 18 or newer)."
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || die "Node 18 or newer is required; this is $(node -v)."
ok "Node $(node -v)"

step "Installing dependencies"
npm install --no-audit --no-fund >/tmp/vyuha-install.log 2>&1 || {
  tail -20 /tmp/vyuha-install.log
  die "npm install failed. The full log is at /tmp/vyuha-install.log"
}
ok "dependencies ready"

step "Vendoring three.js into media/"
npm run vendor >/dev/null 2>&1 || die "Could not copy three.js out of node_modules."
ok "media/three.min.js in place"

step "Compiling TypeScript"
npm run compile >/tmp/vyuha-compile.log 2>&1 || {
  cat /tmp/vyuha-compile.log
  die "TypeScript did not compile."
}
ok "out/ built"

step "Running the test suite"
if npm test >/tmp/vyuha-test.log 2>&1; then
  grep -E "PASSED" /tmp/vyuha-test.log | sed 's/^/  /'
  ok "all suites passed"
else
  tail -30 /tmp/vyuha-test.log
  die "Tests failed. The full log is at /tmp/vyuha-test.log"
fi

step "Packaging the extension"
rm -f ./*.vsix
npx --yes @vscode/vsce@3.9.2 package --allow-missing-repository >/tmp/vyuha-package.log 2>&1 || {
  tail -20 /tmp/vyuha-package.log
  die "Packaging failed. The full log is at /tmp/vyuha-package.log"
}
VSIX=$(ls -1 ./*.vsix 2>/dev/null | head -1)
[ -n "$VSIX" ] || die "No .vsix was produced."
ok "$(basename "$VSIX")  ($(du -h "$VSIX" | cut -f1))"

step "Installing into VS Code"
if command -v code >/dev/null 2>&1; then
  code --uninstall-extension kanak.vyuha >/dev/null 2>&1 || true
  code --install-extension "$VSIX" --force >/dev/null 2>&1 || die "VS Code refused the package."
  ok "installed"
  printf '\n%s\n' "${GREEN}${BOLD}Done.${OFF}"
  printf '%s\n' "${DIM}Restart VS Code, open any source file, and press Ctrl+Alt+V.${OFF}"
else
  warn "the 'code' command is not on your PATH"
  printf '\n%s\n' "  Install it by hand instead:"
  printf '%s\n' "    VS Code → Extensions → ⋯ menu → Install from VSIX…"
  printf '%s\n\n' "    then choose:  $(pwd)/$(basename "$VSIX")"
fi
