#!/usr/bin/env python3
"""Install the cccc complexity gate and wire it into every agent harness.

Downloads the current cccc release binary, installs the Python adapter, and
wires user-level hooks for Claude Code, Codex, Copilot CLI, Grok, Cursor, Pi,
and Hermes. Idempotent: re-running upgrades the binary and repairs stale hook
commands.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any

REPO = "moznion/cccc"
MARKER = "cccc-agent/hook.py"

TRIPLES = {
    ("darwin", "arm64"): "aarch64-apple-darwin",
    ("darwin", "x86_64"): "x86_64-apple-darwin",
    ("linux", "arm64"): "aarch64-unknown-linux-musl",
    ("linux", "x86_64"): "x86_64-unknown-linux-musl",
}
ARCHES = {
    "arm64": "arm64",
    "aarch64": "arm64",
    "x86_64": "x86_64",
    "amd64": "x86_64",
}

CLAUDE_MATCHER = "Edit|Write|MultiEdit"
CODEX_MATCHER = "apply_patch|Edit|Write"
COPILOT_MATCHER = "apply_patch"
GROK_MATCHER = "search_replace|Edit|Write|MultiEdit"
HERMES_MATCHER = "write_file|patch"

HERMES_EVENTS = (
    ("post_tool_call", HERMES_MATCHER, 10),
    ("pre_verify", None, 15),
)
HERMES_BLOCK = """\
# cccc complexity gate — added by tools/cccc/install.py
hooks:
  post_tool_call:
    - command: "{command}"
      matcher: "{matcher}"
      timeout: 10
  pre_verify:
    - command: "{command}"
      timeout: 15
