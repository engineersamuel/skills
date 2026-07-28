# justify

`justify` is a cross-harness Agent Skill for auditing claims, recommendations, plans, and decisions. It checks local evidence, researches external claims with an available search or research tool when needed, and uses a council for consequential or contested judgment calls.

**Use `justify` as an evidence-based go/no-go check on your current worktree: are these changes applicable, valuable, and worth moving forward with?**

## Quickstart (30-second setup)

Run the skills.sh installer:

```bash
npx skills@latest add engineersamuel/skills
```

Select `justify` and the coding agents where you want it installed.

Run `/justify`, `$justify`, or `$skills:justify` depending on your coding harness. Give it a claim, recommendation, plan, or decision to audit, for example: `Use $justify to audit the recommendation above.`

It will:

- Audit the target against primary evidence.
- Research current external claims with an available search or research tool when needed.
- Convene a real council for consequential or contested judgments.
- Report a verdict, calibrated confidence, claim ledger, citations, and dissent.

You’re ready to pressure-test your next claim or decision.

## Direct install

Claude Code:

```bash
npx skills add engineersamuel/skills --skill justify --agent claude-code
```

Codex:

```bash
npx skills add engineersamuel/skills --skill justify --agent codex
```

These unversioned installs track `main` and are the recommended path.

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

Local repository audits need no extra integration. External claims require an available web search or research capability, such as Exa, Perplexity, Tavily, Firecrawl, or another equivalent tool. No specific provider is required. Consequential or contested judgments require an installed `council` skill or equivalent deliberation workflow with independent live members.

`justify` fails closed when a required capability is absent. It reports the missing pass instead of fabricating research or simulated council output.

## Validate

```bash
python3 scripts/validate.py
npx skills add . --list
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
```

Validation checks Agent Skills metadata, Codex UI metadata, discovery, the audit/external-research/council/failure contract lint, and release support. Forward tests with fresh agents verify behavioral compliance.

## Release

Push a semantic version tag such as `v1.0.0`. GitHub Actions validates the repository, packages the skill as `.tar.gz` and `.zip`, generates checksums, and creates the GitHub release. Do not move an existing release tag.

## License

[MIT](LICENSE)
