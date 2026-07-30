from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_hook(relative_path: str, payload: dict[str, object]) -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, relative_path],
        cwd=ROOT,
        input=json.dumps(payload),
        capture_output=True,
        check=True,
        text=True,
    )
    parsed = json.loads(result.stdout)
    assert isinstance(parsed, dict)
    return parsed


def test_shell_guard_allows_safe_command() -> None:
    result = run_hook("scripts/hooks/guard_shell.py", {"command": "git status"})

    assert result["permission"] == "allow"


def test_shell_guard_asks_before_destructive_command() -> None:
    result = run_hook(
        "scripts/hooks/guard_shell.py", {"command": "git reset --hard HEAD~1"}
    )

    assert result["permission"] == "ask"


def test_edited_file_hook_checks_json(tmp_path: Path) -> None:
    edited = tmp_path / "sample.json"
    edited.write_text('{"valid": true}\n', encoding="utf-8")

    result = run_hook("scripts/hooks/check_edited_file.py", {"file_path": str(edited)})

    assert result["followup_message"] == "JSON syntax valid: sample.json"
