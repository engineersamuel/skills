# Mastermind protocol

## Discover

Send one JSON request to the support command:

```fish
printf '%s\n' \
  '{"schemaVersion":1,"requestId":"caps-1","operation":"capabilities","input":{"profile":"default"}}' \
  | trx mastermind --json
```

Read the live profile catalog, action descriptors, operation effects,
optimization scope, model evidence, and Herdr compatibility. Then query
`trx inventory LAUNCHER PROFILE --json` for every selected pair. A catalog
entry is not proof of readiness. Do not select a model when the evidence is
`unknown`.

`routingPolicy` and `effectivePolicy` come from the installed Native adapter.
They are configured policy, not a live provider attestation. Model aliases
such as `opusplan` do not prove an exact model family. Do not use configured
defaults as a model inventory or claim that every backend host is known.
Resolve missing routing information before asking for approval. If the user
has already explicitly approved the named service policy for this bounded
run, preserve that approval instead of asking again.

The optional `input.harness` and `input.profile` filters are exact matches.
An empty profile result means no match, not permission to invent one. Remove
the filter to discover other candidates. Do not print a second full catalog.
Save raw stdout as one JSON response in an owned mode-0600 artifact and check
`schemaVersion`, `requestId`, `operation`, and `ok` before using it. Keep stderr
and tool-wrapper text out of that file. Never combine several command outputs
and then parse the result as one response.

Request the current JSON Schema for any operation without reading source:

```json
{"schemaVersion":1,"requestId":"schema-1","operation":"schema","input":{"operation":"run.attach"}}
```

`result.requestSchema` describes the complete request, including the envelope.
Schema discovery is read-only and does not read the profile catalog or call a
model. Require `schema` and `run.attach` in capabilities; stop with a clear
compatibility error when either is absent.

## Prepare

Build one `prepare` request from the user's approved task and source scope.
Keep the prompt as a JSON string. Do not put it in shell source. Example shape:

```json
{
  "schemaVersion": 1,
  "requestId": "prepare-1",
  "operation": "prepare",
  "input": {
    "intent": "Implement the requested feature",
    "sourceScope": {
      "kind": "worktree",
      "root": "/absolute/canonical/worktree",
      "includePaths": ["src"],
      "excludePaths": ["src/generated"]
    },
    "actions": [
      {
        "id": "implement-1",
        "kind": "implementation",
        "worker": { "harness": "codex", "profile": "default" },
        "task": "Implement the feature within the approved paths.",
        "sourceScope": {
          "kind": "worktree",
          "root": "/absolute/canonical/worktree",
          "includePaths": ["src"],
          "excludePaths": ["src/generated"]
        },
        "effects": ["workspace-read", "workspace-write"],
        "approvalRequired": true
      }
    ]
  }
}
```

Replace example values with discovered profiles and the real canonical
worktree path. `prepare` validates the profile, scope, path safety, action
effects, and model evidence. It returns the approved Trx argv prefix and the
prompt separately. No agent starts.

Every action must use exactly the same `sourceScope` object as the plan.
For file-specific assignments, use the shared union of allowed paths as
the plan/action scope and restrict each worker further in its task prompt.
Do not give actions different scope objects; the API rejects that mismatch.

Save the exact successful `prepare` response before showing the plan.
Use its `result.plan` unchanged for `run.create` and its matching
`preparedActions` for dispatch. Do not reconstruct the plan from prose.

For task optimization, select IDs from the current `capabilities` response and
use `kind: "optimization"`, a numbered `round`, and `optimizationIds` in the
action. Include one or more real paths in `includePaths`. Do not use the
whole-repository interactive Optimize command as a fallback.

## Approve and track

After showing the exact task, candidate worker/reviewer set, scope, topology,
timeouts, limits, and external destinations, wait for explicit user approval.
Use a documented approval-input tool if available. Otherwise state the pending
decision once and wait in interactive mode. Automatic continuation reminders
are not user consent and need no repeated approval reply. Never call a
task-completion tool merely to escape this wait. If consent is ambiguous,
clarify it once before creating the run.

Then create the run with the saved prepared plan, approved limits, and:

```json
"approval": {
  "approvedBy": "user",
  "approvedAt": "2026-10-16T12:00:00Z"
}
```

