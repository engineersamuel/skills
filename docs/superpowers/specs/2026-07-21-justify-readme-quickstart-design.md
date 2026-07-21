# Justify README Quickstart Design

## Goal

Make the README immediately actionable for a new user while retaining detailed installation, upgrade, validation, and release guidance.

## Design

Retain the `justify` title and summary paragraph. Replace the current opening installation section with a `Quickstart (30-second setup)` section that:

1. Leads with the interactive installer:

   ```bash
   npx skills@latest add engineersamuel/skills
   ```

2. Tells the user to select `justify` and the coding agents where they want it installed.
3. Shows both invocation forms: `/justify` for Claude Code and `$justify` for Codex.
4. Explains that `justify`:
   - audits claims and decisions against primary evidence;
   - researches current external claims with Exa when needed;
   - convenes a real council for consequential or contested judgments; and
   - reports a verdict, calibrated confidence, claim ledger, citations, and dissent.
5. Closes with: “You’re ready to pressure-test your next claim or decision.”

Keep the existing direct Claude Code and Codex install commands under a `Direct install` heading. Preserve the existing upgrade, pinned-install, requirements, validation, release, and license sections.

## Validation

- Run `python3 scripts/validate.py`.
- Run `npx skills add . --list` and confirm only `justify` is discovered.
- Review the rendered Markdown structure and confirm no setup-skill reference or “Bam” remains.

## Scope

Change only `README.md` during implementation. Do not change the skill, validator, packaging, or release workflow.
