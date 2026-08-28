# Agent Plugins packaging

**Decision:** Defer  
**Decided:** 2026-08-28  
**Revisit:** When distribution needs or client support change

## Context

This repository can be packaged as an Agent Plugins 1.0 plugin, allowing users
to install all owned skills as one managed package. The existing
`npx skills add` flow already supports selecting and installing individual
skills.

## Current decision

Do not publish Agent Plugins packaging for this repository now. Continue to
support individual skill installation through `npx skills add`.

## Reasons

- Plugin packaging changes installation and package management, not skill
  behavior.
- Current users can already select only the skills they need.
- Copilot warns that direct repository plugin installs will later require a
  marketplace.
- Codex already requires a marketplace.
- The manifest has negligible runtime cost, but client testing and marketplace
  maintenance do not yet have clear user value.

## Reevaluate when

- Users need one-command installation of the complete skill set.
- Plugin marketplaces become the normal distribution path.
- Copilot and Codex have a stable shared installation flow.
- A public plugin identity provides clear discovery or release value.
