#!/usr/bin/env bash
# cargo-audit-reporter (#1311)
#
# Runs `cargo audit` against contracts/Cargo.lock and produces a
# human-readable Markdown vulnerability report, plus a machine-readable
# JSON copy. Exits non-zero when any advisory is found so it can gate CI.
#
# Usage: tools/cargo-audit-reporter/audit-report.sh [output-dir]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/audit-reports}"
mkdir -p "$OUT_DIR"

if ! command -v cargo-audit >/dev/null 2>&1; then
  echo "cargo-audit not found. Install with: cargo install cargo-audit --locked" >&2
  exit 2
fi

JSON_OUT="$OUT_DIR/cargo-audit.json"
MD_OUT="$OUT_DIR/cargo-audit.md"

echo "Running cargo audit against $ROOT_DIR/contracts/Cargo.lock ..."
set +e
cargo audit --file "$ROOT_DIR/contracts/Cargo.lock" --json > "$JSON_OUT"
AUDIT_EXIT=$?
set -e

VULN_COUNT=$(python3 - "$JSON_OUT" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    print(len(data.get("vulnerabilities", {}).get("list", [])))
except Exception:
    print(0)
PY
)

{
  echo "# Soroban contract dependency audit"
  echo
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "Vulnerabilities found: **$VULN_COUNT**"
  echo
  if [ "$VULN_COUNT" -gt 0 ]; then
    python3 - "$JSON_OUT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for v in data.get("vulnerabilities", {}).get("list", []):
    adv = v.get("advisory", {})
    pkg = v.get("package", {})
    print(f"## {adv.get('id', 'unknown')} — {pkg.get('name')} {pkg.get('version')}")
    print()
    print(adv.get("title", ""))
    print()
    print(f"- Severity: {adv.get('cvss') or 'n/a'}")
    print(f"- URL: {adv.get('url', 'n/a')}")
    print()
PY
  else
    echo "No known advisories against the current lockfile."
  fi
} > "$MD_OUT"

echo "Report written to:"
echo "  $MD_OUT"
echo "  $JSON_OUT"

exit "$AUDIT_EXIT"
