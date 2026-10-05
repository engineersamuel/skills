# Herdr canvas: Copilot implementation handoff

> **Latest user override (2026-10-05):** Herdr Canvas is opt-in only. Never
> activate it from task size, complexity, or MCP availability. The preferred
> explicit trigger is `canvas on`. This override supersedes automatic
> activation requirements elsewhere in this handoff and in the copied plan.

## Authorization and objective

The user asked to put the entire canvas project and its automatic agent behavior in the `skills` repository, create a Herdr-managed worktree, copy the relevant implementation and context, and start a Copilot agent to continue implementation and verification. This handoff is that delegated implementation task. Continue working in this worktree; do not stop after proposing another plan.

The intended experience is one-time setup followed by ordinary prompts such as “Plan resumable background jobs with retries and recovery.” Copilot should open an attractive live canvas early, update it as work progresses, ask supported questions in the trusted canvas controls, and leave a useful completed view. The user should not have to name MCP operations or author MDX.

Name the portable skill **`herdr-canvas`**, because the current product requires Herdr. Use `skills/herdr-canvas/SKILL.md` as its canonical entry point. Keep the current `canvas.*` MCP tool names and the configured MCP label `herdr-canvas`. Natural-language requests to “use canvas” should still match the skill description. Do not create duplicate skills just to support both names.

## Workspace and source

- Repository: `/Users/smendenhall/projects/personal/skills`.
- This worktree: `/Users/smendenhall/.herdr/worktrees/skills/worktree-herdr-canvas`.
- Branch: `worktree/herdr-canvas`, based on `main` at `1a68933`.
- Created through `herdr worktree create --workspace wFM`, resulting in workspace label `skills-herdr-canvas` and initial agent pane `wFN:p1`. Herdr IDs are session-local: rediscover them if necessary and use your own inherited `HERDR_PANE_ID`.
- The existing canvas application was copied into `tools/canvas/`: source, tests, scripts, runtime policy/pins, lockfile, design, licenses/notices, and documentation.
- Its existing immutable `generated/runtime-darwin-arm64/` was copied as an ignored local development artifact so initial execution does not require rebuilding. Dependencies were installed with `bun install --frozen-lockfile`. Neither dependencies nor generated assets belong in Git.
- Original canvas checkout: `/Users/smendenhall/projects/personal/canvas`. All its files were untracked and its branch had no commits. It remains intact; the copied files are real application work, not disposable scaffolding. Do not reset, delete, or replace that checkout.

Read the worktree's `AGENTS.md` and relevant repository skills first. The repository already has executable integration tooling under `tools/cccc/`, which is useful precedent for installation and preserving user configuration. Its existing decision to defer Agent Plugins packaging is in `docs/decisions/2026-08-28-agent-plugins-packaging.md`; a plugin/marketplace is not required for this task.

## Plans and precedence

Read these copied documents:

1. `tools/canvas/docs/superpowers/plans/2026-10-05-automatic-canvas.md`: detailed three-part plan and Copilot acceptance matrix.
2. `tools/canvas/docs/plans/full-implementation.md`: original implementation constraints.
3. `tools/canvas/README.md`, `DESIGN.md`, `docs/SECURITY.md`, `docs/TERMINAL_COMPATIBILITY.md`, and `THIRD_PARTY_NOTICES.md`.

This handoff supersedes old paths and naming in the automatic-canvas plan. Map its `.github/skills/canvas/` to `skills/herdr-canvas/`; application source/test/script paths are relative to `tools/canvas/`. Keep thin host-specific activation metadata inside `skills/herdr-canvas/integrations/copilot/`. Record the adapted implementation plan in a tracked `docs/plans/` path because this repository ignores root `docs/superpowers/*`.

## Latest user preference: use Bun without a routine build step

The user specifically asked: “Regarding generating the runtime, can't we just use bun so we don't need a build step?” Treat avoiding manual builds as a design requirement.

