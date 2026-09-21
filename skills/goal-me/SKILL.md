---
name: goal-me
description: Use when a user wants a free-form request steered into a filled goal-loop prompt (TASK + SUCCESS CRITERIA), asks to write GOAL.md, or runs /goal-me.
disable-model-invocation: true
---

# Goal Me

Turn free-form input into a goal prompt a later harness can run for any deliverable. The only artifact of this skill is the written file; the default execution mode is bounded convergence.

## Workflow

1. **Seed and discover.** Use the user's input as the starting idea. If they gave none, ask for the idea in one sentence and wait. Inspect available inputs, repository instructions, existing artifacts, and relevant check commands before asking for facts you can discover yourself.

2. **Interview.** Use `/grill-me` if installed until the user confirms a shared understanding. Otherwise interview in frontier rounds: number currently unblocked decisions, attach recommended answers, wait for answers, then recompute the frontier. Keep a live draft of the filled sections below.

   Establish one coherent outcome, its artifacts and inputs, scope and constraints, at least three independent criteria, verification methods, starting actions, and execution limits. An outcome may involve code, prose, research, design, or several related artifacts. Do not force unrelated work into one goal.

   Each criterion needs an observable target and a reproducible verification method with evidence an independent scorer can inspect. Use existing commands where appropriate and define how results map to 1-10 scores. Otherwise write an evidence-based rubric specifying what earns 8/10 and 10/10, and how gaps lower the score. List required checks separately: they must pass regardless of subjective scores. Runnable scoring scripts are optional.

   Build a compact action catalog linking concrete improvements to criterion IDs, expected benefit, prerequisites, and verification. Impact estimates guide prioritization; they are not promised score gains.

   Agree on immutable success definitions and thresholds. If improving measurement tools is part of the task, define a separate reliability criterion with reference cases and a way to compare artifacts using the same calibrated checks. Default limits are 20 iterations and 5 consecutive attempts without verified progress; goal-specific positive limits can replace these during authoring. Confirm the whole draft, including constraints and limits, before writing.

3. **Write.** After shared-understanding confirmation, fill the complete template below in the current working directory:
   - List existing `GOAL.md` and `GOAL-*.md` paths first.
   - Use `GOAL.md` if that path is free.
   - Otherwise use `GOAL-<id>.md`, where `<id>` is four lowercase hex characters (`0-9a-f`). Generate a new id on collision. Treat any occupied path as a collision and create exclusively so an intervening write cannot overwrite another file.
   - Fill the task, inputs and artifacts, constraints, criteria, required checks, action catalog, and limits. Remove placeholders from those sections. Seed `SCOREBOARD` with the criterion IDs, `_` scores/evidence, zero counters, and `ITERATING`. Leave `RECENT ATTEMPTS` and `LEARNINGS` empty. Preserve the loop protocol and rules.
   - Generate only this goal file. Do not create scoring scripts, deliverables, or auxiliary progress files during authoring.

4. **Stop.** Report the written path. The file is the handoff. Do not execute the loop.

## Goal prompt

