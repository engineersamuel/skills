# Agent Guide

This repository publishes portable Agent Skills.

## Build and test

Use `python3 scripts/validate.py` to validate skill packaging and behavior contracts.
Use `npx skills add . --list` to verify local skill discovery.
Use `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7` to validate the release workflow.
Run every applicable check before committing a change.

## Architecture

Portable skill definitions live under `skills/`.
Each skill uses `SKILL.md` as its canonical entry point.
Optional harness metadata lives inside the corresponding skill directory.
Repository validation is implemented in `scripts/validate.py`.
Release automation lives in `.github/workflows/release.yml`.

## Conventions

Keep each portable skill in `skills/<name>/SKILL.md`.
Keep harness-specific metadata thin and colocated beneath the skill directory.
Keep frontmatter limited to fields accepted by the Agent Skills specification.
Document user-facing installation and invocation changes in `README.md`.
Update validation when the intended discovery set or packaging contract changes.
Preserve provider-neutral behavior unless a skill explicitly requires an integration.
Do not move or retag an existing release tag.
