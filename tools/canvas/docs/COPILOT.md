# Copilot setup

The supported initial host is GitHub Copilot CLI on Darwin ARM64 under Herdr. The
installer keeps the application independent of the source checkout and
preserves unrelated Copilot settings.

## Personal installation

From the repository:

```sh
cd tools/canvas
bun run install:copilot --dry-run
bun run install:copilot
```

If `herdr-canvas` is already registered, review the dry-run and use:

```sh
bun run install:copilot --replace-existing-mcp
```

## All supported harnesses

From the repository root, use one command for installation and later upgrades:

```sh
mise run herdr-canvas
```

When running an extracted integration archive, approve its checked-in task
definition first if mise requests it:

```sh
mise trust
```

This installs the same versioned application and stable launcher for:

- Copilot CLI: `~/.copilot/skills/herdr-canvas` and
  `~/.copilot/mcp-config.json`;
- Claude Code: `~/.claude/skills/herdr-canvas` and `~/.claude.json`;
- managed `cldx default`: the installer adds only the MCP registration in the
  Trellage-managed profile. Trellage owns skill synchronization for that
  profile;
- Codex: `~/.agents/skills/herdr-canvas` and `~/.codex/config.toml`;
- Pi: `~/.pi/agent/skills/herdr-canvas` and
  `~/.pi/agent/mcp.json`.

Pi uses pinned `pi-mcp-adapter` 2.27.0. The installer adds it with `pi install`
when it is missing and exposes the ten canvas operations as direct Pi tools. Restart each
harness after installation. In an active Pi session, `/reload` refreshes the
MCP surface.

The command is idempotent. Re-run it after updating the repository or
extracting a newer integration archive. It rebuilds the worker bundle with
pinned Bun while reusing the already verified Nono binary when needed. The installer stages dependencies
before replacing the active application, preserves unrelated configuration,
and keeps first-change backups.

The installer:

- copies versioned application files to
  `~/.local/share/herdr-canvas/<version>/`;
- installs `~/.local/bin/herdr-canvas` without changing the invoking working
  directory;
- validates and copies the immutable sandbox runtime, or prepares it only when
  the verified artifact is absent;
- installs the portable skill under
  `$COPILOT_HOME/skills/herdr-canvas/` or
  `~/.copilot/skills/herdr-canvas/`;
- adds one managed activation block to `copilot-instructions.md`;
- merges only the `herdr-canvas` entry in `mcp-config.json`;
- creates `.bak-herdr-canvas` recovery copies before changing existing files.

The runtime preparation step bundles the isolated worker and dependencies. It
is not a TypeScript application build and does not run on ordinary launches or
canvas updates. Release integration archives include this prepared runtime. A
source checkout without it must have the reviewed pinned Nono artifact
available so the installer can prepare it once. The broker and renderer run
trusted `.ts` and `.tsx` files directly with pinned Bun.

Start a fresh Copilot session after installation. Use `/skills`,
`/instructions`, `/mcp`, or `/env` to inspect discovery. `/skills reload`
refreshes skill files in an active session, but changed persistent instructions
require a fresh or resumed session.

Installing this integration does not enable broad MCP permissions and does not
make the server available to unrelated hosts. Do not use
`--allow-all-mcp-server-instructions` to force activation.

## Project customization

Use project scope to install only repository-local application, skill, and
instruction files into a disposable or shared project:

```sh
bun scripts/install.ts --scope project --directory /path/to/project
```

Project scope does not write a user MCP registration. Add MCP access through
the host's supported project configuration. The portable skill remains
provider-neutral; host-specific activation text stays in its integration
directory.

## Opt-in use

Use the short cross-harness trigger `canvas on`:

```text
Canvas on. Plan resumable background jobs with retries, cancellation, and recovery after restart.
Canvas on. Investigate why this retry test fails.
Use herdr-canvas while planning this migration.
```

Prompts without an explicit trigger must remain in chat, including substantial
planning, implementation, investigation, and verification:

```text
Plan resumable background jobs with retries, cancellation, and recovery after restart.
```

Deactivate an active canvas explicitly:

```text
Canvas off.
```

If the MCP is missing or the sandbox is unavailable, the agent reports the
limitation once and continues the requested work in chat.

## Verification record

Deterministic protocol, layout, installer, and sandbox checks prove the
integration contracts. They do not prove model activation. Record fresh-session
ordinary-prompt observations here only after running them, including Copilot
version, model, customization scope, observed tool sequence, and failures.

Verified on 2026-10-05:

| Item | Result |
| --- | --- |
| Copilot | CLI `1.0.92-5` |
| Customization | Personal skill, personal managed instruction, user MCP registration |
| Permissions | Only the `herdr-canvas` MCP server was pre-approved; all-tools and all-server-instructions flags were not used |
| Explicit `canvas on` planning prompt | 1/1 loaded the skill and completed the canvas |
| Observed canvas sequence | Load skill, open architecture template, publish initial complete dataset, apply packaged planning layout, publish final complete dataset, complete |
| Substantial prompt without trigger | 1/1 made no skill or canvas calls |
| Brief factual prompt | 1/1 made no canvas calls under the previous policy |
| Explicit opt-out | 1/1 made no canvas calls under the previous policy |
| Live Herdr integration | `bun run test:live` emitted `live_herdr_integration_ready` from a full-width owned Herdr tab |

One negative host test launched Copilot with `-C` pointing at a temporary
directory that did not match the owning Herdr pane's tracked working directory.
`canvas.open` returned one generic failure and the agent continued the planning
task in chat without retries. Running the fresh session from its owning pane's
working directory passed. This is a Herdr ownership constraint, not a sandbox
or installation failure.
