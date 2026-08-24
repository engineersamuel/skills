# Agent Skills

Portable skills for repository delivery, evidence audits, goal-loop prompts, and RunWisp job-package authoring.

- `finish` commits current work, rebases on `origin/main`, creates a PR, enables squash auto-merge, and monitors it until merged.
- `justify` audits claims, recommendations, plans, and decisions against evidence and dissent.
- `goal-me` steers a free-form request into a filled goal-loop prompt and writes it to `GOAL.md`.
- `runwisp-job-authoring` creates, changes, diagnoses, and validates filesystem job packages built for [`runwisp-jobkit`](https://github.com/engineersamuel/runwisp-jobkit).

## Quickstart (30-second setup)

Run the skills.sh installer:

```bash
npx skills@latest add engineersamuel/skills
```

Select either skill and the coding agents where you want it installed.

Invoke the installed skill using your harness syntax:

```text
Use $justify to audit the recommendation above.
Use $goal-me to turn this request into a GOAL.md.
Use $runwisp-job-authoring to create and validate this RunWisp job package.
Use $finish to commit this work and monitor its PR until merged.
```

`goal-me` will:

- Interview until `TASK` and `SUCCESS CRITERIA` are strict enough to score.
- Write the filled goal-loop prompt to `GOAL.md`, or `GOAL-<id>.md` if `GOAL.md` already exists.

`justify` will:

- Audit the target against primary evidence.
- Research current external claims with an available search or research tool when needed.
- Convene a real council for consequential or contested judgments.
- Report a verdict, calibrated confidence, claim ledger, citations, and dissent.

You’re ready to pressure-test your next claim or decision.

## Direct install

Claude Code:

```bash
npx skills add engineersamuel/skills --skill justify --agent claude-code
npx skills add engineersamuel/skills --skill goal-me --agent claude-code
npx skills add engineersamuel/skills --skill runwisp-job-authoring --agent claude-code
npx skills add engineersamuel/skills --skill finish --agent claude-code
```

Codex:

```bash
npx skills add engineersamuel/skills --skill justify --agent codex
npx skills add engineersamuel/skills --skill goal-me --agent codex
npx skills add engineersamuel/skills --skill runwisp-job-authoring --agent codex
npx skills add engineersamuel/skills --skill finish --agent codex
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

Pin `runwisp-job-authoring` or `goal-me` only to a future release tag that contains it. This repository change does not create or move a tag.

## Requirements

Local repository audits need no extra integration. External claims require an available web search or research capability, such as Exa, Perplexity, Tavily, Firecrawl, or another equivalent tool. No specific provider is required. Consequential or contested judgments require an installed `council` skill or equivalent deliberation workflow with independent live members.

`justify` fails closed when a required capability is absent. It reports the missing pass instead of fabricating research or simulated council output.

`runwisp-job-authoring` needs access to the target repository and current Jobkit documentation. Running `doctor` or a safe dry run also requires an installed `runwisp-job` command and the package's declared runtime inputs.

`goal-me` needs write access to the current working directory. It uses an installed `grill-me` skill when one is present.

## Validate

```bash
python3 scripts/validate.py
npx skills add . --list
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
```

Validation checks Agent Skills metadata, Codex UI metadata, discovery, behavior contracts, and release support. Forward tests with fresh agents verify behavioral compliance.

## Release

Push a semantic version tag such as `v1.0.0`. GitHub Actions validates the repository, packages each published skill as `.tar.gz` and `.zip`, generates checksums, and creates the GitHub release. Do not move an existing release tag.

## License

[MIT](LICENSE)