- Bun already runs the broker and renderer directly from `.ts`/`.tsx`. The existing Copilot setup does exactly that. Do not require `bun run build` after guidance, broker, renderer, or skill edits merely for transpilation.
- The current `scripts/package-runtime.ts` is a separate sandbox packaging step. It copies pinned Bun and Nono, bundles the worker and its dependencies into `worker.js`, hashes the files, and makes them read-only. The worker runs without repository access or package installation. `src/runner/runtime-bundle.ts` currently validates that layout.
- Bundling is one way to satisfy isolation, not a requirement of TypeScript or Bun. A no-bundle alternative could stage TypeScript plus its exact production dependency closure into a private, read-only runtime directory, pin/hash every required file, and run it directly with Bun. This still requires installation/staging and needs real import-resolution, startup, symlink, cache, and sandbox-denial verification. Do not make the repository or a shared package cache readable to untrusted MDX to avoid a bundling step.
- Prefer the simplest safe user experience: direct Bun execution for trusted code and automatic preparation/refresh of the isolated worker runtime when its actual inputs change. Reuse the existing verified worker artifact for the first migration. If a fully unbundled worker adds substantial complexity, keep one-time/conditional worker bundling behind installation and explain the distinction clearly. No build on each launch or each canvas update.
- Update the plan/docs to distinguish `typecheck`/tests from optional release bundling and sandbox artifact preparation. Preserve version pinning, no dependency auto-install inside the worker, and no unsandboxed fallback.

## Implementation scope

1. **Repository integration and installation.** Keep `tools/canvas/` as a self-contained Bun project. Install the application independently of the source checkout, with a stable launcher such as `~/.local/bin/herdr-canvas` and versioned application/runtime files under `~/.local/share/herdr-canvas/`. Preserve the invoking working directory and inherited Herdr ownership. An installer should set up the runtime, skill, MCP registration, and activation preference for the selected host, initially Copilot. Preserve unrelated settings and provide dry-run, repeatable updates, and recovery. Do not require plugin packaging or modify every host by default.
2. **MCP guidance.** Add concise initialization instructions and specific descriptions for all ten existing tools. Keep strict schemas, including the recently fixed named-argument discovery. The main agent should understand early opening, dataset updates versus layout replacement, questions, errors, completion, and explicit closure without reading implementation source.
3. **Portable `herdr-canvas` skill.** Ship tested planning, delivery, and debugging layouts plus bounded complete dataset examples. Keep instructions host-neutral; put small Copilot-specific activation/configuration details under the skill's integration directory. Follow the skills repo's metadata and discovery conventions, including thin `agents/openai.yaml` where appropriate. Do not make claims of macOS/Herdr independence.
4. **Persistent activation.** Substantial planning, investigation, implementation, and verification should activate the skill automatically when the MCP is available. Brief answers and explicit opt-outs should not. Support explicit “use herdr-canvas” invocation. Install the preference once, preserve user instructions, and document session refresh.
5. **Verification and delivery.** Update skills discovery/validation, root README, appropriate CI and release packaging. Keep the existing Python workflow independent of canvas dependencies where practical; add the macOS checks needed for sandbox execution. Test actual fresh Copilot sessions with ordinary prompts. Do not equate deterministic tool tests with proof of model activation. Do not push, publish, retag, create a PR, or remove the old checkout unless separately requested.

## Behavior to retain

- Main agent owns the canvas connection. A reporter subagent is unnecessary and would need an explicit event feed. Hooks and automatic transcript/tool-event observation are deferred.
- The canvas receives reported progress, not the whole conversation or hidden reasoning. Update before long operations and after real results, at meaningful phase changes, findings, decisions, and completion. Do not simulate progress with a timer or invented percentages.
- Preserve layout and React state with `canvas.set_data`. It replaces the complete named dataset; it does not merge. `canvas.set_layout` resets worker state and swaps only after a valid first render. Use stable IDs and bounded recent activity.
- Trusted choice requests support 2–12 options and return `{ value }`. They have no free-text input. Await actual input before dependent actions; cancellation, timeout, and disconnect do not count as answers. Ask free-text questions in chat and reflect actual answers afterward.
- `canvas.complete` leaves the view visible while the broker is connected. Do not promise durable display after the host exits. `canvas.close` explicitly closes the owned pane. Do not repeatedly reopen a manually closed pane.
- Missing or denied MCP access must not prevent unrelated task work. Explain once and continue in chat. Do not fabricate an answer or bypass sandbox enforcement.
- Preserve contextual terminal colors and the existing PgUp/PgDn, arrow, pause, and focus behavior. Use the established compact visual direction, not a new visual redesign.
- Preserve immutable runtime verification, no inherited worker secrets, network/IPC/subprocess denial, authenticated renderer pipes/socket, terminal sanitization, stale-event rejection, and watchdog limits.

