Validate this skills repository before handoff.

1. Run `python3 scripts/validate.py`.
2. Run `npx skills add . --list` if discovery or layout changed.
3. Run `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7` if `.github/workflows/release.yml` changed.
4. Inspect the diff for accidental provider coupling or release-tag changes.
5. Report each command and its exact result.
