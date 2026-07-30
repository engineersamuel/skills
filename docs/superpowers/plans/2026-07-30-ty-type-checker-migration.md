# ty Type Checker Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mypy with pinned Astral `ty` as the sole Python type checker for `scripts/` and `tests/` on Python 3.10+.

**Architecture:** Keep type-checker configuration in the existing `pyproject.toml`, install the checker from the existing pinned development requirements, and invoke the same `ty check` command locally, in pre-commit, and in CI. Add a repository test that prevents Mypy configuration or commands from returning and verifies the intended `ty` scope.

**Tech Stack:** Python 3.10+, ty 0.0.65, pytest, Ruff, pre-commit, GitHub Actions

---

## File map

- `tests/test_tooling.py`: regression test for the repository's type-checker contract.
- `requirements.txt`: pinned development tools; replace Mypy with `ty`.
- `pyproject.toml`: add the Python version and source scope consumed by `ty`.
- `mypy.ini`: remove obsolete Mypy configuration.
- `.pre-commit-config.yaml`: replace the Mypy hook with `ty check`.
- `.github/workflows/ci.yml`: replace the CI Mypy invocation with `ty check`.

The affected files are part of the existing uncommitted harness batch. Do not create a partial implementation commit that separates them from their dependent uncommitted files; leave the migration changes in that batch unless the user asks to commit the complete batch.

### Task 1: Add the type-checker migration regression test

**Files:**
- Create: `tests/test_tooling.py`

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_ty_replaces_mypy_for_repository_type_checking() -> None:
    assert not (ROOT / "mypy.ini").exists()

    requirements = read("requirements.txt").splitlines()
    assert "ty==0.0.65" in requirements
    assert not any(line.startswith("mypy==") for line in requirements)

    pyproject = read("pyproject.toml")
    assert '[tool.ty.environment]' in pyproject
    assert 'python-version = "3.10"' in pyproject
    assert '[tool.ty.src]' in pyproject
    assert 'include = ["scripts", "tests"]' in pyproject

    for relative_path in (".pre-commit-config.yaml", ".github/workflows/ci.yml"):
        automation = read(relative_path).lower()
        assert "ty check" in automation
        assert "mypy" not in automation
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
uvx --from pytest==9.1.1 pytest tests/test_tooling.py -q
```

Expected: FAIL at `assert not (ROOT / "mypy.ini").exists()` because the Mypy configuration still exists.

### Task 2: Replace Mypy configuration and automation with ty

**Files:**
- Delete: `mypy.ini`
- Modify: `requirements.txt`
- Modify: `pyproject.toml`
- Modify: `.pre-commit-config.yaml`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/test_tooling.py`

- [ ] **Step 1: Replace the pinned dependency**

Change `requirements.txt` from:

```text
mypy==2.3.0
pre-commit==4.6.1
pytest==9.1.1
ruff==0.16.0
```

to:

```text
pre-commit==4.6.1
pytest==9.1.1
ruff==0.16.0
ty==0.0.65
```

- [ ] **Step 2: Configure ty and remove Mypy configuration**

Delete `mypy.ini`. Append this configuration to `pyproject.toml`:

```toml
[tool.ty.environment]
python-version = "3.10"

[tool.ty.src]
include = ["scripts", "tests"]
```

- [ ] **Step 3: Replace the pre-commit hook**

Replace:

```yaml
      - id: mypy
        name: Mypy
        entry: python3 -m mypy
        language: system
        pass_filenames: false
```

with:

```yaml
      - id: ty-check
        name: ty type check
        entry: ty check
        language: system
        pass_filenames: false
```

- [ ] **Step 4: Replace the CI command**

Change the final static-check command in `.github/workflows/ci.yml` from:

```yaml
          python3 -m mypy
```

to:

```yaml
          ty check
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
uvx --from pytest==9.1.1 pytest tests/test_tooling.py -q
```

Expected: `1 passed`.

- [ ] **Step 6: Run ty directly**

Run:

```bash
ty check
```

Expected: `All checks passed!` with exit code 0.

### Task 3: Verify the complete harness batch

**Files:**
- Verify only; do not modify files unless a check exposes a migration regression.

- [ ] **Step 1: Install the pinned tools in an isolated environment**

Run:

```bash
verify_tmp="$(mktemp -d)"
python3 -m venv "$verify_tmp/venv"
"$verify_tmp/venv/bin/python" -m pip install -r requirements.txt
```

Expected: installation succeeds and includes `ty==0.0.65`; Mypy is absent.

- [ ] **Step 2: Run tests, lint, format, and type checking**

Run with the isolated environment activated or its `bin` directory first on `PATH`:

```bash
python3 -m pytest
python3 -m ruff check .
python3 -m ruff format --check .
ty check
python3 -m pre_commit run --all-files
```

Expected: four tests pass; Ruff, `ty`, and every pre-commit hook pass.

- [ ] **Step 3: Run repository and workflow validation**

Run:

```bash
python3 scripts/validate.py
mise x go@1.25.12 -- go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
git diff --check
```

Expected: repository validation passes, `actionlint` emits no findings, and `git diff --check` emits no output.

- [ ] **Step 4: Verify removal of active Mypy references**

Run:

```bash
test ! -e mypy.ini
! rg --hidden -n -i '\bmypy\b' requirements.txt pyproject.toml .pre-commit-config.yaml .github/workflows/ci.yml
```

Expected: no matches. Historical design documents may still describe the migration from Mypy.

- [ ] **Step 5: Run the harness scorer and confirm the known limitation**

Run:

```bash
npx harness-score
```

Expected: 104/108 with only `SNS-03 Type checking in place` failing because `harness-score` 1.3.2 recognizes Mypy and Pyright configurations but not `ty`. No compatibility marker is added to hide this limitation.

- [ ] **Step 6: Inspect the final worktree**

Run:

```bash
git status --short
git diff -- requirements.txt pyproject.toml .pre-commit-config.yaml .github/workflows/ci.yml tests/test_tooling.py
```

Expected: only the intended type-checker migration appears within the existing harness batch; portable public skill behavior and release packaging are unchanged.
