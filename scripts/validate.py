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
        "audit-ro": "Audit RO",
        "clean-tests": "Clean Tests",
        "finish": "Finish",
        "goal-me": "Goal Me",
        "herdr-canvas": "Herdr Canvas",
        "justify": "Justify",
        "runwisp-job-authoring": "RunWisp Job Authoring",
        "trellage-guide": "Trellage Guide",
        "ui-guidelines": "UI Guidelines",
    }
    for name, display_name in skills.items():
        skill = read(f"skills/{name}/SKILL.md")
        fields = parse_frontmatter(skill)
        allowed = {"name", "description"}
        if "disable-model-invocation" in fields:
            require(
                fields["disable-model-invocation"] == "true",
                f"{name} disable-model-invocation must be true",
            )
            allowed = allowed | {"disable-model-invocation"}
        require(
            set(fields) == allowed,
            f"{name} frontmatter keys must be name, description, "
            "and optional disable-model-invocation",
        )
        if name in {"audit-ro", "finish", "goal-me"}:
            require(
                fields.get("disable-model-invocation") == "true",
                f"{name} must disable model invocation",
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
            "skills/audit-ro/SKILL.md",
            "skills/clean-tests/SKILL.md",
            "skills/finish/SKILL.md",
            "skills/goal-me/SKILL.md",
            "skills/grilling-frontend-prototyping/SKILL.md",
            "skills/herdr-canvas/SKILL.md",
            "skills/justify/SKILL.md",
            "skills/runwisp-job-authoring/SKILL.md",
            "skills/trellage-guide/SKILL.md",
            "skills/ui-guidelines/SKILL.md",
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
            "repository containing the job package",
            "current jobkit",
            "local jobkit checkout",
            "github.com/engineersamuel/runwisp-jobkit",
            "installed skill",
            "repository-instruction discovery",
            "multiple `job.toml`",
            "ask which one",
            "from that path",
            "runtime jobkit version",
            "default branch",
            "state that assumption",
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
            "target package",
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
            "cannot locate",
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


def validate_goal_me_contract() -> None:
    skill = read("skills/goal-me/SKILL.md")
    prompts = re.findall(r"^```(?:text)?\n(.*?)^```$", skill, flags=re.M | re.S)
    require(len(prompts) == 1, "goal-me must embed one complete Goal Prompt")
    prompt = prompts[0]
    authoring = skill.split("```", 1)[0].lower()
    for concept in (
        "grill-me",
        "shared understanding",
        "at least three",
        "current working directory",
        "four lowercase hex",
        "written path",
        "do not execute the loop",
    ):
        require(concept in authoring, f"goal-me authoring contract missing: {concept}")

    # Validate the handoff schema, not a snapshot of the surrounding prose.
    sections = re.findall(r"^([A-Z][A-Z ]+):$", prompt, flags=re.M)
    require(
        sections
        == [
            "TASK",
            "INPUTS AND ARTIFACTS",
            "CONSTRAINTS",
            "SUCCESS CRITERIA",
            "REQUIRED CHECKS",
            "ACTION CATALOG",
            "EXECUTION LIMITS",
            "SCOREBOARD",
            "RECENT ATTEMPTS",
            "LEARNINGS",
            "LOOP PROTOCOL",
            "RULES",
        ],
        f"goal-me embedded prompt sections differ: {sections}",
    )
    steps = re.findall(r"^\d+\. ([A-Z]+(?: OR [A-Z]+)?)\b", prompt, flags=re.M)
    require(
        steps
        == [
            "READ",
            "MEASURE",
            "CHOOSE",
            "ACT",
            "VERIFY",
            "RETAIN OR RECOVER",
            "RECORD",
            "DECIDE",
        ],
        f"goal-me loop order differs: {steps}",
    )
    limits = prompt.split("EXECUTION LIMITS:\n", 1)[1].split("\nSCOREBOARD:", 1)[0]
    for field, value in (
        ("Max iterations", 20),
        ("Max consecutive no-progress attempts", 5),
    ):
        require(
            re.search(rf"^{field}: {value}$", limits, flags=re.M) is not None,
            f"goal-me default {field} must be {value}",
        )
    scoreboard = prompt.split("SCOREBOARD:\n", 1)[1].split("\nRECENT ATTEMPTS:", 1)[0]
    for field, value in (
        ("Status", "ITERATING"),
        ("Iterations", "0"),
        ("Consecutive no-progress attempts", "0"),
        ("Pending attempt", "none"),
        ("Weakest", "_"),
        ("Next action", "_"),
        ("Stop reason", "_"),
    ):
        require(f"{field}: {value}" in scoreboard, f"goal-me must initialize {field}")
    rows = [line for line in scoreboard.splitlines() if re.match(r"\| C\d+ ", line)]
    require(len(rows) >= 3, "goal-me scoreboard needs at least three criteria")
    require(
        all(re.fullmatch(r"\| C\d+ \| _ \| _ \| _ \|", row) for row in rows),
        "goal-me baseline/current scores and evidence must start uninitialized",
    )
    for column in ("Baseline", "Current", "Evidence"):
        require(column in scoreboard, f"goal-me scoreboard missing {column}")
    for column in ("Target", "Verification", "8/10", "10/10", "Expected benefit"):
        require(column in prompt, f"goal-me measurement/action schema missing {column}")
    decide = prompt.split("8. DECIDE", 1)[1].split("\nRULES:", 1)[0].lower()
    for concept in (
        "final",
        "8/10",
        "every required check",
        "pass",
        "stopped",
        "iterating",
    ):
        require(concept in decide, f"goal-me decision contract missing: {concept}")
    for pattern, message in (
        (r"five most recent attempts", "bounded attempt history"),
        (r"at most 8", "bounded learnings"),
        (r"same calibrated checks", "comparable measurements"),
        (r"preserve.*counters", "resumption counters"),
        (r"pre-existing work", "safe recovery"),
        (r"external blocker", "blocker stop"),
        (r"required.check.*regression", "required-check regression gate"),
        (r"unverified", "missing evidence"),
        (r"do not create a second progress file", "single-file memory"),
    ):
        require(
            re.search(pattern, prompt, flags=re.I) is not None,
            f"goal-me embedded prompt missing {message}",
        )
    readme = read("README.md")
    require(
        "https://github.com/jmilinovich/goal-md" in readme,
        "goal-me README must credit goal-md",
    )
    print("ok: goal-me authoring and embedded prompt contract")


def validate_herdr_canvas_contract() -> None:
    skill = read("skills/herdr-canvas/SKILL.md").lower()
    activation = read(
        "skills/herdr-canvas/integrations/copilot/activation.md"
    ).lower()
    scenarios = {
        "activation": (
            "activate only",
            "canvas on",
            "do not infer activation",
            "task size",
            "current task",
            "canvas off",
            "no canvas",
        ),
        "rich layout": (
            "for every explicitly activated task",
            "canvas.set_layout",
            "packaged layout before substantive work",
            "before substantive work",
            "documented fallback",
        ),
        "state": (
            "canvas.set_data",
            "replaces the complete named dataset",
            "include every field",
            "at most eight events",
            "stable ids",
        ),
        "decisions": (
            "2-12 option",
            "wait for",
            "free-text questions in chat",
            "not an answer",
        ),
        "lifecycle": (
            "canvas.complete",
            "canvas.close",
            "manually closed pane",
            "sandbox_unavailable",
            "continue the underlying task in chat",
        ),
        "isolation": (
            "never weaken worker isolation",
            "unsandboxed fallback",
            "do not promise persistence after the host exits",
        ),
        "chart correctness": (
            "chart-correctness gate",
            "measure",
            "category labels",
            "units",
            "population or denominator",
            "actual rendered output",
            "tested labelled fallback",
            "every distinct chart form",
            "retain chart metadata",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(
            not missing,
            f"herdr-canvas {scenario} contract missing: {', '.join(missing)}",
        )
        print(f"ok: herdr-canvas {scenario} contract")
    for forbidden in (
        "activate for multi-step planning",
        "eligible for automatic activation",
    ):
        require(
            forbidden not in skill,
            f"herdr-canvas must remain opt-in only: {forbidden}",
        )
    for required in (
        "canvas on",
        "never open a canvas because",
        "scope activation to the current task",
    ):
        require(
            required in activation,
            f"herdr-canvas Copilot opt-in contract missing: {required}",
        )
    charts = read("skills/herdr-canvas/references/charts.md").lower()
    for required in (
        "row numbers are not category labels",
        "proportion percentages use `0` to `100%`",
        "percentage changes can be negative or exceed `100%`",
        "do not silently omit categories",
        "number.tolocalestring",
        "herdr pane read",
        "successful `canvas.set_layout` response is not a visual acceptance check",
    ):
        require(
            required in charts,
            f"herdr-canvas chart reference missing: {required}",
        )
    for resource in (
        "skills/herdr-canvas/layouts/labelled-bars.mdx",
        "skills/herdr-canvas/fixtures/chart-correctness.json",
    ):
        require(Path(resource).is_file(), f"herdr-canvas chart resource missing: {resource}")
    print("ok: herdr-canvas chart resources contract")
    print("ok: herdr-canvas opt-in contract")


def validate_trellage_guide_contract() -> None:
    skill = read("skills/trellage-guide/SKILL.md").lower()
    scenarios = {
        "cli ownership": (
            "installed `trx guide` service",
            "do not duplicate",
            "trx guide --help",
            "schemaversion 1",
            "do not approximate",
        ),
        "matching": (
            "trx guide --json",
            "stdin",
            "exactly three",
            "distinct `profileref`",
            "wait for the user to select",
        ),
        "generation": (
            "selected `profileref`",
            "exactly three candidates",
            "command.preview",
            "command shape to match the selected profile",
            "base arguments",
            "prompt improver",
        ),
        "execution safety": (
            "explicit confirmation",
            "argument vector",
            "never execute `command.preview`",
            "manual-paste",
            "restart interactive matching",
        ),
        "failure": (
            "fail",
            "do not repair or guess",
            "literal/template fallbacks",
            "do not force, delete, or guess resources",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(
            not missing,
            f"trellage-guide {scenario} contract missing: {', '.join(missing)}",
        )
        print(f"ok: trellage-guide {scenario} contract")


def validate_finish_contract() -> None:
    skill = read("skills/finish/SKILL.md").lower()
    required_phrases = (
        "explicitly invokes",
        "disable-model-invocation: true",
        "git status --short --untracked-files=all",
        "commit all current worktree changes",
        "might belong in `.gitignore`",
        "stop and ask the user",
        "never commit it",
        "git add -a",
        "no unstaged or untracked changes remain",
        "git pull --rebase origin main",
        "resolve every conflict",
        "git push --force-with-lease",
        "gh pr create",
        "gh pr merge --auto --squash",
        "until github reports `merged`",
        "requires user action",
    )
    missing = [phrase for phrase in required_phrases if phrase not in skill]
    require(not missing, f"finish contract missing: {', '.join(missing)}")
    print("ok: finish behavior contract")


def validate_audit_ro_contract() -> None:
    skill = read("skills/audit-ro/SKILL.md").lower()
    scenarios = {
        "read only": (
            "audit-only",
            "do not edit repository files",
            "do not run tests",
            "outside the repository",
            "repository remains unchanged",
        ),
        "baseline": (
            "before substantive inspection or delegation",
            "initial repository-state",
            "content fingerprints for untracked files",
            "version control",
            "repeat the same snapshot procedure",
            "status command by itself",
            "unchanged-repository",
        ),
        "coverage": (
            "coverage contract",
            "stable id",
            "exact, non-overlapping ownership boundary",
            "public interfaces",
            "major call sites",
            "explicit skip decisions",
            "broad catch-all rows",
        ),
        "bounded reviews": (
            "bounded subsystem reviews",
            "at most two",
            "one consolidated wait mechanism",
            "do not interrupt a productive worker",
            "return `skip`",
        ),
        "finding schema": (
            "exact file and line references",
            "current complexity or invalid states",
            "smallest credible implementation scope",
            "regression risks and migration concerns",
            "existing and additional validation required",
            "confidence",
        ),
        "independent validation": (
            "independently verify every worker finding",
            "reject, narrow, or demote",
            "superseded",
            "one authoritative subsystem",
        ),
        "audit the audit": (
            "repository coverage and missing subsystem boundaries",
            "duplication and ownership overlap",
            "materiality and over-abstraction",
            "schema completeness",
            "dependency-aware priority ranking",
            "best first implementation slices",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(
            not missing,
            f"audit-ro {scenario} contract missing: {', '.join(missing)}",
        )
        print(f"ok: audit-ro {scenario} contract")

    worker_brief = skill.split("give every worker this brief:", maxsplit=1)[1].split(
        "if read-only workers are unavailable", maxsplit=1
    )[0]
    worker_restrictions = (
        "this is read-only",
        "do not edit files",
        "run tests",
        "commit",
        "push",
        "inspection-only commands",
        "external to the repository",
    )
    missing = [phrase for phrase in worker_restrictions if phrase not in worker_brief]
    require(
        not missing,
        f"audit-ro worker brief restrictions missing: {', '.join(missing)}",
    )
    print("ok: audit-ro worker read-only contract")


def validate_clean_tests_contract() -> None:
    skill = read("skills/clean-tests/SKILL.md").lower()
    scenarios = {
        "inspection": (
            "inspect before deleting",
            "inventory the tests in scope",
            "production code",
            "name the exact repository-owned contract",
        ),
        "retention bar": (
            "test contracts, not feature presence",
            "meaningful regression",
            "compiler, type checker, schema checker, or lint rule",
            "do not optimize for test count or coverage percentage",
        ),
        "external providers": (
            "do not simulate an external provider",
            "external provider's raw api shape",
            "for adapters such as discord",
            "official sdk types or builders",
            "do not invent a fake provider contract",
            "provider compatibility as unverified",
        ),
        "ui and registration": (
            "remove ui and ux tests heavily",
            "element presence",
            "slash command",
            "handler registers",
            "critical user interactions",
        ),
        "cleanup and verification": (
            "do not replace a deleted test",
            "do not delete production behavior",
            "orphaned fixtures",
            "type-check, lint, build, and test command",
            "exact validation commands and outcomes",
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in skill]
        require(
            not missing,
            f"clean-tests {scenario} contract missing: {', '.join(missing)}",
        )
        print(f"ok: clean-tests {scenario} contract")

    credit = read("skills/clean-tests/README.md")
    source_url = "https://x.com/howaboua/status/2088998833954972031?s=51"
    require(source_url in credit, "clean-tests README must credit the source post")
    require(
        "credit" in credit.lower(),
        "clean-tests README must label the source attribution",
    )
    print("ok: clean-tests source credit")


def validate_ui_guidelines_contract() -> None:
    skill = read("skills/ui-guidelines/SKILL.md")
    fields = parse_frontmatter(skill)
    description = fields["description"].lower()
    for trigger in ("user interface", "frontend", "html", "css"):
        require(
            trigger in description,
            f"ui-guidelines description must include {trigger}",
        )
    require(
        "disable-model-invocation" not in fields,
        "ui-guidelines must allow automatic model invocation",
    )

    normalized = skill.lower()
    scenarios = {
        "interface": (
            "concentric border radius",
            "optical alignment",
            "outline-offset: -1px",
            "8% opacity",
        ),
        "motion": (
            "transition: all",
            "0.95",
            "0.98",
            "200ms ease-out",
            "0.25",
            "4px",
            "css transitions",
            "keyframes",
            "switching between light and dark themes",
            "will-change",
            "safari on ios",
            "stagger",
            "high-frequency interactions",
        ),
        "typography": (
            ".woff2",
            "tabular-nums",
            "60-75 characters",
            "text-wrap: balance",
            "text-wrap: pretty",
            "overflow-wrap: break-word",
            "white-space: nowrap",
            "-webkit-font-smoothing",
            "-moz-osx-font-smoothing",
            "text-transform",
            "smart punctuation",
            "text-underline-position: from-font",
            "text-decoration-skip-ink: auto",
            "truncated text",
        ),
        "color": (
            "every palette step",
            "semantic tokens",
            "primitive tokens",
            "--color-accent-solid",
            "brand color",
            "another role",
            "background on which the element",
            "not the light palette reversed",
            "prefers-color-scheme",
            ".dark",
            "in oklab",
            "in oklch",
        ),
        "accessibility": (
            "semantically correct native elements",
            ":focus-visible",
            "outline: none",
            'tabindex="0"',
            'tabindex="-1"',
            "icon-only buttons",
            "aria-label",
            'aria-hidden="true"',
            "decorative images",
            "real `<label>`",
            "`inputmode`",
            "never block paste",
            "disabled control",
            'aria-disabled="true"',
            "keep submit controls enabled",
            'aria-invalid="true"',
            "aria-describedby",
            "first invalid field",
            "24x24px",
            "44x44px",
            "40x40px",
            "pointer-events: none",
            "@media (hover: hover)",
            "prefers-reduced-motion: no-preference",
            'role="status"',
            'role="alert"',
            "color alone",
            "skip-to-content",
            "scroll-margin-top",
        ),
        "layout": (
            "at least twice",
            "8px",
            "16px",
            "logical properties",
            "margin-inline-start",
            "padding-inline-end",
            "fixed widths or heights",
        ),
        "writing": (
            "start button labels with a verb",
            "repeat the consequence",
            "continue",
            "next",
            "describe the destination",
            "click here",
            "sentence case",
            "state they turn on",
            "empty states",
            'address the reader as "you"',
        ),
    }
    for scenario, required_phrases in scenarios.items():
        missing = [phrase for phrase in required_phrases if phrase not in normalized]
        require(
            not missing,
            f"ui-guidelines {scenario} contract missing: {', '.join(missing)}",
        )
        print(f"ok: ui-guidelines {scenario} contract")

    credit = read("skills/ui-guidelines/README.md")
    source_url = "https://interfaces.dev/cheat-sheet"
    require(source_url in credit, "ui-guidelines README must credit the source")
    require(
        "credit" in credit.lower(),
        "ui-guidelines README must label the source attribution",
    )
    print("ok: ui-guidelines source credit")


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
    require("goal-me" in readme, "README must document the goal-me skill")
    require("`herdr-canvas`" in readme, "README must document herdr-canvas")
    require("`finish`" in readme, "README must document the finish skill")
    require("`audit-ro`" in readme, "README must document the audit-ro skill")
    require("`clean-tests`" in readme, "README must document the clean-tests skill")
    require(
        "`trellage-guide`" in readme,
        "README must document the trellage-guide skill",
    )
    require(
        "`ui-guidelines`" in readme,
        "README must document the ui-guidelines skill",
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
        "cp -R skills/goal-me/. dist/staging/goal-me/" in workflow,
        "release workflow must package skills/goal-me as goal-me",
    )
    require(
        "cp -R skills/herdr-canvas/. dist/staging/herdr-canvas/" in workflow,
        "release workflow must package herdr-canvas independently",
    )
    require(
        "herdr-canvas-integration" in workflow,
        "release workflow must package the canvas application with its skill",
    )
    require(
        "README.md LICENSE .mise.toml" in workflow,
        "release workflow must include the all-host mise task",
    )
    require(
        "bun run runtime:package" in workflow,
        "release workflow must prepare the isolated canvas runtime",
    )
    require(
        "bun scripts/probe-sandbox.ts" in workflow
        and '"status":"sandbox_ready"' in workflow,
        "release workflow must probe the prepared sandbox runtime",
    )
    require(
        "chmod -R u+w dist/staging" in workflow,
        "release workflow must make immutable runtime staging writable before cleanup",
    )
    require(
        "e1f84a33bdfecad82490285ea65058fdabe2028a" in workflow,
        "release workflow must build the reviewed Nono revision",
    )
    mise = read(".mise.toml")
    require(
        "[tasks.herdr-canvas]" in mise,
        "mise must expose one Herdr Canvas install and upgrade task",
    )
    require(
        "--hosts copilot,claude,codex,pi" in mise,
        "mise Herdr Canvas task must install every supported harness",
    )
    require(
        "bun run runtime:package" in mise
        and mise.index("bun run runtime:package") < mise.index("bun run verify"),
        "mise Herdr Canvas task must refresh the worker runtime before verification",
    )
    require(
        "cp -R skills/finish/. dist/staging/finish/" in workflow,
        "release workflow must package skills/finish as finish",
    )
    require(
        "cp -R skills/audit-ro/. dist/staging/audit-ro/" in workflow,
        "release workflow must package skills/audit-ro as audit-ro",
    )
    require(
        "cp -R skills/clean-tests/. dist/staging/clean-tests/" in workflow,
        "release workflow must package skills/clean-tests as clean-tests",
    )
    require(
        "cp LICENSE dist/staging/clean-tests/" in workflow,
        "clean-tests release package must include the repository license",
    )
    require(
        "cp README.md LICENSE dist/staging/clean-tests/" not in workflow,
        "release packaging must preserve the credited clean-tests README",
    )
    require(
        "cp -R skills/ui-guidelines/. dist/staging/ui-guidelines/" in workflow,
        "release workflow must package ui-guidelines independently",
    )
    require(
        "cp -R skills/trellage-guide/. dist/staging/trellage-guide/" in workflow,
        "release workflow must package trellage-guide independently",
    )
    require(
        "cp LICENSE dist/staging/ui-guidelines/" in workflow,
        "ui-guidelines release package must include the repository license",
    )
    require(
        "cp README.md LICENSE dist/staging/ui-guidelines/" not in workflow,
        "release packaging must preserve the credited ui-guidelines README",
    )
    for archive in ("tar.gz", "zip"):
        asset = f'clean-tests-"${{GITHUB_REF_NAME}}".{archive}'
        require(
            workflow.count(asset) >= 2,
            f"release workflow must checksum and publish the clean-tests {archive}",
        )
        asset = f'ui-guidelines-"${{GITHUB_REF_NAME}}".{archive}'
        require(
            workflow.count(asset) >= 2,
            f"release workflow must checksum and publish the ui-guidelines {archive}",
        )
        asset = f'trellage-guide-"${{GITHUB_REF_NAME}}".{archive}'
        require(
            workflow.count(asset) >= 2,
            f"release workflow must checksum and publish the trellage-guide {archive}",
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
        validate_goal_me_contract,
        validate_herdr_canvas_contract,
        validate_trellage_guide_contract,
        validate_finish_contract,
        validate_audit_ro_contract,
        validate_clean_tests_contract,
        validate_ui_guidelines_contract,
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
