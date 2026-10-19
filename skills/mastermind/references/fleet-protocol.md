# Mastermind protocol

Trx has no fleet-control command. Trx discovers, checks, and launches harnesses. The mastermind keeps its own run record.

## Discover

Use only commands that `trx --help` documents:

| Command | Use |
| --- | --- |
| `trx list --json` | Harnesses, built-in presets, and profiles that `trx run` accepts. |
| `trx guide --json --intent INTENT` | Profile recommendations for a task. No launch, no Herdr side effects. |
| `trx inventory HARNESS [PROFILE...] --json` | Live readiness of one composition. |
| `trx run HARNESS [PROFILE...] --dry-run` | The launch plan: model, effort, isolation, skills, and the command. Starts nothing. |

A profile in `trx list` is not proof of readiness. Run `trx inventory` for every selected pair and require `readiness: "healthy"`. Stop on any other value and report the failing `checks`.

`trx guide --json` may call a model (`execution.backend`, `execution.model`). That sends the intent text to that backend. Use it only when the user approves that destination. Do not put private code in the intent. Each recommendation has a `ref` (`native:HARNESS/PROFILE[+PROFILE]`), `prerequisites`, and `herdrCompatibility`. A `herdrCompatibility.status` other than a known-good value is a risk: report its `notes` before launch.

Model evidence comes from `trx run --dry-run` (the `Normal` line) and the inventory. A configured model, alias, or proxy address does not prove the live model family. The dry-run `Isolation` line can say `unproven`; report that in the plan.

Save raw stdout of each JSON command as one response in an owned mode-0600 file. Check `schemaVersion` before you use it. Keep stderr out of that file. Never parse several outputs joined as one response.

## Run record

Keep one JSON run record per task in an owned mode-0600 file outside the worktree. Write it before each step that it describes, so that an interruption can be reconciled. Record:

- `authorization`: the plan, limits, and the user message that authorized it (the request itself, or a later answer);
- per action: harness, profiles, scope, task text, and the `trx run` argv;
- per launch, before `pane run`: pane, tab, terminal ID, shell PID, launch-start time, absolute UTC `deadlineAt`;
- after readiness: agent PID and kind; immediately before `agent prompt`: `promptSubmittedAt` (intent, not proof of delivery);
- after collection: `delivery` (`delivered`, `not-delivered`, `uncertain`), result, changed files, and evidence.

Never overwrite a known pane, process, deadline, or submission time. Set unknown session IDs and exit codes to `null`; never guess. Unknown changed files are `null`, not `[]`.

If the user changes the scope, record the new message. Swapping an unhealthy worker for a healthy one inside the same scope needs no new authorization.

## Launch, submit, collect

1. Confirm the pane runs an interactive shell. Write the launch entry to the run record.
2. Start `trx run HARNESS PROFILE... --` in the pane (see [the Herdr reference](herdr.md)).
3. Initial `agent_not_found` or `unknown` can mean startup is in progress. Inspect the same pane within the remaining budget. Never relaunch only because detection is slow. Stop on a blocked dialog or a mismatched process.
4. When identity and readiness are verified, record agent PID and kind, then `promptSubmittedAt`, then send the prompt. Do not prompt if the record write fails.
5. Before every blocking Herdr call, compute `remainingMs = deadlineAt - now`. Skip the call if it is zero or less. Startup and collection share one budget.
6. Record the observed result and evidence.

Use `delivery: "uncertain"` when delivery or completion is unclear. That blocks retry until the same Herdr identity and output are reconciled. When startup is blocked and no prompt was sent, record `not-delivered` with startup evidence and no result. Every retry is a new counted launch.

After an interruption, read the run record first. An entry with no pane identity does not prove that no worker exists; reconcile owned panes before retrying.

Finish the run only when every planned action has a recorded outcome. Mark it incomplete when anything is blocked, failed, or unresolved.

## Findings

Record each finding with reviewer and snapshot IDs, affected paths, evidence, impact/severity, confidence, and how to reproduce or disprove it. Give reviewers no author's reasoning. Ask each to challenge evidence, not defend a position.

## Optimization

`trx guide --optimize` is interactive and covers the whole repository. Trx has no task-scoped optimization command. Use it only when the user explicitly approves whole-repository optimization. Check reported changes against the approved scope.
