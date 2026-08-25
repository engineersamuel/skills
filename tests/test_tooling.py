from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_ty_replaces_mypy_for_repository_type_checking() -> None:
    assert not (ROOT / "mypy.ini").exists()
    assert not (ROOT / "requirements.txt").exists()

    pyproject = read("pyproject.toml")
    assert "[dependency-groups]" in pyproject
    assert '"pre-commit==4.6.1"' in pyproject
    assert '"pytest==9.1.1"' in pyproject
    assert '"ruff==0.16.0"' in pyproject
    assert '"ty==0.0.65"' in pyproject
    assert "mypy" not in pyproject.lower()
    assert "[tool.ty.environment]" in pyproject
    assert 'python-version = "3.10"' in pyproject
    assert "[tool.ty.src]" in pyproject
    assert 'include = ["scripts", "tests", "tools"]' in pyproject

    for relative_path in (".pre-commit-config.yaml", ".github/workflows/ci.yml"):
        automation = read(relative_path).lower()
        assert "ty check" in automation
        assert "mypy" not in automation

    ci = read(".github/workflows/ci.yml")
    assert "cache-dependency-path: pyproject.toml" in ci
    assert "python3 -m pip install --group dev" in ci
    assert "requirements.txt" not in ci
