#!/usr/bin/env python3
"""Validate the justify skill's packaging and behavioral contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read(relative_path: str) -> str:
    path = ROOT / relative_path
    require(path.is_file(), f"missing {relative_path}")
    return path.read_text(encoding="utf-8")


def parse_frontmatter(markdown: str) -> dict[str, str]:
    match = re.match(r"\A---\n(.*?)\n---\n", markdown, flags=re.DOTALL)
    require(match is not None, "SKILL.md must start with YAML frontmatter")

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        require(bool(separator), f"invalid frontmatter line: {line}")
        fields[key.strip()] = value.strip().strip('"')
    return fields


def validate_metadata() -> None:
    skill = read("skills/justify/SKILL.md")
    fields = parse_frontmatter(skill)
    require(
        set(fields) == {"name", "description"},
        "frontmatter must contain only name and description",
    )
    require(fields["name"] == "justify", "skill name must be justify")
    require(
        fields["description"].startswith("Use when "),
        "description must start with 'Use when '",
    )
    require(
        len(fields["description"]) <= 500, "description must be at most 500 characters"
    )

    metadata = read("skills/justify/agents/openai.yaml")
    require('display_name: "Justify"' in metadata, "Codex display_name is missing")
    require(
        re.search(r'^  short_description: ".{25,64}"$', metadata, flags=re.MULTILINE)
        is not None,
        "Codex short_description must be 25-64 quoted characters",
    )
    require("$justify" in metadata, "Codex default_prompt must mention $justify")
    require(
        'value: "exa"' in metadata, "Codex metadata must declare the Exa dependency"
    )
    require(
        "https://mcp.exa.ai/mcp" in metadata,
        "Codex metadata must declare the Exa endpoint",
    )
    print("ok: metadata")


def validate_discovery() -> None:
    skill_files = [
        path.relative_to(ROOT).as_posix()
        for path in ROOT.rglob("SKILL.md")
        if ".git" not in path.parts
    ]
    require(
        skill_files == ["skills/justify/SKILL.md"],
        f"unexpected skill discovery set: {skill_files}",
    )
    print("ok: discovery")


def validate_behavior_contract() -> None:
    skill = read("skills/justify/SKILL.md").lower()
    scenarios = {
        "audit": (
            "audit the target",
            "primary evidence",
            "claim ledger",
        ),
        "exa": (
            "research external claims",
            "exa",
            "cite",
        ),
        "council": (
            "convene the council",
            "preserve dissent",
            "after the evidence pass",
            "single-agent simulated council",
        ),
        "failure": (
            "fail closed",
            "do not fabricate",
            "incomplete",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(not missing, f"{scenario} contract missing: {', '.join(missing)}")
        print(f"ok: {scenario} behavior contract")


def validate_repository_support() -> None:
    ignore = read(".gitignore").splitlines()
    require("repomix-output.xml" in ignore, "repomix-output.xml must be ignored")

    readme = read("README.md")
    require(
        "Claude Code" in readme and "Codex" in readme,
        "README must document both harnesses",
    )
    require("npx skills add" in readme, "README must document skills CLI installation")

    workflow = read(".github/workflows/release.yml")
    require(
        re.search(r"^\s+tags:\s*$", workflow, flags=re.MULTILINE) is not None,
        "release must be tag-driven",
    )
    require("v*.*.*" in workflow, "release workflow must use semantic version tags")
    require("scripts/validate.py" in workflow, "release workflow must run validation")
    require(
        "cp -R skills/justify/. dist/staging/justify/" in workflow,
        "release workflow must package skills/justify as justify",
    )
    require(
        "gh release create" in workflow,
        "release workflow must publish a GitHub release",
    )
    print("ok: repository support")


def main() -> int:
    checks = (
        validate_metadata,
        validate_discovery,
        validate_behavior_contract,
        validate_repository_support,
    )
    try:
        for check in checks:
            check()
    except AssertionError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print("all validations passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