## Current installation and compatibility facts

The default `~/.copilot/mcp-config.json` contains `herdr-canvas` using:

- command: `/Users/smendenhall/projects/personal/canvas/generated/runtime-darwin-arm64/bun`
- args: `/Users/smendenhall/projects/personal/canvas/src/broker/main.ts`
- `CANVAS_RUNTIME_BUNDLE`: `/Users/smendenhall/projects/personal/canvas/generated/runtime-darwin-arm64`

Those are the old installation paths. Preserve that working registration until a replacement is verified. For tests, use a session-scoped additional MCP configuration targeting this worktree, without persisting a temporary worktree path into the global config. Keep the original working setup recoverable.

Copilot CLI inspected here is `1.0.92-4`. It filters MCP initialization instructions unless the server is trusted; do not enable `--allow-all-mcp-server-instructions` merely to make the feature work. The skill and activation preference must work even without those instructions. Tool descriptions remain useful. `/skills reload` refreshes skills; persistent instructions require a fresh/resumed session. Check actual host behavior and supported personal paths, including `COPILOT_HOME`, rather than assuming CLI and every VS Code harness match.

Current pins: Bun `1.4.2`; TypeScript `5.9.3`; Effect and platform-bun `4.0.0-rc.117` because stable 4.0.0 was unavailable; React `19.2.8`; Ink `6.8.0`; MDX `3.1.1`; Nono `0.79.0` from revision `e1f84a33bdfecad82490285ea65058fdabe2028a`; mdxcn revision `9c5c7343ded45587dacda75201f4b56f026787a4`. The reviewed Nono binary is installed locally. Do not silently upgrade it.

## Verification evidence and commands

Before handoff, the original canvas had passed strict typecheck, 130 tests/617 assertions, a production bundle build, and real Herdr integration. The last build emitted a non-fatal upstream `estree-util-build-jsx` JSX-runtime warning. The newest source changes fixed MCP named-argument schemas and advertised/tested PgUp/PgDn scrolling; both are included in the copy.

Fresh worktree preparation results will be recorded below. For subsequent implementation:

```sh
# From worktree root
python3 scripts/validate.py
# Install/use the repository's dev dependencies before running pytest/lint/types.
python3 -m pytest
npx skills add . --list
# Required when editing workflow definitions:
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7

# From tools/canvas
bun install --frozen-lockfile
bun run typecheck
bun test
bun run test:live
```

Run live Herdr tests from your own new pane so inherited ownership is correct. `test:live` creates/removes its own panes. Use real human interaction for a final interactive decision demonstration; distinguish that from synthetic key injection in transport tests.

The initial worktree's `python3 scripts/validate.py` passed. The system Python's `python3 -m pytest -q` could not run because pytest is not installed (`No module named pytest`); this is missing test tooling, not a test failure. `uv` is available. Set up a local test environment without changing unrelated global Python installations.

Fresh relocated-canvas verification completed before launch: `bun install --frozen-lockfile` succeeded, `bun run typecheck` passed, and `bun test` passed all **130 tests / 617 assertions**. `verifySandboxAvailability()` against the copied runtime returned `sandbox_ready`. Byte comparisons of the source, tests, and scripts against the original checkout found no differences. No application or worker rebuild was needed for these checks. The generated runtime is confirmed ignored by Git.

This Copilot session is launched with `--additional-mcp-config @tools/canvas/.canvas/handoff-mcp.json` (an absolute file path is used at launch). It replaces `herdr-canvas` for this session with the copied Bun, broker, and runtime paths. The file is an ignored local development convenience, not the eventual distributable configuration. The global MCP configuration is unchanged.

## Working agreement

Implement and verify the scoped solution autonomously in this worktree. Make routine technical choices and record consequential tradeoffs, especially the direct-Bun/worker-packaging decision. Respect the user's preference to apply design quality during development. Preserve existing files and unrelated user configuration. Keep progress visible in this Copilot pane and, once available, exercise the canvas itself. Stop only for a concrete missing authority or external prerequisite that cannot be resolved within this scope.
