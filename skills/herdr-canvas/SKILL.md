---
name: herdr-canvas
description: Use when the user explicitly says "canvas on", asks to use herdr-canvas, or requests a live Herdr canvas. Explicit opt-in only; never activate automatically from task size or complexity.
---

# Herdr Canvas

Maintain one live Herdr terminal canvas from the main agent's MCP connection.
Open it early, report only observed work, and leave a useful final view.

## Activation

- Activate only when the user explicitly says `canvas on`, asks to use
  `herdr-canvas`, or requests a live Herdr canvas.
- Do not infer activation from task size, complexity, planning, investigation,
  implementation, verification, or MCP availability.
- Treat activation as scoped to the current task unless the user explicitly
  asks to keep the canvas on.
- Treat `canvas off`, `no canvas`, and `stop canvas updates` as explicit
  deactivation. Close the owned canvas when `canvas off` explicitly requests
  that behavior.
- If the MCP is missing, denied, or reports `sandbox_unavailable`, explain once
  and continue the underlying task in chat.

## Workflow

1. Open `architecture` for planning, `debug` for investigation, or `delivery`
   for implementation and verification.
2. Read the matching layout in [`layouts/`](./layouts/) and
   [`references/state.md`](./references/state.md).
3. **For every explicitly activated task, initialize the complete
   `data.canvas` dataset and then call `canvas.set_layout` with the full matching
   packaged layout before substantive work.** Skip the packaged layout only
   when that resource cannot be read; use the documented fallback instead.
4. Replace `data.canvas` after meaningful findings, decisions, command results,
   phase changes, and completion by calling `canvas.set_data` with key
   `canvas`. Never pass `data.canvas` as the key. Keep stable IDs and at most eight events.
5. Publish a real running activity before a long operation and actual evidence
   after it. Do not invent percentages, timers, telemetry, or hidden reasoning.
6. Before publishing the first chart and before completion, apply the
   [chart-correctness gate](./references/charts.md): identify the measure,
   category labels, units, population or denominator, and scale; keep labels
   separate from values; inspect the actual rendered output; and use the
   [tested labelled fallback](./layouts/labelled-bars.mdx) if a native chart
   loses meaning. Check every distinct chart form and long or exceptional data.
7. Ask supported 2-12 option choices with `canvas.request_input` and wait for
   the returned value. Ask free-text questions in chat and record only the
   actual answer.
8. Finish with results, evidence, unresolved items, and a truthful state, then
   call `canvas.complete`. Call `canvas.close` only when the user requests it.

## Tool Semantics

- `canvas.open` reuses the owned session; it does not switch an active layout.
- `canvas.set_data` replaces the complete named dataset and preserves layout
  and React state. Use key `canvas` for the dataset that MDX reads as
  `data.canvas`; include every field that must remain.
- `canvas.set_layout` replaces the document after a valid first render and
  resets document state. Applying the matching packaged layout after the
  initial open is required and is the task's one expected initial replacement.
  Replace it again only for a later material presentation change.
- `canvas.patch` is a shallow prop merge; nested values are replaced.
- A cancelled, timed-out, or disconnected decision is not an answer.
- Do not repeatedly reopen a manually closed pane.

## Layout Selection

- [`layouts/planning.mdx`](./layouts/planning.mdx): steps, options, findings,
  and unresolved decisions.
- [`layouts/delivery.mdx`](./layouts/delivery.mdx): steps, changes, checks, and
  evidence.
- [`layouts/debug.mdx`](./layouts/debug.mdx): symptoms, hypotheses,
  experiments, and results.
- [`layouts/labelled-bars.mdx`](./layouts/labelled-bars.mdx): validated
  labelled bars for finite nonnegative values and labelled tables for signed
  or unsupported bar cases. Read [`references/charts.md`](./references/charts.md)
  before use.

Use `canvas.catalog` only when the tested layouts do not cover the presentation.
The canvas receives concise reported progress, not the whole conversation.

## Gotchas

- **Never send partial `data.canvas` objects.** Dataset replacement would erase
  omitted state.
- **Retain chart metadata on every update.** Units, population or denominator,
  scale semantics, labels, precision, and display choice must not disappear
  after the first render.
- **Never use document buttons for approval.** Only trusted
  `canvas.request_input` controls return an authenticated choice.
- **Never weaken worker isolation for convenience.** Missing canvas access must
  not cause an unsandboxed fallback.
- **Do not promise persistence after the host exits.** `canvas.complete` keeps
  the view visible only while the broker remains connected.