The timestamp is an example; record the explicit approval message time, not
the proposal time or an earlier ambiguous reply. Include `messageId` if the
harness exposes it. Trx computes and
stores the approval digests. If the user changes the plan, prepare and approve
the changed plan. Do not reuse approval for changed actions, profiles,
effects, scope, or limits.

Use a JSON serializer to insert the saved plan into this request. `PLAN` below
means the actual JSON object at `prepare.result.plan`, not a string:

```text
{"schemaVersion":1,"requestId":"create-1","operation":"run.create","input":{"plan":PLAN,"limits":{"concurrentLaunches":1,"totalLaunches":1,"debateRounds":0,"optimizationPasses":0},"approval":{"approvedBy":"user","approvedAt":"ACTUAL_APPROVAL_TIME","messageId":"ACTUAL_MESSAGE_ID"}}}
```

Omit `messageId` only when it is unavailable. Use the actual approved limits.
Never execute this illustrative template with placeholder values.

## Reserve, attach, submit, and collect

Before each worker launch, call `run.reserve` with the latest revision:

```json
{"schemaVersion":1,"requestId":"reserve-1","operation":"run.reserve","input":{"runId":"RUN_ID","actionId":"implement-1","expectedRevision":0}}
```

Create the approved pane, verify its shell, then call `run.attach` before
launch. Use IDs returned by Herdr, a verified shell PID, the actual launch-start
time, and one absolute UTC deadline calculated from the approved timeout.
The next request illustrates a five-minute budget; replace all example values:

```json
{
  "schemaVersion": 1,
  "requestId": "attach-pane",
  "operation": "run.attach",
  "input": {
    "runId": "RUN_ID",
    "reservationId": "RESERVATION_ID",
    "expectedRevision": 1,
    "execution": {
      "paneId": "w1:p2",
      "tabId": "w1:t1",
      "terminalId": "OBSERVED_TERMINAL_ID",
      "shellPid": 123,
      "launchStartedAt": "2026-10-16T18:00:00Z",
      "deadlineAt": "2026-10-16T18:05:00Z",
      "agentPid": null,
      "agentKind": null,
      "promptSubmittedAt": null
    }
  }
}
```

After the attachment succeeds, start Trx in that pane. Initial
`agent_not_found` or `unknown` can mean startup is still in progress. Inspect
the same pane, wait within the remaining budget, and never relaunch solely
because detection is delayed. Stop on a blocked dialog or mismatched process.

Once identity and readiness are verified, call `run.attach` again using the
latest revision, the same execution object, and the observed `agentPid` and
`agentKind`. The kind must match the selected harness. Immediately before
`agent prompt`, attach the same object with `promptSubmittedAt` set to the
current UTC time. This is submission intent, not a delivery acknowledgement.
Do not prompt unless the state write succeeds. Never overwrite a known pane,
process, deadline, or submission time. Reconcile an identity change instead.

Before every blocking Herdr call, calculate
`remainingMs = deadlineAt - currentTime`. Do not call it if the value is zero
or negative. Set its timeout to no more than that value. Startup and result
collection consume the same budget. Recompute after each call; do not reuse
the original duration or allow a new full prompt timeout after startup.

Call `run.record` with observed delivery, result, and evidence:

```json
{
  "schemaVersion": 1,
  "requestId": "record-1",
  "operation": "run.record",
  "input": {
    "runId": "RUN_ID",
    "reservationId": "RESERVATION_ID",
    "expectedRevision": 4,
    "action": {
      "delivery": "delivered",
      "result": {
        "schemaVersion": 1,
        "actionId": "implement-1",
        "workerId": "w1:p2",
        "outcome": "success",
        "summary": "Observed result and relevant checks.",
        "changedFiles": ["src/file.ts"],
        "sessionId": null,
        "exitCode": null,
        "error": null
      },
      "evidence": ["Actual output, file citations, and check results."]
    }
  }
}
```

Use the attached pane ID as `workerId`. Set unknown session IDs and exit codes
to `null`, never fabricate them. Read-only work reports an observed empty
change list; unknown changes are `null`, not `[]`. These examples use sequential
revisions only for illustration. Always use the latest returned revision,
including when other approved reviewers update the shared run.

