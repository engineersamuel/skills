# Factory loop

One task has one factory file: `.trellage/factory/<id>/factory.yaml` in the target repo. It is git-ignored and is the only record of progress. Only the mastermind writes it, through `scripts/factory.py`. Workers return results; the mastermind records them.

Before each step, read the factory file. After each step, write the result, evidence, and the next stage. If the session restarts, resume from the factory file.

## Stop conditions

Keep looping. Stop only when one is true:

1. **Done.** The request is finished, every check passed on the final snapshot, and evidence for each is in the factory file. Set `status: done`.
2. **Needs a human.** Every available means failed: repo docs, `/hve-research`, research, council, six-hats, and debate. Or the decision is in the "ask" list of the skill. Set `status: needs-human`, ask on the answer page, and block on `wait-answer`. Then continue.

A finished stage, a status report, or a running worker is not a stop.

## Jev

Jev makes the small typed decisions: which stage is next, which profile, which reviewers, and whether confidence is high enough. Use `jev-choice` to pick one option and `jev-noul` for a yes/no probability. Record each call and its answer in `decisions`.

- State is a short summary: the prompt, findings, file names, and stage results. Send code only when the decision needs it.
- Act on a choice when its confidence is 0.7 or higher, or on a noul when its value is ≥ 0.7 or ≤ 0.3. Otherwise, collect more evidence (research, council, six-hats) and ask again. If it is still low after that, the decision needs a human.
- Jev advises. Repository evidence wins over a Jev answer.

## Stages

| Stage | Do | Exit evidence |
| --- | --- | --- |
| intake | Restate the request. Jev noul: "Is there enough information to finish this without guessing?" Jev noul: "Will this change code?" Set `codeChanged`. | Restatement, both probabilities. |
| clarify | Look in repo docs first. Ask what is left with `grill-me`, one question at a time, on the answer page. | Every question answered or resolved from docs. |
| research | Pick one or more with Jev: `trx run copilot hve` with `/hve-research PROMPT` (returns a research document), `trx run claude research` (hyperresearch), council, six-hats. | Research files, sources, confidence. |
| decide | For a hard choice, debate: give each adviser the others' results, run rounds until a round adds nothing new. Synthesize with dissent. | Decision, dissent, Jev confidence. |
| implement | Jev picks `trx run HARNESS [PROFILE]` from `trx list --json` and `--dry-run` output. One writer in its own tab and worktree. | Changed files, checks the writer ran. |
| optimize | Only if `codeChanged` and code files changed (not docs, README, or other prose). Run optimization skills on the change; see the skill. | Pass result, checks after. |
| review | Freeze a snapshot. Jev picks reviewers; run them; synthesize. Fix clear bugs and loop back to implement. | Findings per reviewer, all clear bugs fixed. |
| verify | Run `no-mistakes` and the repo checks on the final snapshot. | Command output bound to the snapshot. |
| report | Final report from the factory file. | `status: done`. |

Skip stages that do not apply, and record the reason. A question with no code change can go intake → research → decide → report. Loop back to any earlier stage when new evidence needs it.

## Answer page

```text
portless factory-ID --tailscale uv run scripts/factory.py serve ID
```

The page is on your tailnet only. Never use `--funnel`, `--ngrok`, or `--cloudflare`. Clicking an option writes the answer to the factory file. Block on `factory.py wait-answer ID QID` in the background, keep working on anything the question does not block, and continue when it returns.
