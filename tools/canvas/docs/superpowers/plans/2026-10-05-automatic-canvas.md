# Automatic Canvas Implementation Plan

> **Superseded:** This historical plan describes automatic activation. The
> shipped integration is explicit opt-in only. Use `canvas on` to activate it.

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking. No parallel agents are required.

**Goal:** After one-time Copilot setup, ordinary requests for substantial work produce a useful live canvas without the user naming tools, choosing components, or writing MDX.

**Architecture:** The existing MCP server publishes a concise usage contract and descriptive tools. A reusable `canvas` skill supplies the detailed workflow and tested MDX layouts. A short persistent Copilot instruction activates that skill for substantial tasks. The main agent remains the canvas writer and supplies progress at meaningful transitions.

**Tech stack:** Existing Bun 1.4.2, TypeScript 5.9.3, MCP SDK 1.30.1, Zod 4.1.12, React 19, Ink 6, and sandboxed MDX runtime. Markdown agent skills and Copilot custom instructions. No new dependencies.

**Spec:** The accepted three-part design in this conversation, made concrete in this document's Behavior contract. Hooks, transcript observation, and reporter subagents are outside this implementation.

## Global constraints

- Preserve the ten existing tool names, strict inputs, sandbox, pane ownership, and authenticated decision controls.
- Activation is a user preference implemented through model instructions, not a guarantee imposed by the MCP protocol.
- The MCP cannot observe unrelated tool calls or the conversation. Show reported activity and evidence; do not claim continuous telemetry or expose internal reasoning.
- Keep application logic unchanged unless acceptance testing identifies a separately explained defect. Do not add a new reporting API or change the default templates in this phase.
- Preserve the terminal design in `DESIGN.md`: ENERGY 2 / RHYTHM 2 / MOTION 1, compact hierarchy, contextual color with labels, stable layouts, and bounded activity history.
- Never require a reporter subagent, shell-based canvas driver, or a second broker connection to use the workflow.
- Do not install global instructions, change MCP permissions, or alter the user's active Copilot sessions while merely preparing this plan.
- All repository contents currently appear untracked. During implementation, preserve existing work and do not stage the entire repository or automatically commit unrelated files.

## Evidence and compatibility

- `src/broker/main.ts` currently provides only generic tool descriptions and no MCP initialization instructions. The installed SDK accepts `new McpServer(info, { instructions })`.
- `src/broker/runtime-backend.ts` supplies minimal slot-based templates. Rich presentation will come from the skill's layout files, sent through the existing `canvas.set_layout` operation.
- `canvas.set_data` replaces a complete named JSON dataset; it does not merge fields. Updating a dataset keeps the healthy worker and its React state. Replacing a layout resets component state.
- `canvas.request_input` currently accepts 2–12 options and returns `{ value: string }`. It has no free-text input. Only one decision may be pending.
- `canvas.complete` keeps the completed display while the broker remains connected. Broker disconnection still invokes the existing cleanup/grace behavior; do not promise durable display after a CLI process exits.
- Local inspection found Copilot CLI `1.0.92-4`. Its help documents `--allow-all-mcp-server-instructions`: initialization instructions are otherwise filtered to trusted servers. The workflow must work without enabling this broad flag.
- Copilot CLI supports personal and repository skills and always-on instruction files. Skills can be reloaded; changed persistent instructions require a new or resumed session. VS Code support varies by active agent harness, so document its setup separately.

First-party references, checked during planning:

