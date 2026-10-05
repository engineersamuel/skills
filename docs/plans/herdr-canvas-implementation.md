# Herdr canvas repository integration

This plan originally adapted
[`tools/canvas/docs/superpowers/plans/2026-10-05-automatic-canvas.md`](../../tools/canvas/docs/superpowers/plans/2026-10-05-automatic-canvas.md)
to this repository. The implementation handoff in
[`herdr-canvas-handoff.md`](herdr-canvas-handoff.md) controls when names or
paths differ.

The user's later opt-in preference supersedes the automatic-activation
requirements in the copied plan and handoff.

## Requirements

- WHEN the user explicitly says `canvas on`, requests `herdr-canvas`, or asks
  for a live Herdr canvas, THE SYSTEM SHALL activate the skill.
- WHEN a prompt does not contain an explicit canvas request, THE SYSTEM SHALL
  keep the canvas inactive regardless of task size or complexity.
- WHEN the explicitly requested skill activates, THE AGENT SHALL open a relevant canvas early,
  publish observed progress at meaningful transitions, and finish with a
  truthful visible result.
- WHEN trusted application code runs, THE SYSTEM SHALL execute TypeScript
  directly with pinned Bun and SHALL NOT require a routine transpilation build.
- WHEN untrusted MDX runs, THE SYSTEM SHALL use the verified immutable worker
  runtime and SHALL NOT expose the repository or a shared dependency cache.
- WHEN worker inputs change, THE INSTALLER SHALL prepare the isolated runtime
  conditionally; ordinary launches and dataset updates SHALL NOT rebuild it.
- WHEN installation changes Copilot files, THE INSTALLER SHALL preserve
  unrelated configuration, create recovery backups, support dry-run, and reject
  ambiguous collisions.
- IF the MCP is missing, denied, or sandbox unavailable, THEN THE AGENT SHALL
  explain once and continue the underlying task in chat.

## Design

The integration has four surfaces:

1. `tools/canvas/` remains a self-contained Bun project. Its broker and renderer
   run TypeScript directly. The worker continues to run from a pinned, hashed,
   read-only runtime under Nono.
2. Broker discovery publishes concise initialization guidance and a specific
   description for every fixed `canvas.*` tool.
3. `skills/herdr-canvas/` provides host-neutral lifecycle rules, a complete
   dataset convention, and tested planning, delivery, and debugging layouts.
   Copilot-specific opt-in text remains under `integrations/copilot/`.
4. `tools/canvas/scripts/install.ts` installs versioned application files, a
   stable launcher, the verified runtime, the skill, the managed activation
   block, and MCP registrations for the selected harnesses. Existing
   registrations require an explicit replacement flag.

The installer reuses `generated/runtime-darwin-arm64/` when present and valid.
If it is absent, the installer runs the existing pinned runtime packaging step.
This conditional sandbox staging is separate from TypeScript execution and is
not a per-launch build.

## Tasks

- [x] Add wire-level MCP guidance and strict discovery tests.
- [x] Add the portable `herdr-canvas` skill and tested layouts.
- [x] Add the dry-run, repeatable, recoverable multi-harness installer.
- [x] Remove the routine build from the default canvas verification command.
- [x] Complete repository validation, documentation, CI, and release packaging.
- [x] Verify a stable installed copy before replacing the old global MCP path.
- [x] Run live Herdr integration and fresh explicit-trigger Copilot acceptance.

## Acceptance

- The application type-checks and all deterministic tests pass.
- Skill discovery lists `herdr-canvas`.
- The installer dry-run reports stable user paths without writes.
- The installed launcher starts from an unrelated working directory and keeps
  the caller's Herdr ownership.
- A fresh Copilot session opens and updates a live canvas after `canvas on`
  without a broad MCP-instruction trust flag.
- A substantial prompt without an explicit trigger does not open a pane.
- The old checkout and its current global MCP registration remain recoverable
  until the installed replacement is verified.
