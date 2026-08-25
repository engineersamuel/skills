# cccc complexity gate

A user-level gate that runs [`cccc`](https://github.com/moznion/cccc) after each agent edit. When a
function goes over the cyclomatic or cognitive limit, the harness tells the model to simplify it and
the model fixes the function immediately.

Install everything with one command:

```bash
./tools/cccc/install.sh
```

The command is idempotent. Run it again to upgrade the binary and to repair a stale hook command.

## Layers

| Layer | File | Function |
|---|---|---|
| Analyzer | `~/.local/bin/cccc` | Rust binary. Reports cyclomatic and cognitive complexity as JSON. |
| Adapter | `~/.local/share/cccc-agent/hook.py` | The command each harness runs. Reads hook JSON on stdin, runs the analyzer, writes hook JSON on stdout. Source of truth: `tools/cccc/hook.py`. |
| Pi bridge | `~/.pi/agent/extensions/cccc.ts` | Pi has no command hooks. This TypeScript extension calls the adapter. Template: `tools/cccc/pi-extension.ts`. |

The comparison against the limits is done in the adapter, in Python. The analyzer exit code is not
used as the gate.

## What the installer does

1. Downloads the current `cccc` release tarball for your platform and verifies its SHA256, then
   installs the binary to `~/.local/bin/cccc`.
2. Copies `tools/cccc/hook.py` to `~/.local/share/cccc-agent/hook.py`.
3. Writes `~/.config/cccc/cccc.toml` with `max-cyclomatic = 15` and `max-cognitive = 15`, but only
   when that file does not exist.
4. Wires seven harnesses.
5. Wires each [trellage](https://github.com/engineersamuel/trellage) trx profile it finds. This step
   does nothing when trellage is absent.
6. Runs a probe: it sends a known-bad file through the installed adapter. If the gate does not fire,
   the install fails.

## Wiring

| Harness | Config | Post-edit event | Turn-end event |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | `PostToolUse` | `Stop` |
| Codex | `~/.codex/hooks.json` | `PostToolUse` | `Stop` |
| Copilot CLI | `~/.copilot/hooks/cccc.json` | `postToolUse` | `agentStop` |
| Grok | `~/.grok/hooks/cccc.json` | `PostToolUse` | `Stop` |
| Cursor | `~/.cursor/hooks.json` | `postToolUse` | `stop` |
| Pi | `~/.pi/agent/extensions/cccc.ts` | `tool_result` | none |
| Hermes | `~/.hermes/config.yaml` | `post_tool_call` | `pre_verify` |

Claude, Codex, Cursor, and Hermes use shared config files. The installer changes only the cccc
entry, keeps every other entry, and copies the file to `<name>.bak-cccc` before the first rewrite.
Copilot, Grok, and Pi get their own file.

Each harness reports one status:

- `wired` — a new entry was added.
- `repaired` — a cccc entry with a different command was replaced.
- `unchanged` — nothing was written.
- `manual` — Hermes only. See below.

### Trellage trx profiles

The `trx` launchers keep `$HOME` but point each harness at its own config directory, so a
home-level hook does not apply to those sessions. The installer therefore also wires every profile
under `~/.local/share/trellage/profiles/<launcher>/<profile>/home` for `claude`, `codex`,
`copilot`, and `grok`. Each profile gets its own status line, for example `claude/default wired`.

This step is optional in every sense:

- No trellage directory: the installer writes nothing and prints no profile lines.
- An unsupported launcher, such as `jcode` or `prime`: ignored.
- A profile with an unreadable or invalid config: reported as `skipped (…)`. The rest of the
  install continues.

### Copilot sends no event name

The Copilot CLI payload has `sessionId`, `toolName`, `toolArgs`, and `cwd`, but no event field. The
installer therefore puts `CCCC_EVENT=postToolUse` or `CCCC_EVENT=agentStop` in each hook command.
The matcher is `apply_patch`, which is the one tool Copilot uses for both file creation and file
edits.

### Pi has no turn-end gate

Pi `agent_end` and `agent_settled` are observation-only. Neither can block or add a message. Pi
therefore gets only the `tool_result` gate, which can modify the result: the extension returns the
findings with `isError: true`, so the model sees the failure at the edit and not at the end of the
turn. That is stronger than a turn-end block, so nothing is lost.

### Hermes YAML

The standard library has no YAML writer, so the installer handles two cases:

- `~/.hermes/config.yaml` has no `hooks:` key: the installer appends a well-formed `hooks:` block.
  Every existing key and comment is kept. Status `wired`.
- The file already has a `hooks:` key: the installer merges with PyYAML when PyYAML imports.
  Comments are lost, and the installer says so. Without PyYAML the installer prints the block to
  paste and reports `manual`. It never writes a second `hooks:` key.

Hermes `post_tool_call` output is discarded by the agent, so the Hermes gate is `pre_verify`. Grok
behaves the same way, so its gate is `Stop`.

## Requirements

- `python3` on PATH.
- Network access to `api.github.com` and `github.com` for the release download.
- Write access to `~/.local/bin`, `~/.local/share`, `~/.config`, and to the seven config
  directories above.
- **No Rust toolchain.** The installer downloads a prebuilt binary.

## Consent steps the installer cannot do for you

1. Restart every harness so it reloads its hooks.
2. **Codex**: open `/hooks` and trust the cccc command.
3. **Hermes**: approve the shell hook at a TTY, or start with `--accept-hooks`, or set
   `HERMES_ACCEPT_HOOKS=1`. Check with `hermes hooks list` and `hermes hooks doctor`.

## Environment variables

Installer:

| Variable | Effect |
|---|---|
| `CCCC_VERSION` | Install this release tag instead of the latest one. |
| `CCCC_BIN` | Use this executable and skip the download. |
| `CCCC_FORCE_DOWNLOAD=1` | Download again even when the installed version matches. |

Adapter, at run time:

| Variable | Effect |
|---|---|
| `CCCC_MAX_CYCLOMATIC` | Cyclomatic limit. Highest precedence. |
| `CCCC_MAX_COGNITIVE` | Cognitive limit. Highest precedence. |
| `CCCC_HARNESS` | Output shape. The installer sets this in each hook command. |
| `CCCC_EVENT` | Event name. Copilot sends none, so the installer sets it in the command. |
| `CCCC_HOOK_DEBUG=1` | Write adapter diagnostics to stderr. |

Limit precedence: `CCCC_MAX_*`, then the nearest `cccc.toml` or `.cccc.toml` at or above the edited
file, then `~/.config/cccc/cccc.toml`, then 15 / 15.

Per repository, add a `cccc.toml`:

```toml
max-cyclomatic = 10
max-cognitive = 10
```

## Fail-open

The gate never breaks a session. A missing binary, an unsupported file type, a deleted file, an
analyzer error, or a crash in the adapter all exit 0 with no output.

## Uninstall

Remove the cccc entry from each config:

- `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.cursor/hooks.json` — delete the hook group
  whose command contains `cccc-agent/hook.py`.
- `~/.hermes/config.yaml` — delete the `hooks:` entries that contain `cccc-agent/hook.py`.
- `~/.copilot/hooks/cccc.json`, `~/.grok/hooks/cccc.json`, `~/.pi/agent/extensions/cccc.ts` —
  delete the file.
- `~/.local/share/trellage/profiles/*/*/home/` — delete the same entries in `settings.json`,
  `hooks.json`, and `hooks/cccc.json`.

Then:

```bash
rm -rf ~/.local/share/cccc-agent ~/.cache/cccc-hook
rm -f ~/.local/bin/cccc ~/.config/cccc/cccc.toml
```

Each shared config also has a `<name>.bak-cccc` copy from before the first change.
