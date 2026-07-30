# ty Type Checker Migration Design

## Goal

Replace Mypy with Astral `ty` as this repository's sole Python type checker while preserving the existing Python 3.10 target and checked scope of `scripts/` and `tests/`.

## Changes

- Remove `mypy.ini` and the pinned Mypy dependency.
- Pin `ty==0.0.65` in `requirements.txt`.
- Add `ty` configuration to `pyproject.toml`:
  - target Python 3.10;
  - include `scripts/` and `tests/` only.
- Replace Mypy invocations in CI and pre-commit with `ty check`.
- Update repository-local guidance if it names Mypy.

## Compatibility

Do not retain an inert Mypy or Pyright configuration solely to satisfy `harness-score`. Version 1.3.2 does not recognize `ty`, so the honest expected scanner result is 104/108 until the scanner adds `ty` detection. All other scanner checks must remain passing.

## Validation

Run the pinned tooling in an isolated environment and require:

- `ty check` succeeds for `scripts/` and `tests/`;
- Pytest passes;
- Ruff lint and format checks pass;
- every pre-commit hook passes;
- `python3 scripts/validate.py` passes;
- `actionlint` passes for workflow changes;
- `npx harness-score` reports only the known `ty` detection gap;
- no Mypy references remain in active repository files.

## Boundaries

- Do not change portable public skill behavior.
- Do not add a second type checker.
- Do not alter release packaging or release triggers.
- Preserve all existing uncommitted harness work.
