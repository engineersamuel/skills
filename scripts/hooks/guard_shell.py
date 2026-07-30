#!/usr/bin/env python3
"""Ask for confirmation before destructive shell commands run in Cursor."""

from __future__ import annotations

import json
import re
import sys
from typing import Any

RISKY_COMMANDS = (
    re.compile(r"(?:^|[;&|]\s*)rm\s+(?:-[^\s]*[rR][^\s]*\s+|--recursive\s+)", re.I),
    re.compile(r"\bgit\s+reset\s+--hard\b", re.I),
    re.compile(r"\bgit\s+clean\s+-[^\s]*f", re.I),
    re.compile(r"\bgit\s+(?:checkout|restore)\s+--\s+", re.I),
    re.compile(r"\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f)\b", re.I),
)


def find_command(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("command", "shell_command"):
            command = value.get(key)
            if isinstance(command, str):
                return command
        for nested in value.values():
            command = find_command(nested)
            if command:
                return command
    elif isinstance(value, list):
        for nested in value:
            command = find_command(nested)
            if command:
                return command
    return ""


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        print(
            json.dumps(
                {
                    "permission": "ask",
                    "user_message": "Shell hook received invalid input.",
                }
            )
        )
        return 0

    command = find_command(payload)
    if any(pattern.search(command) for pattern in RISKY_COMMANDS):
        print(
            json.dumps(
                {
                    "permission": "ask",
                    "user_message": (
                        "Confirm this destructive shell command before it runs."
                    ),
                    "agent_message": (
                        "The repository shell guard requires user confirmation."
                    ),
                }
            )
        )
    else:
        print(json.dumps({"permission": "allow"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
