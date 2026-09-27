# cargo-audit-reporter (#1311)

Wraps `cargo audit` against `contracts/Cargo.lock` and produces:
- `audit-reports/cargo-audit.json` — raw machine-readable output
- `audit-reports/cargo-audit.md` — human-readable Markdown summary, one section per advisory

## Usage

```bash
cargo install cargo-audit --locked   # once
tools/cargo-audit-reporter/audit-report.sh
```

Exits non-zero when `cargo audit` finds any advisory, so it can gate CI:

```yaml
- run: tools/cargo-audit-reporter/audit-report.sh
```
