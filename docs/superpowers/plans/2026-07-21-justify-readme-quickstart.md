# Justify README Quickstart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give new users a 30-second interactive quickstart that explains how to install, invoke, and use `justify`.

**Architecture:** Change only the opening installation content in `README.md`. Keep the existing project summary and all detailed upgrade, pinned-install, requirements, validation, release, and license guidance intact.

**Tech Stack:** Markdown, Python repository validator, skills CLI

---

### Task 1: Replace the installation opening with the approved quickstart

**Files:**
- Modify: `README.md:1-45`
- Reference: `docs/superpowers/specs/2026-07-21-justify-readme-quickstart-design.md`

- [ ] **Step 1: Confirm the new quickstart is absent before editing**

Run:

```bash
rg -n -F '## Quickstart (30-second setup)' README.md
```

Expected: exit 1 with no matches.

- [ ] **Step 2: Replace the current `Install` section**

Keep the existing `# justify` heading and summary paragraph. Replace everything from `## Install` through the sentence ending in `Use $justify to audit the recommendation above.` with:

````markdown
## Quickstart (30-second setup)

Run the skills.sh installer:

```bash
npx skills@latest add engineersamuel/skills
```

Select `justify` and the coding agents where you want it installed.

Run `/justify` in Claude Code or `$justify` in Codex. Give it a claim, recommendation, plan, or decision to audit, for example: `Use $justify to audit the recommendation above.`

It will:

- Audit the target against primary evidence.
- Research current external claims with Exa when needed.
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
````

- [ ] **Step 3: Verify the README content contract**

Run:

```bash
rg -n -F '## Quickstart (30-second setup)' README.md
rg -n -F 'npx skills@latest add engineersamuel/skills' README.md
rg -n -F 'Select `justify` and the coding agents where you want it installed.' README.md
rg -n -F 'Run `/justify` in Claude Code or `$justify` in Codex.' README.md
rg -n -F 'You’re ready to pressure-test your next claim or decision.' README.md
! rg -n -i 'setup-matt-pocock-skills|Bam' README.md
```

Expected: each required-string search returns one match; the forbidden-string search returns no matches.

- [ ] **Step 4: Run repository verification**

Run:

```bash
git diff --check
python3 scripts/validate.py
npx skills add . --list
```

Expected: no whitespace errors, `all validations passed`, and exactly one discovered skill named `justify`.

- [ ] **Step 5: Review scope and commit**

Run:

```bash
git diff -- README.md
git status --short
git add README.md
git commit -m "docs: add justify quickstart"
```

Expected: the README diff contains only the approved opening rewrite; the commit succeeds.
