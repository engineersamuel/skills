# Canvas state

The tested layouts read one complete JSON dataset from `data.canvas`.
Create or replace it with `canvas.set_data` key `canvas`. The `data.` prefix is
how MDX reads datasets; it is not part of the tool key.

## Shared fields

```json
{
  "title": "Implement retry recovery",
  "phase": "working",
  "activity": "Running the focused recovery tests",
  "steps": [
    { "id": "policy", "label": "Define retry policy", "status": "passed" },
    { "id": "tests", "label": "Verify restart recovery", "status": "running" }
  ],
  "findings": ["Recovery resumes from the persisted attempt count."],
  "checks": [
    { "name": "Focused tests", "status": "running", "evidence": "bun test test/retry.test.ts" }
  ],
  "events": [
    { "summary": "Defined the retry state machine." },
    { "summary": "Started the focused recovery tests.", "at": "12:10" }
  ],
  "decisions": [
    { "question": "Use capped exponential backoff?", "answer": "Yes" }
  ]
}
```

`phase` is `planning`, `working`, `waiting`, `complete`, or `blocked`. Step
statuses are `pending`, `running`, `passed`, `failed`, or `blocked`.

Planning can add:

```json
{
  "options": [
    { "label": "Persist attempts", "tradeoff": "Reliable restart recovery with one durable write per attempt." }
  ]
}
```

Delivery can add:

```json
{
  "changes": [
    { "path": "src/retry.ts", "summary": "Resume retry state after restart." }
  ]
}
```

Debugging can add:

```json
{
  "hypotheses": [
    { "label": "The attempt count is reset on restart", "status": "supported", "evidence": "The failing fixture reloads zero." }
  ]
}
```

Hypothesis statuses are `untested`, `supported`, or `ruled_out`. Missing
collections default to empty.

## Complete replacement

Every `canvas.set_data` call replaces all of `data.canvas`. Preserve prior
fields explicitly:

```json
{
  "key": "canvas",
  "value": {
    "title": "Implement retry recovery",
    "phase": "complete",
    "activity": "Recovery behavior is verified",
    "steps": [
      { "id": "policy", "label": "Define retry policy", "status": "passed" },
      { "id": "tests", "label": "Verify restart recovery", "status": "passed" }
    ],
    "findings": [
      "Recovery resumes from the persisted attempt count.",
      "Cancellation remains terminal after restart."
    ],
    "checks": [
      { "name": "Focused tests", "status": "passed", "evidence": "8 passed" }
    ],
    "events": [
      { "summary": "Defined the retry state machine." },
      { "summary": "Verified restart recovery." }
    ],
    "decisions": [
      { "question": "Use capped exponential backoff?", "answer": "Yes" }
    ],
    "changes": [
      { "path": "src/retry.ts", "summary": "Resume retry state after restart." }
    ]
  }
}
```

Keep only the eight newest events. Keep stable step IDs. Do not fabricate an
observed timestamp.

For charts, keep the complete measure definition on every replacement:
category labels, values, units, population or denominator, scale semantics,
precision, and display choice. Read [`charts.md`](./charts.md) before publishing
chart-heavy data.

## Fallback

If a layout resource cannot be read, open the closest built-in template and use
stable slot IDs with `canvas.upsert`. Read `canvas.catalog` before choosing
components. Keep the fallback small: one summary, current activity, steps, and
checks. Continue the task in chat if the MCP or sandbox is unavailable.
