# justify

`justify` is a cross-harness Agent Skill for auditing claims, recommendations, plans, and decisions. It checks local evidence, researches external claims with Exa when needed, and uses a council for consequential or contested judgment calls.

## Install

Claude Code:

```bash
npx skills add engineersamuel/skills --skill justify --agent claude-code
```

Codex:

```bash
npx skills add engineersamuel/skills --skill justify --agent codex
```

Invoke it with `/justify` in Claude Code or `$justify` in Codex. Give it a prior claim or decision to audit, for example: `Use $justify to audit the recommendation above.`

## Requirements

Local repository audits need no extra integration. External claims require Exa MCP or an equivalent primary-source research tool; the Codex metadata declares the Exa endpoint. Consequential or contested judgments require an installed `council` skill or equivalent deliberation workflow with independent live members.

`justify` fails closed when a required capability is absent. It reports the missing pass instead of fabricating research or simulated council output.

## Validate

```bash
python3 scripts/validate.py
npx skills add . --list
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
```

Validation checks Agent Skills metadata, Codex UI metadata, discovery, the audit/Exa/council/failure contract lint, and release support. Forward tests with fresh agents verify behavioral compliance.

## Release

Push a semantic version tag such as `v1.0.0`. GitHub Actions validates the repository, packages the skill as `.tar.gz` and `.zip`, generates checksums, and creates the GitHub release. Do not move an existing release tag.

## License

[MIT](LICENSE)
