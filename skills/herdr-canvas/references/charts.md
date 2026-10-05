# Chart correctness

Use this gate before publishing the first chart and again before completing a
chart-heavy canvas. A successful MCP response or valid MDX parse does not prove
that the terminal chart is semantically correct.

## Required metadata

For each chart, identify:

- the measure;
- every category label;
- units;
- the population for counts;
- the denominator for proportions;
- explicit scale semantics;
- the meaning of zero and each missing-data state.

Keep labels and numeric values in separate fields. Titles, years, identifiers,
numeric model names, and interval boundaries are labels or metadata unless the
source explicitly defines them as observations. Row numbers are not category labels unless they are the real domain values.

Counts need a defined population. Proportions need a denominator. Measured
quantities need units. Preserve source distinctions among zero, blank, unknown,
unresearched, and not applicable. Do not assume that zero means missing in a
different dataset.

## Scale and value rules

- Bar charts normally start at zero.
- Proportion percentages use `0` to `100%`; proportions use `0` to `1`.
- Percentage changes can be negative or exceed `100%`. Do not clamp them to a
  proportion scale.
- Signed values need a signed display or an explicit labelled table. Never
  turn them into positive magnitudes without explanation.
- Preserve useful precision. Do not round a meaningful nonzero value to an
  unexplained zero.
- Keep source order and duplicate-valued observations.
- Do not silently omit categories. Show all categories, or label a top-N
  selection and account for the omitted population.
- Preserve labels, values, and units at narrow widths. Wrap or change the
  layout instead of silently clipping.
- Color must not be the only category or state indicator.

## Tested labelled fallback

Use [`../layouts/labelled-bars.mdx`](../layouts/labelled-bars.mdx) when a native
chart loses labels, treats metadata as observations, hides signs, or truncates
categories. The layout reads a complete `chart` dataset:

```json
{
  "title": "Coverage by model year",
  "unit": "%",
  "population": "All records with a model year",
  "denominator": "299,705 export rows",
  "scale": {
    "kind": "proportion-percent",
    "min": 0,
    "max": 100,
    "label": "0 to 100%"
  },
  "display": {
    "kind": "bars",
    "barWidth": 20,
    "precision": 5
  },
  "data": [
    { "label": "2018", "value": 99.9897 },
    { "label": "2024", "value": 0.29118 }
  ]
}
```

Pass key `chart` to `canvas.set_data`; the layout reads it as `data.chart`.
`display.barWidth` and `display.precision` are explicit presentation choices,
not title-derived rules. Select them for the data and verify them at the real
terminal width.

Finite nonnegative values can use `display.kind: "bars"`. Use
`display.kind: "table"` for signed values or cases where bar semantics are not
appropriate. A row with no numeric value must include a non-empty `state`, for
example:

```json
{ "label": "Blank", "value": null, "state": "blank in source" }
```

The fallback rejects missing labels, non-finite or nonnumeric values, unlabelled
nulls, invalid scales, and signed bar values. It does not silently coerce them.
The regression data is in
[`../fixtures/chart-correctness.json`](../fixtures/chart-correctness.json).

## Rendered verification

Check the first chart before repeating its pattern. Before completion, inspect
every distinct chart form plus long labels, small values, signed values, and
large category sets.

When running inside Herdr:

```sh
herdr pane list
herdr pane read <owned-canvas-pane-id> --source visible --lines 68
```

Discover the current owned canvas pane. Do not reuse a pane ID from another
session. Match the current tab or workspace and the canvas renderer identity;
do not read unrelated agents' panes. Use supported pane scrolling or the real
renderer test interface for content below the viewport.

Compare rendered labels, values, units, row counts, order, denominator, and
scale with the source. A source-code review, MDX compilation, exported SVG, or
successful `canvas.set_layout` response is not a visual acceptance check. If
the pane cannot be inspected, use the safest labelled representation and state
that rendered verification was unavailable.

## Version-scoped compatibility notes

Observed in Herdr Canvas `0.1.0`:

- Native `GraphBars` terminal formatting scans numbers from all props and child
  text. The numbered-title fixture treats the title's `1` as an observation,
  drops category names, and renders only ordinal row labels.
- Numeric years, model names, and interval labels can enter the same parsing
  path.
- Native chart formatting uses absolute values and displays only its first 24
  extracted numbers.

These are compatibility notes, not a permanent ban. A corrected native
renderer can be used after the same fixture and live-pane checks pass.

Locale API support is runtime-dependent and failed in an earlier tested
sandbox. Use deterministic string-based grouping in portable layouts instead
of depending on `Number.toLocaleString` or `Intl`. Do not bypass isolation to
obtain locale formatting.

The underlying renderer still needs a separate fix to consume designated
numeric values, preserve labels, handle signs explicitly, and report category
limits. Do not expand skill maintenance into that renderer change.
