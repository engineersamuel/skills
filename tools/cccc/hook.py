#!/usr/bin/env python3
"""Agent-harness hook: fail when cccc complexity exceeds the threshold.

Reads one JSON event on stdin. Works for Claude Code, Codex, Copilot CLI,
Grok, Cursor, Pi, and Hermes. Fail-open on missing files, unsupported
languages, and tool errors.

Thresholds, first match wins:
1. CCCC_MAX_CYCLOMATIC / CCCC_MAX_COGNITIVE
2. nearest cccc.toml (project, then ~/.config/cccc/cccc.toml)
3. 15 / 15
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from shutil import which
from typing import Any

DEFAULT_MAX_CYCLOMATIC = 15
DEFAULT_MAX_COGNITIVE = 15
STATE_DIR = Path.home() / ".cache" / "cccc-hook"
USER_CONFIG = Path.home() / ".config" / "cccc" / "cccc.toml"
MAX_FINDINGS = 8
MESSAGE_CAP = 3500

SUPPORTED_EXT = frozenset(
    {
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mts",
        ".cts",
        ".mjs",
        ".cjs",
        ".rs",
        ".go",
        ".php",
        ".rb",
        ".scm",
        ".ss",
        ".sld",
        ".rkt",
        ".rktl",
        ".rktd",
        ".lisp",
        ".lsp",
        ".cl",
        ".el",
        ".clj",
        ".cljs",
        ".cljc",
        ".kt",
        ".kts",
        ".py",
        ".pyi",
        ".zig",
        ".c",
        ".h",
        ".pl",
        ".pm",
        ".t",
        ".swift",
        ".java",
        ".dart",
    }
)
SKIP_PARTS = frozenset(
    {
        "node_modules",
        "vendor",
        "dist",
        "build",
        "target",
        ".git",
        "__pycache__",
        "coverage",
        ".next",
        ".nuxt",
        ".venv",
        "venv",
        "Pods",
        "DerivedData",
    }
)
PATCH_PATH = re.compile(r"^\*\*\* (?:Update|Add) File:\s+(\S+)", re.MULTILINE)
PATH_KEYS = frozenset(
    {
        "file_path",
        "filepath",
        "filePath",
        "path",
        "file",
        "target_file",
        "targetFile",
        "notebook_path",
        "notebookPath",
    }
)


def debug(msg: str) -> None:
    if os.environ.get("CCCC_HOOK_DEBUG") != "1":
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (STATE_DIR / "debug.log").open("a", encoding="utf-8") as fh:
        fh.write(msg + "\n")


def get(obj: Any, *names: str) -> Any:
    if not isinstance(obj, dict):
        return None
    lower = {str(k).lower(): v for k, v in obj.items()}
    for name in names:
        value = obj.get(name)
        if value not in (None, ""):
            return value
        value = lower.get(name.lower())
        if value not in (None, ""):
            return value
    return None


def parse_maybe_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text.startswith("{") or text.startswith("["):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return value
    return value


def detect_harness(payload: dict[str, Any]) -> str:
    forced = os.environ.get("CCCC_HARNESS", "").strip().lower()
    if forced:
        return forced
    if os.environ.get("GROK_HOOK_EVENT") or os.environ.get("GROK_SESSION_ID"):
        return "grok"
    keys = {k.lower() for k in payload}
    if "toolargs" in keys:
        return "copilot"
    if "tool_input" in keys:
        event = str(get(payload, "hook_event_name", "hookEventName") or "")
        if event[:1].islower():
            return "codex"
        return "claude"
    if "toolinput" in keys:
        return "grok"
    return "claude"


def event_name(payload: dict[str, Any]) -> str:
    # Copilot CLI sends no event name, so its hook command sets CCCC_EVENT.
    env_event = (
        os.environ.get("CCCC_EVENT")
        or os.environ.get("GROK_HOOK_EVENT")
        or os.environ.get("ORCA_COPILOT_HOOK_EVENT")
    )
    if env_event:
        return env_event
    return str(get(payload, "hook_event_name", "hookEventName", "event") or "")


def is_stop_event(name: str) -> bool:
    compact = name.lower().replace("_", "")
    if "failure" in compact or "cancelled" in compact:
        return False
    return compact in {"stop", "agentstop", "subagentstop", "preverify"}


def is_edit_event(name: str) -> bool:
    compact = name.lower().replace("_", "")
    return compact in {"posttooluse", "afterfileedit", "posttoolcall"}


def find_cccc() -> str | None:
    env = os.environ.get("CCCC_BIN")
    if env and Path(env).is_file() and os.access(env, os.X_OK):
        return env
    for candidate in (
        Path.home() / ".cargo" / "bin" / "cccc",
        Path.home() / ".local" / "bin" / "cccc",
    ):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return which("cccc")


def skip_path(path: Path) -> bool:
    if path.suffix.lower() not in SUPPORTED_EXT:
        return True
    if any(part in SKIP_PARTS for part in path.parts):
        return True
    name = path.name.lower()
    return name.endswith(".min.js") or name.endswith(".min.cjs")


def resolve_path(raw: str, cwd: Path) -> Path | None:
    text = raw.strip().strip("\"'")
    if not text or text in {".", ".."}:
        return None
    path = Path(text).expanduser()
    if not path.is_absolute():
        path = cwd / path
    try:
        path = path.resolve()
    except OSError:
        return None
    if skip_path(path) or not path.is_file():
        return None
    return path


def collect_from_text(text: str, cwd: Path, out: set[Path]) -> None:
    """Pull paths out of an apply_patch envelope."""
    for match in PATCH_PATH.finditer(text):
        resolved = resolve_path(match.group(1), cwd)
        if resolved is not None:
            out.add(resolved)


def collect_from_sequence(items: list[Any], cwd: Path, out: set[Path]) -> None:
    for item in items:
        collect_from_mapping(item, cwd, out)


def collect_from_dict(obj: dict[Any, Any], cwd: Path, out: set[Path]) -> None:
    for key, value in obj.items():
        if str(key) not in PATH_KEYS or not isinstance(value, str):
            collect_from_mapping(value, cwd, out)
            continue
        resolved = resolve_path(value, cwd)
        if resolved is not None:
            out.add(resolved)


def collect_from_mapping(obj: Any, cwd: Path, out: set[Path]) -> None:
    if isinstance(obj, str):
        collect_from_text(obj, cwd, out)
    elif isinstance(obj, list):
        collect_from_sequence(obj, cwd, out)
    elif isinstance(obj, dict):
        collect_from_dict(obj, cwd, out)


def extract_paths(payload: dict[str, Any]) -> list[Path]:
    cwd_raw = get(payload, "cwd", "CWD") or os.getcwd()
    cwd = Path(str(cwd_raw)).expanduser()
    try:
        cwd = cwd.resolve()
    except OSError:
        cwd = Path.cwd()
    tool_input = parse_maybe_json(
        get(payload, "tool_input", "toolInput", "toolArgs", "tool_args")
    )
    found: set[Path] = set()
    collect_from_mapping(tool_input, cwd, found)
    if not found:
        collect_from_mapping(payload, cwd, found)
    return sorted(found)


def find_config(path: Path, workspace: Path | None) -> Path | None:
    start = path.parent if path.is_file() else path
    stop = workspace.resolve() if workspace is not None else None
    for directory in [start, *start.parents]:
        for name in ("cccc.toml", ".cccc.toml"):
            candidate = directory / name
            if candidate.is_file():
                return candidate
        if stop is not None and directory == stop:
            break
    if USER_CONFIG.is_file():
        return USER_CONFIG
    return None


def read_toml_max(path: Path) -> tuple[int | None, int | None]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None, None
    cyc: int | None = None
    cog: int | None = None
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0]
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"')
        try:
            number = int(value)
        except ValueError:
            continue
        if key in {"max-cyclomatic", "max_cyclomatic"}:
            cyc = number
        elif key in {"max-cognitive", "max_cognitive"}:
            cog = number
    return cyc, cog


def env_int(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def thresholds(config: Path | None) -> tuple[int, int]:
    cyc = env_int("CCCC_MAX_CYCLOMATIC")
    cog = env_int("CCCC_MAX_COGNITIVE")
    if config is not None:
        file_cyc, file_cog = read_toml_max(config)
        if cyc is None:
            cyc = file_cyc
        if cog is None:
            cog = file_cog
    return (
        DEFAULT_MAX_CYCLOMATIC if cyc is None else cyc,
        DEFAULT_MAX_COGNITIVE if cog is None else cog,
    )


def walk_functions(functions: list[Any], out: list[dict[str, Any]]) -> None:
    for fn in functions:
        if not isinstance(fn, dict):
            continue
        out.append(fn)
        children = fn.get("children")
        if isinstance(children, list):
            walk_functions(children, out)


def analyze_file(binary: str, path: Path) -> list[dict[str, Any]]:
    try:
        proc = subprocess.run(
            [binary, str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        debug(f"cccc failed {path}: {exc}")
        return []
    try:
        report = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        debug(f"cccc non-json {path}: {(proc.stderr or '')[:200]}")
        return []
    files = report.get("files") if isinstance(report, dict) else None
    if not isinstance(files, list):
        return []
    fns: list[dict[str, Any]] = []
    for entry in files:
        if isinstance(entry, dict):
            walk_functions(list(entry.get("functions") or []), fns)
    return fns


def hits_for_file(
    binary: str, path: Path, max_cyc: int, max_cog: int
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for fn in analyze_file(binary, path):
        cyc = int(fn.get("cyclomatic") or 0)
        cog = int(fn.get("cognitive") or 0)
        if cyc > max_cyc or cog > max_cog:
            hits.append(
                {
                    "file": str(path),
                    "name": str(fn.get("name") or "anonymous"),
                    "line": int(fn.get("line") or 0),
                    "cyclomatic": cyc,
                    "cognitive": cog,
                }
            )
    return hits


def format_message(hits: list[dict[str, Any]], max_cyc: int, max_cog: int) -> str:
    lines = [
        "Complexity gate failed. Split the functions below. Do not rename-only.",
        f"Limits: cyclomatic {max_cyc}, cognitive {max_cog}.",
        "",
    ]
    for hit in hits[:MAX_FINDINGS]:
        lines.append(
            f"{hit['file']}:{hit['line']} {hit['name']}: "
            f"cyclomatic={hit['cyclomatic']} cognitive={hit['cognitive']}"
        )
    extra = len(hits) - MAX_FINDINGS
    if extra > 0:
        lines.append(f"... {extra} more")
    text = "\n".join(lines)
    if len(text) > MESSAGE_CAP:
        text = text[: MESSAGE_CAP - 3] + "..."
    return text


def state_path(payload: dict[str, Any]) -> Path:
    session = (
        get(payload, "session_id", "sessionId")
        or os.environ.get("GROK_SESSION_ID")
        or os.environ.get("CLAUDE_SESSION_ID")
        or "default"
    )
    cwd = get(payload, "cwd") or os.getcwd()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{session}_{cwd}")[:180]
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"{safe}.json"


def load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"failing": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"failing": {}}
    if not isinstance(data, dict) or not isinstance(data.get("failing"), dict):
        return {"failing": {}}
    return data


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state), encoding="utf-8")


def write_json(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")


def block_payload(message: str) -> dict[str, Any]:
    return {"decision": "block", "reason": message}


def post_payload(message: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": message,
        }
    }


def emit_copilot(stop: bool, message: str) -> int:
    write_json(block_payload(message) if stop else {"additionalContext": message})
    return 0


def emit_codex(stop: bool, message: str) -> int:
    payload = block_payload(message)
    if not stop:
        payload.update(post_payload(message))
    write_json(payload)
    return 0


def emit_stop_only(stop: bool, message: str) -> int:
    """Grok and Hermes discard post-edit stdout; only the stop gate is read."""
    if stop:
        write_json(block_payload(message))
    return 0


def emit_cursor(stop: bool, message: str) -> int:
    if stop:
        write_json(block_payload(message))
    else:
        write_json({"additionalContext": message, "additional_context": message})
    return 0


def emit_pi(stop: bool, message: str) -> int:
    """The Pi extension reads this shape directly; it has no stop event."""
    write_json({"blocked": True, "reason": message})
    return 0


def emit_claude(stop: bool, message: str) -> int:
    if not stop:
        write_json(post_payload(message))
        return 0
    sys.stderr.write(message + "\n")
    write_json(block_payload(message))
    return 2


EMITTERS = {
    "claude": emit_claude,
    "codex": emit_codex,
    "copilot": emit_copilot,
    "cursor": emit_cursor,
    "grok": emit_stop_only,
    "hermes": emit_stop_only,
    "pi": emit_pi,
}


def emit(harness: str, stop: bool, message: str) -> int:
    return EMITTERS.get(harness, emit_claude)(stop, message)


def workspace_root(payload: dict[str, Any]) -> Path | None:
    raw = (
        get(payload, "workspaceRoot", "workspace_root")
        or os.environ.get("GROK_WORKSPACE_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
    )
    if not raw:
        return None
    try:
        return Path(str(raw)).expanduser().resolve()
    except OSError:
        return None


def limits_for(path: Path, payload: dict[str, Any]) -> tuple[int, int]:
    return thresholds(find_config(path, workspace_root(payload)))


def update_state_for_paths(
    state: dict[str, Any], paths: list[Path], hits: list[dict[str, Any]]
) -> None:
    failing: dict[str, Any] = state.setdefault("failing", {})
    hit_files = {hit["file"] for hit in hits}
    for path in paths:
        key = str(path)
        if key in hit_files:
            failing[key] = [h for h in hits if h["file"] == key]
        else:
            failing.pop(key, None)


def recheck_failing(
    binary: str, state: dict[str, Any], payload: dict[str, Any]
) -> tuple[list[dict[str, Any]], int, int]:
    remaining: list[dict[str, Any]] = []
    new_failing: dict[str, Any] = {}
    max_cyc = DEFAULT_MAX_CYCLOMATIC
    max_cog = DEFAULT_MAX_COGNITIVE
    for raw in list(state.get("failing") or {}):
        path = Path(raw)
        if not path.is_file():
            continue
        max_cyc, max_cog = limits_for(path, payload)
        hits = hits_for_file(binary, path, max_cyc, max_cog)
        if hits:
            new_failing[raw] = hits
            remaining.extend(hits)
    state["failing"] = new_failing
    return remaining, max_cyc, max_cog


def read_payload() -> dict[str, Any] | None:
    raw = sys.stdin.read()
    if not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def stop_is_final(payload: dict[str, Any]) -> bool:
    reason = str(get(payload, "reason", "stopReason", "stop_reason") or "")
    return reason in {"end_turn", ""}


def handle_edit(binary: str, harness: str, payload: dict[str, Any]) -> int:
    paths = extract_paths(payload)
    if not paths:
        return 0
    store = state_path(payload)
    state = load_state(store)
    hits: list[dict[str, Any]] = []
    max_cyc = DEFAULT_MAX_CYCLOMATIC
    max_cog = DEFAULT_MAX_COGNITIVE
    for path in paths:
        max_cyc, max_cog = limits_for(path, payload)
        hits.extend(hits_for_file(binary, path, max_cyc, max_cog))
    update_state_for_paths(state, paths, hits)
    save_state(store, state)
    if not hits:
        return 0
    return emit(harness, False, format_message(hits, max_cyc, max_cog))


def handle_stop(binary: str, harness: str, payload: dict[str, Any]) -> int:
    store = state_path(payload)
    state = load_state(store)
    hits, max_cyc, max_cog = recheck_failing(binary, state, payload)
    save_state(store, state)
    if not hits:
        return 0
    return emit(harness, True, format_message(hits, max_cyc, max_cog))


def main() -> int:
    payload = read_payload()
    if payload is None:
        return 0

    name = event_name(payload)
    stop = is_stop_event(name)
    if not stop and not is_edit_event(name):
        return 0
    if stop and not stop_is_final(payload):
        return 0

    binary = find_cccc()
    if binary is None:
        debug("cccc not on PATH")
        return 0

    harness = detect_harness(payload)
    if stop:
        return handle_stop(binary, harness, payload)
    return handle_edit(binary, harness, payload)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — fail-open
        debug(f"hook crash: {exc}")
        raise SystemExit(0) from exc
