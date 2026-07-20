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

These unversioned installs track `main` and are the recommended path.

Invoke it with `/justify` in Claude Code or `$justify` in Codex. Give it a prior claim or decision to audit, for example: `Use $justify to audit the recommendation above.`

## Upgrade

Upgrade the project installation:

```bash
npx skills update justify -p
```

Upgrade the global installation:

```bash
npx skills update justify -g
```

## Pinned install

For a reproducible install, pin a release tag:

```bash
npx skills add 'engineersamuel/skills#v1.0.0' --skill justify --agent codex
```

Pinned upgrades require reinstalling with the new tag, for example `#v1.1.0`. `skills update` preserves the existing tag.

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
