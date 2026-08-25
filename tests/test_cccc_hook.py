from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "cccc"))

import hook  # noqa: E402


def write_source(tmp_path: Path, name: str = "sample.ts") -> Path:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("export const a = 1;\n", encoding="utf-8")
    return path


def test_claude_payload_yields_the_edited_path(tmp_path: Path) -> None:
    target = write_source(tmp_path)
    payload = {
        "hook_event_name": "PostToolUse",
        "cwd": str(tmp_path),
        "tool_input": {"file_path": str(target)},
    }

    assert hook.extract_paths(payload) == [target.resolve()]


def test_codex_apply_patch_yields_the_edited_path(tmp_path: Path) -> None:
    target = write_source(tmp_path)
    payload = {
        "hook_event_name": "post_tool_use",
        "cwd": str(tmp_path),
        "tool_input": {
            "patch": f"*** Begin Patch\n*** Update File: {target}\n*** End Patch\n"
        },
    }

    assert hook.extract_paths(payload) == [target.resolve()]


def test_hermes_post_tool_call_is_an_edit_event_and_yields_the_path(
    tmp_path: Path,
) -> None:
    target = write_source(tmp_path)
    payload = {
        "hook_event_name": "post_tool_call",
        "tool_name": "write_file",
        "cwd": str(tmp_path),
        "tool_input": {"path": str(target)},
    }

    assert hook.is_edit_event(hook.event_name(payload))
    assert hook.extract_paths(payload) == [target.resolve()]


def test_hermes_pre_verify_is_a_stop_event() -> None:
    assert hook.is_stop_event("pre_verify")
    assert not hook.is_edit_event("pre_verify")


@pytest.mark.parametrize("name", ["node_modules/pkg/index.ts", "notes.md"])
def test_ignored_paths_are_skipped(tmp_path: Path, name: str) -> None:
    target = write_source(tmp_path, name)
    payload = {
        "hook_event_name": "PostToolUse",
        "cwd": str(tmp_path),
        "tool_input": {"file_path": str(target)},
    }

    assert hook.extract_paths(payload) == []


def test_codex_post_edit_carries_both_block_and_context(capsys) -> None:
    assert hook.emit("codex", False, "msg") == 0

    payload = json.loads(capsys.readouterr().out)
    assert payload["decision"] == "block"
    assert payload["hookSpecificOutput"]["additionalContext"] == "msg"


def test_claude_stop_exits_two(capsys) -> None:
    assert hook.emit("claude", True, "msg") == 2

    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"decision": "block", "reason": "msg"}
    assert "msg" in captured.err


def test_grok_writes_nothing_after_an_edit(capsys) -> None:
    assert hook.emit("grok", False, "msg") == 0

    assert capsys.readouterr().out == ""


def test_hermes_blocks_on_the_verify_gate(capsys) -> None:
    assert hook.emit("hermes", True, "msg") == 0

    assert json.loads(capsys.readouterr().out) == {
        "decision": "block",
        "reason": "msg",
    }


def test_pi_reports_a_blocked_result(capsys) -> None:
    assert hook.emit("pi", False, "msg") == 0

    assert json.loads(capsys.readouterr().out) == {"blocked": True, "reason": "msg"}


def test_stop_for_a_non_final_reason_does_nothing() -> None:
    payload = {"hook_event_name": "Stop", "reason": "compaction"}

    result = subprocess.run(
        [sys.executable, "tools/cccc/hook.py"],
        cwd=ROOT,
        input=json.dumps(payload),
        capture_output=True,
        check=True,
        text=True,
    )

    assert result.stdout == ""
