---
name: finish
description: Use when and only when the user explicitly invokes $finish or /finish to commit current work, rebase onto origin/main, resolve conflicts, create a PR, enable squash auto-merge, and monitor it until merged.
disable-model-invocation: true
---

# Finish

1. Inspect the branch, status, and diff. If on the default branch, create a descriptive branch. Stage only intended changes, run applicable checks, and commit.
2. Run `git pull --rebase origin main`. Resolve every conflict while preserving both upstream intent and the current change, continue the rebase, then rerun affected checks.
3. Push with `git push --force-with-lease -u origin HEAD`.
4. Create the PR with `gh pr create`, then enable squash auto-merge with `gh pr merge --auto --squash`.
5. Monitor checks and PR state until GitHub reports `MERGED`. Fix owned check failures or conflicts, commit, rebase, push, and resume monitoring. Stop early only for a blocker that requires user action; report it exactly.

Never use raw `--force`, stage unrelated changes, merge `main` into the branch, or claim completion before the PR is merged.