"""

USER_CONFIG_TEXT = """\
# User defaults for the agent complexity gate.
# A project cccc.toml in or above the edited file wins.
max-cognitive = 15
max-cyclomatic = 15
"""

PROBE_SOURCE = (
    "export function f(x: number) {\n"
    + "".join(f"  if (x === {n}) return '{n}';\n" for n in range(16))
    + "  return 'n';\n}\n"
)


# --------------------------------------------------------------------------
# Binary acquisition
# --------------------------------------------------------------------------


def host_triple() -> str:
    arch = ARCHES.get(platform.machine().lower())
    triple = TRIPLES.get((sys.platform, arch or ""))
    if triple is None:
        raise SystemExit(
            f"cccc: no release build for {sys.platform}/{platform.machine()}. "
            "Install cccc yourself and re-run with CCCC_BIN set."
        )
    return triple


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:  # noqa: S310
        return response.read()


def latest_tag() -> str:
    pinned = os.environ.get("CCCC_VERSION", "").strip()
    if pinned:
        return pinned
    data = json.loads(fetch(f"https://api.github.com/repos/{REPO}/releases/latest"))
    tag = data.get("tag_name")
    if not isinstance(tag, str) or not tag:
        raise SystemExit("cccc: GitHub did not report a latest release tag")
    return tag


def chmod_exec(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def extract_cccc(archive: bytes, dest: Path) -> None:
    """Write the single `cccc` member of the tarball to dest, atomically."""
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        member = tar.extractfile("cccc")
        if member is None:
            raise SystemExit("cccc: the release tarball has no cccc binary")
        payload = member.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.parent / f".{dest.name}.tmp"
    tmp.write_bytes(payload)
    chmod_exec(tmp)
    os.replace(tmp, dest)


def download_binary(tag: str, dest: Path) -> None:
    base = f"https://github.com/{REPO}/releases/download/{tag}"
    stem = f"cccc-{tag}-{host_triple()}"
    archive = fetch(f"{base}/{stem}.tar.gz")
    expected = fetch(f"{base}/{stem}.sha256").decode("utf-8").split()[0]
    actual = hashlib.sha256(archive).hexdigest()
    if actual != expected:
        raise SystemExit(
            f"cccc: checksum mismatch for {stem}.tar.gz\n"
            f"  expected {expected}\n  got      {actual}"
        )
    extract_cccc(archive, dest)


def installed_version(binary: str) -> str:
    try:
        proc = subprocess.run(
            [binary, "--version"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (proc.stdout or proc.stderr or "").strip()


def resolve_tag(existing: str) -> str | None:
    """Latest release tag, or None when offline with a usable binary present."""
    try:
        return latest_tag()
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        if existing:
            print(f"cccc: cannot reach GitHub ({exc}); keeping the installed binary")
            return None
        raise SystemExit(f"cccc: cannot reach GitHub for a release: {exc}") from exc


def ensure_binary(home: Path) -> tuple[Path, str]:
    override = os.environ.get("CCCC_BIN", "").strip()
    if override and os.access(override, os.X_OK):
        return Path(override), "CCCC_BIN override"

    dest = home / ".local" / "bin" / "cccc"
    existing = shutil.which("cccc") or (str(dest) if dest.is_file() else "")
    tag = resolve_tag(existing)
    if tag is None:
        return Path(existing), "kept (offline)"
    if (
        existing
        and os.environ.get("CCCC_FORCE_DOWNLOAD") != "1"
        and tag.lstrip("v") in installed_version(existing).split()
    ):
        return Path(existing), f"present {tag}"
    download_binary(tag, dest)
    return dest, f"downloaded {tag}"


# --------------------------------------------------------------------------
# Adapter and command
# --------------------------------------------------------------------------


def install_adapter(home: Path) -> Path:
    source = Path(__file__).resolve().parent / "hook.py"
    dest = home / ".local" / "share" / "cccc-agent" / "hook.py"
    text = source.read_text(encoding="utf-8")
    if not dest.is_file() or dest.read_text(encoding="utf-8") != text:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
    chmod_exec(dest)
    return dest


def python_interpreter() -> str:
    return shutil.which("python3") or sys.executable


def hook_command(python: str, hook: Path, harness: str) -> str:
    return f"CCCC_HARNESS={harness} {python} {hook}"


def write_user_config(home: Path) -> str:
    path = home / ".config" / "cccc" / "cccc.toml"
    if path.is_file():
        return f"{path} (kept)"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(USER_CONFIG_TEXT, encoding="utf-8")
    return f"{path} (written)"


# --------------------------------------------------------------------------
# Shared wiring helpers
# --------------------------------------------------------------------------


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"cccc: {path} is not valid JSON: {exc}") from exc
    return data if isinstance(data, dict) else {}


def backup(path: Path) -> None:
    target = path.with_name(path.name + ".bak-cccc")
    if path.is_file() and not target.exists():
        shutil.copy2(path, target)


def dump_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def is_cccc(entry: Any) -> bool:
    return MARKER in json.dumps(entry)


def merge_entry(entries: list[Any], desired: dict[str, Any]) -> str:
    """Append, replace, or leave the cccc entry alone. Other entries survive."""
    for index, entry in enumerate(entries):
        if not is_cccc(entry):
            continue
        if entry == desired:
            return "unchanged"
        entries[index] = desired
        return "repaired"
    entries.append(desired)
    return "wired"


def combine(statuses: list[str]) -> str:
    if "repaired" in statuses:
        return "repaired"
    if "wired" in statuses:
        return "wired"
    return "unchanged"


def handler(command: str, timeout: int) -> dict[str, Any]:
    return {
        "type": "command",
        "command": command,
        "timeout": timeout,
        "statusMessage": "Checking complexity…",
    }


def group(command: str, matcher: str | None, timeout: int) -> dict[str, Any]:
    entry: dict[str, Any] = {"hooks": [handler(command, timeout)]}
    if matcher:
        entry["matcher"] = matcher
    return entry


def write_if_different(path: Path, text: str) -> str:
    if path.is_file():
        if path.read_text(encoding="utf-8") == text:
            return "unchanged"
        status = "repaired"
    else:
        status = "wired"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return status


def wire_grouped(
    path: Path,
    command: str,
    events: tuple[tuple[str, str | None, int], ...],
) -> str:
    """Merge cccc into a shared settings file that groups hooks by event."""
    data = load_json(path)
    hooks = data.setdefault("hooks", {})
    statuses = [
        merge_entry(hooks.setdefault(event, []), group(command, matcher, timeout))
        for event, matcher, timeout in events
    ]
    status = combine(statuses)
    if status != "unchanged":
        backup(path)
        dump_json(path, data)
    return status


# --------------------------------------------------------------------------
# Per-harness wiring
# --------------------------------------------------------------------------


def wire_claude_dir(config: Path, command: str) -> str:
    return wire_grouped(
        config / "settings.json",
        command,
        (("PostToolUse", CLAUDE_MATCHER, 10), ("Stop", None, 15)),
    )


def wire_codex_dir(config: Path, command: str) -> str:
    return wire_grouped(
        config / "hooks.json",
        command,
        (("PostToolUse", CODEX_MATCHER, 10), ("Stop", None, 15)),
    )


def wire_grok_dir(config: Path, command: str) -> str:
    data = {
        "hooks": {
            "PostToolUse": [group(command, GROK_MATCHER, 10)],
            "Stop": [group(command, None, 15)],
        }
    }
    text = json.dumps(data, indent=2) + "\n"
    return write_if_different(config / "hooks" / "cccc.json", text)


def copilot_command(command: str, event: str) -> str:
    """Copilot sends no event name in its payload, so name it in the command."""
    return f"CCCC_EVENT={event} {command}"


def wire_copilot_dir(config: Path, command: str) -> str:
    data = {
        "version": 1,
        "hooks": {
            "postToolUse": [
                {
                    "type": "command",
                    "bash": copilot_command(command, "postToolUse"),
                    "matcher": COPILOT_MATCHER,
                    "timeoutSec": 10,
                }
            ],
            "agentStop": [
                {
                    "type": "command",
                    "bash": copilot_command(command, "agentStop"),
                    "timeoutSec": 15,
                }
            ],
        },
    }
    text = json.dumps(data, indent=2) + "\n"
    return write_if_different(config / "hooks" / "cccc.json", text)


def wire_claude(home: Path, cmd_for: Callable[[str], str]) -> str:
    return wire_claude_dir(home / ".claude", cmd_for("claude"))


def wire_codex(home: Path, cmd_for: Callable[[str], str]) -> str:
    return wire_codex_dir(home / ".codex", cmd_for("codex"))


def wire_grok(home: Path, cmd_for: Callable[[str], str]) -> str:
    return wire_grok_dir(home / ".grok", cmd_for("grok"))


def wire_copilot(home: Path, cmd_for: Callable[[str], str]) -> str:
    return wire_copilot_dir(home / ".copilot", cmd_for("copilot"))


def wire_cursor(home: Path, cmd_for: Callable[[str], str]) -> str:
    path = home / ".cursor" / "hooks.json"
    data = load_json(path)
    data.setdefault("version", 1)
    hooks = data.setdefault("hooks", {})
    command = cmd_for("cursor")
    statuses = [
        merge_entry(
            hooks.setdefault(event, []), {"command": command, "timeout": timeout}
        )
        for event, timeout in (("postToolUse", 10), ("stop", 15))
    ]
    status = combine(statuses)
    if status != "unchanged":
        backup(path)
        dump_json(path, data)
    return status


def wire_pi(home: Path, python: str, hook: Path) -> str:
    template = Path(__file__).resolve().parent / "pi-extension.ts"
    text = template.read_text(encoding="utf-8")
    text = text.replace("__PYTHON__", python).replace("__HOOK__", str(hook))
    return write_if_different(home / ".pi" / "agent" / "extensions" / "cccc.ts", text)


def merge_hermes_yaml(path: Path, text: str, command: str) -> str:
    """Merge into an existing hooks: block. Needs PyYAML; comments are lost."""
    try:
        import yaml
    except ImportError:
        return "manual"
    data = yaml.safe_load(text) or {}
    hooks = data.setdefault("hooks", {})
    statuses = []
    for event, matcher, timeout in HERMES_EVENTS:
        desired: dict[str, Any] = {"command": command, "timeout": timeout}
        if matcher:
            desired["matcher"] = matcher
        statuses.append(merge_entry(hooks.setdefault(event, []), desired))
    status = combine(statuses)
    if status == "unchanged":
        return status
    backup(path)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    print(
        f"hermes: merged into the existing hooks: block; comments in {path} were lost"
    )
    return status


def wire_hermes(home: Path, cmd_for: Callable[[str], str]) -> str:
    path = home / ".hermes" / "config.yaml"
    command = cmd_for("hermes")
    block = HERMES_BLOCK.format(command=command, matcher=HERMES_MATCHER)
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(block, encoding="utf-8")
        return "wired"
    text = path.read_text(encoding="utf-8")
    if block in text:
        return "unchanged"
    if re.search(r"^hooks:", text, re.MULTILINE) is not None:
        return merge_hermes_yaml(path, text, command)
    backup(path)
    separator = "\n" if text.endswith("\n") else "\n\n"
    path.write_text(text + separator + block, encoding="utf-8")
    return "wired"


# --------------------------------------------------------------------------
# Trellage profiles
#
# The trx launchers keep $HOME but point the harness at its own config
# directory. Wiring the home-level config alone leaves those sessions
# ungated. Absent trellage, this section does nothing.
# --------------------------------------------------------------------------


PROFILE_WIRERS: dict[str, Callable[[Path, str], str]] = {
    "claude": wire_claude_dir,
    "codex": wire_codex_dir,
    "copilot": wire_copilot_dir,
    "grok": wire_grok_dir,
}


def trellage_profiles(home: Path) -> list[tuple[str, str, Path]]:
    """(launcher, profile, config dir) for each supported trellage profile."""
    root = home / ".local" / "share" / "trellage" / "profiles"
    found: list[tuple[str, str, Path]] = []
    try:
        if not root.is_dir():
            return found
        for launcher in sorted(PROFILE_WIRERS):
            for config in sorted((root / launcher).glob("*/home")):
                if config.is_dir():
                    found.append((launcher, config.parent.name, config))
    except OSError:
        return found
    return found


def wire_profiles(home: Path, cmd_for: Callable[[str], str]) -> dict[str, str]:
    """Wire every trellage profile. One bad profile never stops the install."""
    statuses: dict[str, str] = {}
    for launcher, profile, config in trellage_profiles(home):
        try:
            status = PROFILE_WIRERS[launcher](config, cmd_for(launcher))
        except (OSError, SystemExit) as exc:
            status = f"skipped ({exc})"
        statuses[f"{launcher}/{profile}"] = status
    return statuses


# --------------------------------------------------------------------------
# Probe and reporting
# --------------------------------------------------------------------------


def probe(python: str, hook: Path, home: Path) -> None:
    """Run the installed adapter over a known-bad file. Fail loudly if inert."""
    sample = home / ".cache" / "cccc-hook" / "probe.ts"
    sample.parent.mkdir(parents=True, exist_ok=True)
    sample.write_text(PROBE_SOURCE, encoding="utf-8")
    payload = {
        "hook_event_name": "PostToolUse",
        "session_id": "cccc-install-probe",
        "cwd": str(sample.parent),
        "tool_name": "Edit",
        "tool_input": {"file_path": str(sample)},
    }
    env = os.environ.copy()
    env["CCCC_HARNESS"] = "claude"
    env["CCCC_MAX_CYCLOMATIC"] = "5"
    result = subprocess.run(
        [python, str(hook)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    sample.unlink(missing_ok=True)
    if "Complexity gate failed" not in result.stdout:
        raise SystemExit(
            "cccc: the probe did not flag a high-complexity file — the gate is inert\n"
            f"stdout={result.stdout}\nstderr={result.stderr}"
        )
    print("probe:       complexity gate fires — ok")


def warn_path(home: Path) -> None:
    bin_dir = str(home / ".local" / "bin")
    if bin_dir not in os.environ.get("PATH", "").split(os.pathsep):
        print(f"warning: {bin_dir} is not on PATH")


def report_next_steps(statuses: dict[str, str]) -> None:
    print("\nRestart each harness so it reloads its hooks.")
    print("Codex: open /hooks and trust the cccc command.")
    if statuses.get("hermes") == "manual":
        print(
            "Hermes: config.yaml already has a hooks: key and PyYAML is missing. "
            "Add the block printed above by hand."
        )
    else:
        print(
            "Hermes: approve the shell hook at a TTY, or use --accept-hooks / "
            "HERMES_ACCEPT_HOOKS=1. Check with: hermes hooks list"
        )
    print("Per-repo override: add cccc.toml with max-cyclomatic / max-cognitive.")


def wire_all(home: Path, python: str, hook: Path) -> dict[str, str]:
    cmd_for = partial(hook_command, python, hook)
    statuses = {
        "claude": wire_claude(home, cmd_for),
        "codex": wire_codex(home, cmd_for),
        "copilot": wire_copilot(home, cmd_for),
        "grok": wire_grok(home, cmd_for),
        "cursor": wire_cursor(home, cmd_for),
        "pi": wire_pi(home, python, hook),
        "hermes": wire_hermes(home, cmd_for),
    }
    statuses.update(wire_profiles(home, cmd_for))
    return statuses


def main() -> int:
    home = Path.home()
    binary, binary_status = ensure_binary(home)
    hook = install_adapter(home)
    python = python_interpreter()

    print(f"cccc binary: {binary} ({binary_status})")
    print(f"adapter:     {hook}")
    print(f"config:      {write_user_config(home)}")
    statuses = wire_all(home, python, hook)
    for name, status in statuses.items():
        print(f"{name:<20} {status}")
    probe(python, hook, home)
    warn_path(home)
    report_next_steps(statuses)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
