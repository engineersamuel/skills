#!/usr/bin/env python3
"""Return lightweight feedback after Cursor edits a JSON or Python file."""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def find_path(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("file_path", "path"):
            path = value.get(key)
            if isinstance(path, str):
                return path
        for nested in value.values():
            path = find_path(nested)
            if path:
                return path
    elif isinstance(value, list):
        for nested in value:
            path = find_path(nested)
            if path:
                return path
    return ""


def check(path: Path) -> str:
    if not path.is_file():
        return "Edited path is unavailable; run repository validation before handoff."
    try:
        source = path.read_text(encoding="utf-8")
        if path.suffix == ".json":
            json.loads(source)
            return f"JSON syntax valid: {path.name}"
        if path.suffix == ".py":
            ast.parse(source, filename=str(path))
            return f"Python syntax valid: {path.name}"
    except (OSError, UnicodeError, ValueError, SyntaxError) as error:
        return f"Edited file check failed: {error}"
    return "Run the repository validation command before handoff."


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        payload = {}
    raw_path = find_path(payload)
    path = Path(raw_path)
    if raw_path and not path.is_absolute():
        path = ROOT / path
    print(json.dumps({"followup_message": check(path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
