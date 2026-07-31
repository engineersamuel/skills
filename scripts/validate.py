#!/usr/bin/env python3
"""Validate portable skill packaging and behavioral contracts."""

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
    if match is None:
        raise AssertionError("SKILL.md must start with YAML frontmatter")

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        require(bool(separator), f"invalid frontmatter line: {line}")
        fields[key.strip()] = value.strip().strip('"')
    return fields


def validate_metadata() -> None:
    skills = {
        "justify": "Justify",
        "runwisp-job-authoring": "RunWisp Job Authoring",
    }
    for name, display_name in skills.items():
        skill = read(f"skills/{name}/SKILL.md")
        fields = parse_frontmatter(skill)
        require(
            set(fields) == {"name", "description"},
            f"{name} frontmatter must contain only name and description",
        )
        require(fields["name"] == name, f"skill name must be {name}")
        require(
            fields["description"].startswith("Use when "),
            f"{name} description must start with 'Use when '",
        )
        require(
            len(fields["description"]) <= 500,
            f"{name} description must be at most 500 characters",
        )

        metadata = read(f"skills/{name}/agents/openai.yaml")
        require(
            f'display_name: "{display_name}"' in metadata,
            f"{name} Codex display_name is missing",
        )
        require(
            re.search(
                r'^  short_description: ".{25,64}"$', metadata, flags=re.MULTILINE
            )
            is not None,
            f"{name} Codex short_description must be 25-64 quoted characters",
        )
        require(
            f"${name}" in metadata,
            f"{name} Codex default_prompt must mention ${name}",
        )
        require(
            "dependencies:" not in metadata,
            f"{name} Codex metadata must not require provider-specific dependencies",
        )
    print("ok: metadata")


def validate_discovery() -> None:
    skill_files = sorted(
        path.relative_to(ROOT).as_posix()
        for path in ROOT.rglob("SKILL.md")
        if ".git" not in path.parts
    )
    require(
        skill_files
        == [
            ".agents/skills/validate-repository/SKILL.md",
            "skills/grilling-frontend-prototyping/SKILL.md",
            "skills/justify/SKILL.md",
            "skills/runwisp-job-authoring/SKILL.md",
        ],
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
        "external research": (
            "research external claims",
            "available web search or research capability",
            "do not require a specific provider",
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


def validate_runwisp_job_authoring_contract() -> None:
    skill = read("skills/runwisp-job-authoring/SKILL.md").lower()
    scenarios = {
        "source of truth": (
            "target repository",
            "current jobkit",
        ),
        "manifest and execution": (
            "schema",
            "required_env",
            "required_files",
            "unknown fields",
            "shell-free",
            "forwarded arguments",
            "exit codes",
        ),
        "paths and secrets": (
            "inside the job directory",
            "must be relative",
            "environment variable names",
            "nonblank",
            "secret values",
        ),
        "process ownership": (
            "replaces",
            "stdout",
            "stderr",
            "signals",
        ),
        "verification": (
            "runwisp-job doctor job_dir",
            "passive",
            "does not prove runtime",
            "dry run",
            "authorization",
        ),
        "ownership boundary": (
            "install dependencies",
            "discover jobs",
            "store secrets",
            "configure schedules",
            "sandbox",
            "actual scheduler",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(not missing, f"{scenario} contract missing: {', '.join(missing)}")
        print(f"ok: runwisp {scenario} contract")
    require(
        re.search(r"closest[^.\n]*jobkit example", skill) is not None,
        "source of truth contract must select the closest current Jobkit example",
    )


def validate_repository_support() -> None:
    ignore = read(".gitignore").splitlines()
    require("repomix-output.xml" in ignore, "repomix-output.xml must be ignored")

    readme = read("README.md")
    require(
        "Claude Code" in readme and "Codex" in readme,
        "README must document both harnesses",
    )
    require("npx skills add" in readme, "README must document skills CLI installation")
    require(
        "runwisp-job-authoring" in readme,
        "README must document the runwisp-job-authoring skill",
    )

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
        "cp -R skills/runwisp-job-authoring/. dist/staging/runwisp-job-authoring/"
        in workflow,
        "release workflow must package runwisp-job-authoring independently",
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
        validate_runwisp_job_authoring_contract,
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
