# Mastermind workers in Herdr

Use the upstream [Herdr skill for v0.9.5](https://github.com/herdrdev/herdr/blob/v0.9.5/skills/herdr/SKILL.md) as the behavior reference. Do not copy it into this skill or assume the installed client and server have the same version.

Before controlling panes:

1. Require `HERDR_ENV=1`.
2. Read `herdr --version`, `herdr status`, `herdr --help`, and the installed help for pane, agent, status, prompt, and output operations.
3. Read the installed Herdr skill if one is available.
4. Use only operations documented by the installed version. If a required operation is missing, stop. Do not upgrade or restart the Herdr server as recovery.

Create an unfocused sibling pane in the current tab and at the observed worktree directory, using the pane operation supported by the installed version. Preserve the user's focus. Do not assume that a pane is yours because it is visible or idle.

Plan space for the whole approved batch before the first split. Prefer at least 80 columns and 20 rows per agent where the terminal permits it. A pane is not wide enough for a right split merely because width exceeds height: check the resulting widths. On a narrow terminal, stack panes down and use the documented ratio option to reserve room for the remaining workers. Do not repeatedly halve the same narrow pane. Inspect actual geometry after each split. If the approved topology cannot fit, report that limit instead of silently creating a tab or changing the user's panes.

Include the controller in that space budget. Never shrink it below 20 rows to make room for workers. Use current layout dimensions, not dimensions from an earlier terminal size. Inspect the returned geometry before launching in a new pane. If a split made an owned pane too small, restore the owned split with the documented resize control or close the new, still-empty pane. Collect and close an owned completed writer before creating review panes when its later fix assignment can use a fresh approved writer. Do not keep idle workers open at the cost of controller visibility. Reduce batch size only if this still meets the approved task and parallel-review requirements.

Launch Trx with the prepared vector. The vector is data, not shell text:

```text
trx run HARNESS PROFILE -- ARGS
```

Pass the harness, profile, and any arguments as separate argv entries through the documented Herdr pane command mechanism. Do not use `herdr agent start --kind` to launch Trx: that starts a harness's canonical executable, not an arbitrary `trx run` wrapper.

After launch, confirm the expected agent and readiness with Herdr agent and pane status, using IDs Herdr returns. An initial `agent_not_found` or `unknown` is a normal startup state, not a failed launch: keep the exit code and error, wait briefly, and inspect the same pane until it is recognized or the saved deadline expires. Never relaunch because detection is slow, and never let one transient `agent_not_found` abort the batch. Other errors stay explicit failures. Queue admission, `idle`, `done`, and `unknown` do not prove the task completed. Herdr output is command-specific: `pane run` can return empty stdout and `agent read` returns text. Parse JSON only for commands documented to return it.

Some installed Herdr versions refuse scrollback reads while an agent is working (`agent_not_idle`). Use `--source visible` for live inspection without scrolling. Wait for a settled state before requesting full recent history. Catalog compatibility is not proof that the installed server recognizes the current harness binary. If repeated bounded checks cannot recognize it, mark the run blocked. Switch to another healthy harness by the worker rules in the skill. The switch is a new counted launch under the 8-launch ceiling and keeps the same `deadlineAt`; never send raw pane input to bypass recognition.

For result collection, standalone `agent wait` must accept `idle`, `done`, and `blocked`, using its default states where supported. Never wait only for `done` and `blocked`: a completed worker can settle as `idle` without becoming `done`. A nonblocking submission followed by an immediate wait can also return the old idle state before the turn starts. Require observed post-submission activity or actual assignment-specific final evidence before accepting that state. Keep the same deadline while checking; do not solve stale idle by excluding idle from all later waits.

## Fish example with v0.9.5 syntax

Use this syntax only after installed help confirms it. These are separate steps, not an unattended launch script. The example assumes the approved prepared vector is `["run", "codex", "--"]`. Replace it only with validated available selections.

Check caller context and geometry before selecting a split direction:

```fish
test "$HERDR_ENV" = 1
herdr status
herdr pane current --current
herdr pane layout --pane "$HERDR_PANE_ID"
```

Stop if the environment check fails. Split right for a wide pane or down for a narrow or tall pane. Keep the same directory and user focus:

```fish
set -l split_result (herdr pane split --current --direction right --cwd "$PWD" --no-focus)
printf '%s\n' $split_result
```

Confirm that the command succeeded. Read the returned ID, not a predicted ID:

```fish
set -l worker_pane (printf '%s\n' $split_result | jq -er '.result.pane.pane_id')
```

Inspect the returned pane and confirm that its foreground process is an available interactive shell. Save the pane, tab, terminal, shell PID, launch-start time, and absolute deadline in the run record before `pane run`. See [the fleet protocol](fleet-protocol.md). For this fixed vector, the short startup command contains no prompt or user-supplied shell text:

```fish
herdr pane run "$worker_pane" 'trx run codex --'
```

Do not chain an immediate `agent get` as a launch-success test. Inspect `pane process-info` and output from the same pane; if installed `agent wait` cannot target an undetected agent, use short bounded waits with a delay. Once detected, use installed `agent wait` with idle, done, and blocked states, then inspect its returned state. A blocked dialog requires human action, not another prompt.

All operations share the saved deadline, not separate startup and prompt budgets. Set `worker_deadline` from the saved `deadlineAt` in the run record; do not invent a later time. With `jq` available, this Fish example rounds down to a safe remaining budget:

```fish
set -l remaining_ms (jq -nr --arg deadline "$worker_deadline" \
  '(($deadline | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - now) * 1000 | floor')
if test "$remaining_ms" -gt 0
    herdr agent wait "$worker_pane" --until idle --until done --until blocked --timeout "$remaining_ms"
end
```

If the budget is exhausted, stop new submissions and record uncertainty. Stop on an unrecognized process, blocked dialog, or timeout.

For other prepared vectors, quote every argument for the pane's verified shell before using `pane run`. Fish `string escape --style=script` is suitable only when the receiving pane runs Fish. Do not reuse Fish quoting in an unverified shell. Never put a worker prompt in the startup command.

After readiness is confirmed, record the agent PID and kind in the run record, then save `promptSubmittedAt` just before submission, as the fleet protocol describes. If either write fails, do not submit.

Send the prepared prompt as one argument, using a newly calculated remaining budget:

```fish
set -l worker_prompt 'Implement only the approved task. Report changes, checks, and blockers.'
set -l remaining_ms (jq -nr --arg deadline "$worker_deadline" \
  '(($deadline | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - now) * 1000 | floor')
if test "$remaining_ms" -gt 0
    herdr agent prompt "$worker_pane" "$worker_prompt" --wait --timeout "$remaining_ms"
end
herdr agent get "$worker_pane"
herdr agent read "$worker_pane" --source recent-unwrapped --lines 120
```

The prompt above is illustrative; use the complete approved assignment and actual remaining timeout. Do not reuse the original five-minute budget after startup. The same pane ID can address a recognized agent, so a guessed agent name is unnecessary. For debate, use this same recognized agent and a new approved challenge, not a new agent with missing review context.

Record the observed result in the run record. If terminal history is incomplete, first try a larger read. Only then ask the same agent to save its result in its owned local output directory and return the path. Validate that path before reading it. Do not require file output in the initial assignment. For terminal-first assignments, size the final answer to the actual viewport: request at most eight short physical lines, or half the pane height if less. Avoid tables and long paragraphs. Include outcome, actionable file-line evidence, the smallest failing example, and check results before other detail. A request for 60 lines does not fit a 20-row alternate-screen pane. If complete evidence cannot fit, reserve counted output-recovery follow-ups in the approved budget before dispatch; do not spend that reserve on optional work. Do not close a completed worker until its required evidence is collected. Cleanup may close only resources recorded as owned by this run and covered by the approved cleanup policy.

## Parallel prompt submission

For a parallel batch, submit each prepared prompt without `--wait` first:

```fish
herdr agent prompt "$worker_pane" "$worker_prompt"
```

Do not add `--timeout` to this nonblocking form: installed Herdr versions can require `--wait` when `--timeout` is present. Bound the enclosing command with the caller's remaining deadline if its tool supports a process timeout. After all approved prompts have been submitted, use separate bounded `agent wait` calls and collect each worker's actual output.

A CLI syntax rejection is not a delivery acknowledgement. Inspect its error and the same pane before correcting the command. Preserve the original submission intent and deadline; do not clear a known intent, create a new reservation, or relaunch merely to correct a proven pre-submission syntax error. If it is not clear that the parser rejected the command before delivery, record uncertainty and reconcile instead.
