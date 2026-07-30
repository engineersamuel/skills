---
description: Conventions for portable Agent Skill definitions and metadata
applyTo: "skills/**"
---

# Skill authoring

- Keep `SKILL.md` as the canonical, portable skill definition.
- Start every skill with valid YAML frontmatter containing `name` and `description`.
- Make the description state when an agent should load the skill.
- Keep harness-specific adapters thin and colocated within the skill directory.
- Update `scripts/validate.py` when the intended discovery or packaging contract changes.
- Run `python3 scripts/validate.py` after modifying a skill.