Use `delivery: "uncertain"` if prompt delivery or completion is unclear. This
blocks retry until the same Herdr identity and output are reconciled. Retry
only after recording evidence that the prior launch was not delivered or is no
longer active. Every retry is a new counted launch.

When startup is blocked and no assignment was sent, record
`delivery: "not-delivered"`, `result: null`, and observed startup evidence.
Do not attach a failure result to `not-delivered` or `uncertain`. A delivered
result is an observed worker result, not merely a launch acknowledgement.
If work was submitted but no usable result is available, keep it uncertain
until inspection resolves it. Use `run.finish` with `outcome: "blocked"` for
an unmet startup prerequisite; never claim completed tasks for unprompted agents.

Call `run.get` after interruption to recover the exact execution identity,
deadline, approval, and evidence:

```json
{"schemaVersion":1,"requestId":"get-1","operation":"run.get","input":{"runId":"RUN_ID"}}
```

An active reservation with no execution identity is not proof that no worker
exists. Reconcile owned pane creation before retrying. Legacy records can have
`execution: null`. Do not fill missing fields with guesses.

Call `run.finish` only after required work and evidence are accounted for:

```json
{"schemaVersion":1,"requestId":"finish-1","operation":"run.finish","input":{"runId":"RUN_ID","expectedRevision":5,"outcome":"succeeded","summary":"All required results and checks collected."}}
```

Use an incomplete outcome when blocked, failed, or unresolved. `succeeded`
requires every planned action to have a completed result. Read the run again
to verify the final summary and approval record.

## Review and debate

Assign one writer at a time. Freeze the `HEAD`, staged/unstaged changes,
untracked in-scope files, and a content-hash manifest after the writer finishes.
Give independent reviewers the same snapshot and no author's reasoning.
Reviewers are read-only.

Record each finding with reviewer and snapshot IDs, affected paths, evidence,
impact/severity, confidence, and how to reproduce or disprove it. Debate only
specific disagreements. Ask each reviewer to challenge evidence, not to
defend a position. Stop after two debate rounds. Keep unresolved dissent.

Build a prioritized finding list and route accepted, in-scope fixes to one
writer. Freeze a new snapshot after fixes before any further review. A changed
snapshot invalidates findings that depend on changed files.

## Advice and optimization

The `advise` operation may call Jev and incur cost. Use it only after separate
user approval for advice. Send a short, non-sensitive summary, never source
code, diffs, transcripts, credentials, or private repository content.
Recommendations are optional; they do not change the plan or execute work.
Advice may recommend reviewer count and up to two optimization IDs from the
current registry. It cannot approve either. Add a recommendation only after
the user approves the updated plan. Unavailable or uncertain advice means use
deterministic policy.

Task-scoped optimization uses selected Guide Optimize instructions with an
approved non-empty include-path scope. It is prompt-scoped, not an
operating-system boundary; check reported changes against the approved paths.
Use it only when current capabilities mark the action `automationReady`.
Interactive `trx guide --optimize` still targets the whole repository. Run it
only after the user explicitly approves that broader scope.

## Approved shared settings

Read `preferences.get` before proposing a run. An absent file returns revision
zero and no settings without creating files. Current instructions override
saved defaults. The settings do not approve any work.

The read request has no `input` field; strict decoding rejects even an empty
one:

```json
{"schemaVersion":1,"requestId":"preferences-read","operation":"preferences.get"}
```

After the user approves the exact shared settings, send:

```json
{
  "schemaVersion": 1,
  "requestId": "preferences-1",
  "operation": "preferences.set",
  "input": {
    "expectedRevision": 0,
    "preferences": {
      "reviewerCount": 3,
      "proposeTaskOptimization": true
    },
    "approval": {
      "approvedBy": "user",
      "approvedAt": "2026-10-16T16:00:00Z"
    }
  }
}
```

Use the actual approval time and latest revision, not these example values.
`preferences.set` replaces the complete settings object. An empty object clears
the settings after approval. A stale revision fails without overwriting newer
settings. Values are typed and contain no free-form personal data. The store
is private under the user configuration root, separate from the worktree and
run records.
