from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "cccc"))

import install  # noqa: E402

HOOK = "/home/agent/.local/share/cccc-agent/hook.py"
STALE = f"CCCC_HARNESS=claude /opt/homebrew/Cellar/python@3.14/bin/python3.14 {HOOK}"


def cmd_for(harness: str) -> str:
    return f"CCCC_HARNESS={harness} /usr/bin/python3 {HOOK}"


def seed(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def claude_settings(tmp_path: Path) -> Path:
    return tmp_path / ".claude" / "settings.json"


def test_claude_wiring_keeps_foreign_hooks(tmp_path: Path) -> None:
    path = claude_settings(tmp_path)
    atuin = {"matcher": "Bash", "hooks": [{"type": "command", "command": "atuin"}]}
    seed(path, {"hooks": {"PostToolUse": [atuin]}})

    assert install.wire_claude(tmp_path, cmd_for) == "wired"

    groups = json.loads(path.read_text(encoding="utf-8"))["hooks"]["PostToolUse"]
    assert atuin in groups
    assert len([g for g in groups if install.is_cccc(g)]) == 1


def test_claude_wiring_is_idempotent(tmp_path: Path) -> None:
    path = claude_settings(tmp_path)
    install.wire_claude(tmp_path, cmd_for)
    before = path.read_bytes()

    assert install.wire_claude(tmp_path, cmd_for) == "unchanged"
    assert path.read_bytes() == before


def test_claude_wiring_repairs_a_stale_interpreter(tmp_path: Path) -> None:
    path = claude_settings(tmp_path)
    stale = {"matcher": install.CLAUDE_MATCHER, "hooks": [install.handler(STALE, 10)]}
    seed(path, {"hooks": {"PostToolUse": [stale]}})

    assert install.wire_claude(tmp_path, cmd_for) == "repaired"

    groups = json.loads(path.read_text(encoding="utf-8"))["hooks"]["PostToolUse"]
    assert len(groups) == 1
    assert groups[0]["hooks"][0]["command"] == cmd_for("claude")


def test_cursor_wiring_keeps_foreign_stop_hooks(tmp_path: Path) -> None:
    path = tmp_path / ".cursor" / "hooks.json"
    orca = {"command": "orca-stop", "timeout": 5}
    seed(path, {"version": 1, "hooks": {"stop": [orca]}})

    assert install.wire_cursor(tmp_path, cmd_for) == "wired"

    entries = json.loads(path.read_text(encoding="utf-8"))["hooks"]["stop"]
    assert orca in entries
    assert {"command": cmd_for("cursor"), "timeout": 15} in entries


def hermes_config(tmp_path: Path) -> Path:
    return tmp_path / ".hermes" / "config.yaml"


def test_hermes_block_is_appended_without_touching_existing_keys(
    tmp_path: Path,
) -> None:
    path = hermes_config(tmp_path)
    original = "# my notes\nmodel: sonnet\nagent:\n  verbose: true\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(original, encoding="utf-8")

    assert install.wire_hermes(tmp_path, cmd_for) == "wired"

    text = path.read_text(encoding="utf-8")
    assert text.startswith(original)
    assert "pre_verify" in text
    assert install.HERMES_MATCHER in text
    assert install.wire_hermes(tmp_path, cmd_for) == "unchanged"


def test_hermes_existing_hooks_block_without_pyyaml_is_manual(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = hermes_config(tmp_path)
    original = "model: sonnet\nhooks:\n  pre_tool_call: []\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(original, encoding="utf-8")
    monkeypatch.setitem(sys.modules, "yaml", None)

    assert install.wire_hermes(tmp_path, cmd_for) == "manual"
    assert path.read_text(encoding="utf-8") == original


def test_pi_extension_is_written_and_siblings_survive(tmp_path: Path) -> None:
    extensions = tmp_path / ".pi" / "agent" / "extensions"
    extensions.mkdir(parents=True)
    deja = extensions / "deja.ts"
    deja.write_text("// deja\n", encoding="utf-8")

    assert install.wire_pi(tmp_path, "/usr/bin/python3", Path(HOOK)) == "wired"

    text = (extensions / "cccc.ts").read_text(encoding="utf-8")
    assert '"/usr/bin/python3"' in text
    assert f'"{HOOK}"' in text
    assert "__PYTHON__" not in text
    assert deja.read_text(encoding="utf-8") == "// deja\n"
    assert install.wire_pi(tmp_path, "/usr/bin/python3", Path(HOOK)) == "unchanged"


@pytest.mark.parametrize(
    ("machine", "system", "expected"),
    [
        ("arm64", "darwin", "aarch64-apple-darwin"),
        ("x86_64", "linux", "x86_64-unknown-linux-musl"),
    ],
)
def test_host_triple_maps_supported_platforms(
    monkeypatch: pytest.MonkeyPatch, machine: str, system: str, expected: str
) -> None:
    monkeypatch.setattr(install.platform, "machine", lambda: machine)
    monkeypatch.setattr(install.sys, "platform", system)

    assert install.host_triple() == expected


def test_host_triple_rejects_an_unsupported_platform(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(install.platform, "machine", lambda: "mips")
    monkeypatch.setattr(install.sys, "platform", "linux")

    with pytest.raises(SystemExit):
        install.host_triple()


def test_copilot_names_the_event_the_payload_omits(tmp_path: Path) -> None:
    assert install.wire_copilot(tmp_path, cmd_for) == "wired"

    hooks = json.loads(
        (tmp_path / ".copilot" / "hooks" / "cccc.json").read_text(encoding="utf-8")
    )["hooks"]
    edit = hooks["postToolUse"][0]
    stop = hooks["agentStop"][0]

    assert edit["bash"].startswith("CCCC_EVENT=postToolUse ")
    assert stop["bash"].startswith("CCCC_EVENT=agentStop ")
    assert edit["matcher"] == "apply_patch"


def profile_home(tmp_path: Path, launcher: str, profile: str) -> Path:
    path = tmp_path / ".local/share/trellage/profiles" / launcher / profile / "home"
    path.mkdir(parents=True)
    return path


def test_a_missing_trellage_directory_is_skipped(tmp_path: Path) -> None:
    assert install.trellage_profiles(tmp_path) == []
    assert install.wire_profiles(tmp_path, cmd_for) == {}


def test_trellage_profiles_are_wired_beside_the_home_config(tmp_path: Path) -> None:
    claude = profile_home(tmp_path, "claude", "default")
    seed(claude / "settings.json", {"skipDangerousModePermissionPrompt": True})
    profile_home(tmp_path, "grok", "hve")

    assert install.wire_profiles(tmp_path, cmd_for) == {
        "claude/default": "wired",
        "grok/hve": "wired",
    }

    settings = json.loads((claude / "settings.json").read_text(encoding="utf-8"))
    assert settings["skipDangerousModePermissionPrompt"] is True
    assert install.is_cccc(settings["hooks"]["PostToolUse"][0])
    assert (
        tmp_path / ".local/share/trellage/profiles/grok/hve/home/hooks/cccc.json"
    ).is_file()

    assert install.wire_profiles(tmp_path, cmd_for) == {
        "claude/default": "unchanged",
        "grok/hve": "unchanged",
    }


def test_unsupported_launchers_are_ignored(tmp_path: Path) -> None:
    profile_home(tmp_path, "jcode", "default")
    profile_home(tmp_path, "prime", "default")

    assert install.wire_profiles(tmp_path, cmd_for) == {}


def test_a_broken_profile_never_stops_the_install(tmp_path: Path) -> None:
    broken = profile_home(tmp_path, "codex", "hve")
    (broken / "hooks.json").write_text("{ not json", encoding="utf-8")
    profile_home(tmp_path, "claude", "default")

    statuses = install.wire_profiles(tmp_path, cmd_for)

    assert statuses["codex/hve"].startswith("skipped")
    assert statuses["claude/default"] == "wired"