- [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
- [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [VS Code skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

## Behavior contract

### Activation and ownership

Activate when the user names the `canvas` skill, asks for a live canvas, or names the configured canvas MCP server. With persistent activation enabled, also activate for multi-step planning, investigation, implementation, and verification tasks. Skip brief factual answers and trivial edits unless explicitly requested. Explicit instructions such as “no canvas for this task” take priority.

Open before substantial task work, after only the minimum checks needed to discover the MCP tools and skill. If a small task develops into an investigation, activate when that becomes clear. Do not postpone the first display until the work is complete.

Use one writer on the main agent's existing MCP connection. Delegated workers, if the host already uses them, send findings to the main agent. They do not open their own canvases or issue concurrent decisions. Resolve host-prefixed tool names through discovery rather than guessing their exposed spelling or depending on the configured server label.

If the MCP is missing, disabled, denied, or reports `sandbox_unavailable`, explain the limitation once and continue the requested task in chat. Do not install software or change permissions as an automatic recovery step. Missing canvas access must not block unrelated work.

### Lifecycle and update policy

1. Open with `architecture` for planning/design, `debug` for investigation, or `delivery` for implementation/testing. Use `blank` only for a deliberately custom layout.
2. For the rich path, read the matching packaged layout, initialize `data.canvas`, then call `canvas.set_layout` once. Read the catalog only when using components beyond the tested examples.
3. Maintain the layout and replace `data.canvas` after meaningful findings, plan changes, tool outcomes, phase transitions, questions, and completion. Include all retained fields in every replacement.
4. Publish the activity before a long-running operation and its evidence afterward. Update during the operation only when the host actually yields intermediate results. Do not use timers, invented percentages, or repeated no-change updates to simulate activity.
5. Start with a single summary and the relevant work sections. Keep at most eight recent activity entries. Use stable step identities and chronological evidence. Display progress as completed known steps over total known steps when that denominator exists; otherwise show the phase and current activity.
6. Replace the layout only when the task's presentation needs materially change. For a new task in the same session, reset the dataset and use its appropriate layout; do not carry stale findings into it.
7. Finish with results, evidence, unresolved items, and a truthful task state, then call `canvas.complete`. Call `canvas.close` only when the user asks to close the canvas.

Do not infer the cause of a generic `invalid_request`. Correct a visibly malformed call once; stop repeated failed canvas calls and report the limitation. Do not automatically reopen a manually closed pane. If closure becomes known through the conversation or a disconnect, keep working in chat until the user requests reopening. The current MCP has no pane-visibility query, so the workflow cannot promise immediate detection of manual closure.

### Decisions and presentation

When a supported choice affects the next action, show concise context in the document and ask through `canvas.request_input`. Await its actual returned value before taking dependent action. Do not turn document buttons or a `Decision` component into an approval mechanism. Cancellation, timeout, and disconnection are not answers. If a question needs free text, use normal chat and reflect the answer in the canvas afterward.

Layouts share a visible task title, phase, and current activity. Planning emphasizes steps, options, findings, and unresolved questions; delivery emphasizes steps, changes, and verification; debugging emphasizes symptoms, hypotheses, experiments, and results. Empty sections are omitted. Diagrams or comparison tables appear only when the data warrants them. Use native supported components and semantic labels so the renderer's existing contextual colors apply. Long details remain scrollable, including PgUp/PgDn, without burying the current activity at the bottom.

## File map

| File | Responsibility |
| --- | --- |
| `src/broker/guidance.ts` (new) | Concise MCP initialization instructions and typed descriptions for every existing tool. |
| `src/broker/main.ts` | Register that guidance alongside the existing schemas. |
| `test/mcp-schema.test.ts` | Verify guidance is present on the real MCP wire and schemas remain strict. |
| `.github/skills/canvas/SKILL.md` (new) | Discoverable workflow, activation rules, decisions, recovery, and links to resources. |
| `.github/skills/canvas/references/state.md` (new) | Shared dataset convention, complete update examples, and no-skill/low-MDX fallback. |
| `.github/skills/canvas/layouts/{planning,delivery,debug}.mdx` (new) | Three tested, data-driven terminal layouts. |
| `test/canvas-skill-layouts.test.ts` (new) | Execute the shipped layouts and verify real dataset transitions and bounded rendering. |
| `integrations/copilot/activation.md` (new) | Canonical short persistent activation instruction. |
| `scripts/install-copilot.ts` (new) | Install skill assets and merge the activation block without disturbing user instructions. |
| `test/copilot-install.test.ts` (new) | Verify installer preservation, idempotence, dry-run, and collision behavior in temporary directories. |
| `docs/COPILOT.md` (new), `README.md` | One-time setup, ordinary usage, host limitations, and verified acceptance results. |
| `package.json` | Add `copilot:install` script without changing dependencies. |

## Review focus

1. MCP instructions are filtered: skill plus persistent activation must still produce useful updates. Verify in a fresh real Copilot session without the broad trust flag.
2. A prompt contains no canvas terminology: substantial work should activate; a brief answer or explicit opt-out should not. Verify with the prompt matrix below.
3. Partial state updates erase prior work or recompile the document: layouts and examples must retain full state and use dataset updates. Cover in layout execution tests.
4. A decision is cancelled, requires free text, or the pane disappears: the agent must not invent an answer or reopen repeatedly. Cover in host scenarios and existing decision lifecycle tests.
5. Installation encounters existing instructions, an unrelated `canvas` skill, or a symlink: preserve existing content and reject ambiguous targets. Cover in installer tests.

## Task 1: Make the MCP explain its workflow

**Interfaces:** Export `canvasServerInstructions: string` and `canvasToolDescriptions: Readonly<Record<(typeof toolNames)[number], string>>` from `src/broker/guidance.ts`. Existing tool names, inputs, and outputs remain authoritative.

- [ ] Extend the real stdio MCP test to inspect `client.getInstructions()` after initialization, require nonempty workflow guidance, and verify every discovered tool has specific guidance rather than the current generated placeholder. Keep existing named-argument and strict-input assertions. Run `bun test test/mcp-schema.test.ts` and confirm the missing metadata fails.
- [ ] Write a compact initialization contract covering selection of a template, early opening, data updates versus layout replacement, trusted decisions, graceful failure, and completion. Keep the full presentation recipes in the skill.
- [ ] Give each of the ten tools a description of when to use it, its important argument semantics, and its lifecycle effect. Explicitly describe full replacement for datasets, shallow merge for patches, state reset for layout replacement, and the distinction between complete and close. Explain that repeated open reuses the owned session rather than switching its layout.
- [ ] Wire the exports into `McpServer` construction and `registerTool`, retaining `toolInputSchemas` and handler validation. Avoid adding alternate registrations or changing error payloads in this task.
- [ ] Run `bun test test/mcp-schema.test.ts test/tools.test.ts` and `bun run typecheck`. Review descriptions against `backend.ts` and `session.ts`; assertions on metadata transport cannot prove prose correctness.

**Acceptance:** A client can discover how to use the canvas without reading repository source. Discovery does not start the sandbox or open a pane. Clients that filter initialization instructions still see useful individual tool descriptions.

## Task 2: Package the reusable `canvas` skill

**Interfaces:** Skill name `canvas`, used inline by the main agent. The skill and all layouts share a single JSON dataset at `data.canvas`. This is a documented authoring convention, not a new MCP input schema.

The dataset contains `title`, `phase`, `activity`, `steps`, `findings`, `checks`, `events`, and `decisions`. `steps` contain stable `id`, `label`, and `status`; statuses are `pending`, `running`, `passed`, `failed`, or `blocked`. Findings are concise strings. Checks contain `name`, `status`, and optional `evidence`. Events contain `summary` and optional observed timestamp `at`; decisions contain `question` and optional `answer`. Planning may add `options: Array<{ label: string; tradeoff: string }>`, delivery `changes: Array<{ path: string; summary: string }>`, and debugging `hypotheses: Array<{ label: string; status: string; evidence?: string }>`. Hypothesis statuses are `untested`, `supported`, or `ruled_out`. All collections default to empty when absent. Phases are `planning`, `working`, `waiting`, `complete`, or `blocked`.

- [ ] Write `SKILL.md` with standard `name` and `description` frontmatter and the Behavior contract. Reference the resource files using relative links. Keep the core concise enough to load routinely; avoid host-specific frontmatter, forked execution, and broad shell permissions.
- [ ] Document complete initial and subsequent dataset examples in `references/state.md`. Explain how the actor preserves prior fields and limits the activity list. Include a simple fallback using `canvas.open` and named components from the catalog when a layout resource is unavailable.
- [ ] Add meaningful fixture tests for the shipped layout files using `createWorkerRuntime`, `validateTree`, and `formatNode`. Assert missing-data rendering, a transition from active work to a finding and completed check, preservation of earlier findings on a complete update, and a visible failure/blocked state. Check widths at 31 and 80 columns using display-cell width rather than string length. Confirm the initial tests fail because the resources are absent.
- [ ] Implement the three MDX layouts against the documented dataset. Use guarded reads, bounded collections, and the existing components. Escape data through React children/props rather than concatenating user text into executable MDX. Do not add decorative controls solely to demonstrate React.
- [ ] Run `bun test test/canvas-skill-layouts.test.ts test/worker-runtime.test.ts test/renderer.test.ts`. Check the existing worker state-preservation test continues to pass; do not duplicate it just to assert the skill's wording.
- [ ] Review a rendered planning, delivery, and debugging example in a real Herdr pane, including a narrow layout and a trusted decision. Confirm current activity is easy to find, contextual colors carry labels, and long content remains navigable.

**Acceptance:** “Use the canvas skill to plan this feature” supplies enough guidance for Copilot to open and maintain a useful display without additional operational instructions. The skill remains usable when MCP initialization instructions are not delivered.

## Task 3: Install persistent activation once

**Interfaces:** `integrations/copilot/activation.md` is the canonical short instruction. `scripts/install-copilot.ts` exports `installCopilotCanvas(options: { scope: "user" | "project"; directory: string; dryRun: boolean }): Promise<{ changed: string[]; unchanged: string[] }>` and executes its CLI only when run directly. The CLI accepts `--scope user|project`, optional `--directory <target>`, and `--dry-run`; it resolves default directories before invoking the operation. In dry-run mode, `changed` means proposed changes. Report paths without echoing existing instruction contents.

Default user targets are `~/.copilot/skills/canvas/` and `~/.copilot/copilot-instructions.md`. Respect `COPILOT_HOME` for the instruction path as documented; confirm skill discovery under a non-default Copilot directory before claiming that configuration is supported. Project targets are `<target>/.github/skills/canvas/` and `<target>/.github/copilot-instructions.md`. The explicit directory option enables isolated fixture testing without changing the process home directory.

- [ ] Write the activation instruction: for substantial tasks with canvas tools available, use the `canvas` skill before substantial work, maintain it through task transitions, and finish visibly. Preserve explicit opt-outs and skip brief answers. If the skill is missing, follow the MCP guidance with a simple display; if the MCP is unavailable, proceed in chat.
- [ ] Test installation into temporary targets containing existing instructions and unrelated skills. Assert existing bytes outside the managed block are preserved, repeat installation makes no duplicate block, dry-run writes nothing, and unrelated collisions or symlink targets fail before writes. Use markers `<!-- herdr-canvas:start -->` and `<!-- herdr-canvas:end -->` around the managed block.
- [ ] Implement the installer with preflight validation of every target, recoverable backups before changing existing files, and atomic individual writes. Copy only the packaged skill resource allowlist. Re-running against identical content is a no-op; refuse to overwrite differing skill files without an explicitly reviewed upgrade. Do not modify MCP registration or permission settings.
- [ ] Add `copilot:install` to `package.json` and run `bun test test/copilot-install.test.ts`. Confirm a user-scope dry run lists the exact destinations and explains how to start a new Copilot session.
- [ ] Write `docs/COPILOT.md`: personal setup for cross-repository use, optional project setup, skill discovery checks, and refresh instructions. Document CLI `/skills info canvas`, `/skills reload`, and `/instructions`; verify the interactive commands on the installed version. Local command help confirms `copilot skill list` and `copilot instruction list` are available for read-only discovery checks. For VS Code, distinguish Copilot Agent Host personal instructions from other harnesses and provide the supported repository setup as the portable fallback. Do not claim file-pattern instructions activate every planning-only conversation.
- [ ] Link the setup from `README.md`. Provide ordinary example prompts, `/canvas` or named-skill invocation, explicit opt-out, and the graceful fallback behavior. Explain that installing these instructions does not add MCP access to unrelated projects or override tool approval settings.

**Acceptance:** After one installation and a fresh session with the canvas MCP available, the user can issue an ordinary substantial task with no canvas terminology and get the live view. Existing user preferences and unrelated skills remain intact.

## Task 4: Verify the combined Copilot experience

This is acceptance testing for the three deliverables, not a fourth integration feature. Use a small disposable repository with a realistic feature-planning task and a known failing test. Preserve the user's working conversation and pane.

- [ ] Run `bun run verify` after the implementation and `bun run test:live` once for integration coverage. Record any warnings separately from failures. Repackage the sandbox runtime only if its packaged inputs actually changed.
- [ ] Confirm skill and persistent-instruction discovery in a fresh Copilot session. Keep the existing MCP permissions; do not enable all tools or all server instructions to make the test pass.
- [ ] Execute the scenarios below and record Copilot version, model, installed customization scope, result, and observed event sequence in `docs/COPILOT.md`. Use only synthetic task data for traces. Do not commit complete personal session transcripts.
- [ ] Run the ordinary planning, implementation, and debugging prompts in three fresh sessions each. Report observed successes out of attempts and all failures; repeat a failed case after a guidance fix. A successful scripted MCP test is not evidence of automatic model activation.
- [ ] Review that failures do not produce retry storms, fabricated progress, user-answer substitution, or unwanted pane recreation. If a client mode cannot expose the needed tools, state its limitation rather than adding hooks or changing host permissions within this scope.

| Scenario | Observable result |
| --- | --- |
| “Plan resumable background jobs with retries, cancellation, and recovery after restart.” | Opens early without canvas terminology; displays multiple meaningful updates as findings and decisions develop; leaves a useful final plan. |
| “Implement the agreed retry policy and verify it.” | Switches to delivery context, updates steps and actual test evidence, and distinguishes passed from unresolved work. |
| “Investigate why this retry test fails.” | Shows hypotheses and experiments, updates after real evidence, and respects a diagnosis-only request. |
| “Use the canvas skill to plan a migration.” | Explicit skill activation succeeds without tool names or MDX in the prompt. |
| “Use herdr-canvas while investigating this failure,” with the skill absent | Tool descriptions/server guidance support a simple useful view without source-code inspection. Treat this as a separate compatibility result. |
| “What does exponential backoff mean?” | Answers briefly without opening a pane. |
| “Plan this feature without a canvas.” | Respects the opt-out. |
| MCP disabled or sandbox unavailable | Reports the limitation once and continues the underlying task in chat. |
| A choice is required | Shows a trusted decision; actual user input determines the next action. Label automated key injection as a transport test, not a human response. |
| A choice is cancelled or requires free text | Does not infer approval; asks in chat if needed and records only an actual answer. |
| User closes the pane or says to stop canvas updates | Does not repeatedly reopen it; explicit reopening remains possible. |
| A command runs for a long period without intermediate output | Shows the real running activity, then the result; makes no claim of tool-event telemetry. |

## Completion and handoff

The deliverable is three coordinated pieces: descriptive MCP metadata, an installable `canvas` skill with verified layouts, and an installable activation preference. Acceptance evidence must distinguish deterministic protocol/layout tests from observed model behavior. No new hooks, reporter process, or automatic transcript access is included.

Recommended execution order: Tasks 1 → 2 → 3 → 4, implemented in this session without delegated workers. The user-facing setup should be one install command and a fresh Copilot session; subsequent prompts describe only the work.