```text
Work toward the outcome below within the agreed limits.
This file is the only memory of execution. It must support both a long
conversation and resumption in a fresh process with access to the artifacts.

TASK:
[One coherent outcome and its intended use.]

INPUTS AND ARTIFACTS:
[Input locations, output paths, relevant context, and how to inspect them.]

CONSTRAINTS:
[Scope, exclusions, project rules, existing authorization, and resources.]

SUCCESS CRITERIA:
Score each criterion independently from 1-10 using current evidence.
Missing evidence is unverified, not a passing score.
| ID | Criterion and observable Target | Verification and score mapping (8/10 and 10/10 anchors) |
| --- | --- | --- |
| C1 | [target] | [command or evidence-based rubric] |
| C2 | [target] | [command or evidence-based rubric] |
| C3 | [target] | [command or evidence-based rubric] |

REQUIRED CHECKS:
[Each check's ID, command or inspection method, and pass condition.
Write "None" explicitly only if no required checks apply.]
These gates must pass independently of criterion scores.

ACTION CATALOG:
| Action | Criterion IDs | Expected benefit | Prerequisites | Verification |
| --- | --- | --- | --- | --- |
| [concrete improvement] | [IDs] | [impact estimate] | [dependencies or none] | [method] |
Estimates guide selection; only verified results count as progress.
Update this catalog as evidence suggests better in-scope actions.

EXECUTION LIMITS:
Max iterations: 20
Max consecutive no-progress attempts: 5

SCOREBOARD:
Status: ITERATING
Iterations: 0
Consecutive no-progress attempts: 0
Pending attempt: none
| Criterion | Baseline | Current | Evidence |
| --- | --- | --- | --- |
| C1 | _ | _ | _ |
| C2 | _ | _ | _ |
| C3 | _ | _ | _ |
Required checks (baseline/current, evidence): _
Artifact state and measurement version: _
Weakest: _
Last change and disposition: _
Next action: _
Stop reason: _

RECENT ATTEMPTS:
Keep only the five most recent attempts: iteration, action, before/after
results and evidence, retained/recovered/prerequisite disposition, learning.

LEARNINGS:
Keep at most 8 bullets; replace stale ones. No narrative history.

LOOP PROTOCOL:
1. READ - Read this file and inspect the current artifacts and project rules.
   On resumption, preserve accumulated counters, baseline, and history.
   Recorded scores are hints, never current evidence. Reverify even if the
   recorded status is FINAL or STOPPED. Do not reset limits on resumption.

2. MEASURE - Before choosing an action, measure every criterion and required
   check on the current artifact. Record evidence (commands/results or rubric
   observations), artifact identity, and measurement version. Initialize each
   baseline only from its first measurement; leave unavailable scores as _.
   Update current results and identify gaps. If an attempt is pending, resolve
   it through VERIFY, RETAIN OR RECOVER, and RECORD before evaluating a limit
   or success; do not start another action. Otherwise, if success, a limit, or an
   external blocker already applies, go directly to RECORD and DECIDE without
   starting another attempt. Measurement alone does not consume an iteration.

3. CHOOSE - Prioritize the weakest verified criterion, missing evidence, or
   a failing required check that prevents success, and necessary prerequisites.
   Choose one concrete action from the catalog, or add a better in-scope one.
   Use expected benefit, cost, and dependencies to break ties. State the
   expected improvement and how it will be verified before changing anything.

4. ACT - Capture enough of the pre-action state to recover only your changes,
   including any pre-existing work in files you will touch. Before changing
   anything, persist the incremented Iterations and Pending attempt together:
   iteration ID, action, before-results, and recovery information. Make the change
   within existing user authorization and constraints. An interrupted attempt
   still counts; on resumption resolve its disposition before another action.

5. VERIFY - Rerun the agreed measurements and required checks. Compare before
   and after using the same calibrated checks and fixed thresholds. Record
   observed evidence, not expected gains. If measurement tools are part of the
   goal, assess their reliability separately against the agreed reference
   cases. Re-evaluate the before and after artifacts with the same reliable
   tool version; a changed scoring tool alone is not artifact improvement.
   Preserve original baseline evidence and label any recalibrated comparison.
   If comparability cannot be established, mark progress unverified.

6. RETAIN OR RECOVER - Retain verified criterion improvements only when no
   criterion or required-check regressions occurred. Repair or undo unsuccessful
   changes, including changes whose benefit cannot be verified. Preserve
   pre-existing work and unrelated edits; never use a blanket reset or restore
   that discards them. Necessary prerequisite work may remain if it introduces
   no regressions; record its reason. Repairs belong to this attempt and stay
   within its chosen action; a different improvement starts a new attempt.
   After repair or recovery, remeasure the retained artifact. Its actual state,
   not the rejected candidate's scores, becomes Current. If recovery is blocked,
   record the actual state and blocker without claiming successful recovery.

7. RECORD - Overwrite SCOREBOARD with baseline/current results and evidence,
   counters, weakest criterion, last disposition, next action, and stop reason.
   Verified progress means the retained result improves at least one agreed
   criterion with no criterion or required-check regressions. Reset the
   consecutive no-progress counter only for that progress; otherwise increment
   it once per attempted action, including prerequisites and recovered failures.
   Keep only five most recent attempts and at most 8 learnings in this file.
   Update counters and attempt history and clear Pending attempt in one file
   replacement, so resumption cannot count an attempt twice. With no pending
   attempt, measurement alone leaves counters unchanged. If an interrupted
   attempt's progress cannot be verified, count it as no progress exactly once.
   Persist the retained artifact's actual state before stopping. If evidence is
   unavailable, record that limitation rather than retaining a stale score.

8. DECIDE - FINAL requires every criterion to score at least 8/10 with current
   evidence and every required check to pass. Otherwise set STOPPED if either
   execution limit is reached, or an external blocker prevents further in-scope
   work. Include the reason: iteration limit, no-progress limit, or the concrete
   blocker. A repairable failure is not an external blocker while useful
   authorized actions remain. Otherwise set ITERATING and repeat from READ.
   Persist the status before reporting it. At FINAL or STOPPED report starting
   and current results, retained changes, remaining gaps, and next useful action
   (or none). Never print FINAL for incomplete or unverified work.

RULES:
- Do not edit TASK, INPUTS AND ARTIFACTS, CONSTRAINTS, SUCCESS CRITERIA,
  REQUIRED CHECKS, EXECUTION LIMITS, LOOP PROTOCOL, or RULES during execution.
  Success definitions and thresholds stay fixed; never weaken a gate to pass.
- Do not create a second progress file. Keep execution memory in this file;
  task artifacts and existing project checks remain in their proper locations.
- Do not ask routine questions during execution. Make in-scope assumptions
  and record them. This prompt grants no new authorization: if required access,
  information, or permission is unavailable and no useful in-scope work remains,
  record the external blocker and STOPPED. Do not bypass project constraints.

Begin with READ and MEASURE.
```
