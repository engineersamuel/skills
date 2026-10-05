# Terminal compatibility

The public catalog is pinned to mdxcn revision
`9c5c7343ded45587dacda75201f4b56f026787a4`. All 47 public names, composition
helpers, `Footnotes`, `Canvas.Slot`, and the safe MDX host elements are accepted
by the worker and trusted tree schema.

Native terminal adapters cover content, diagram, data, chart, and time
families. They provide Graph framing, Markdown headings and lists, quotes,
code, links, GFM tables and task inputs, footnotes, structured helper nodes,
Unicode display-cell width, narrow-pane wrapping, and bounded chart work.
Function-valued formatters and render props execute in the worker; only their
rendered values cross the boundary.

Keyboard behavior:

- `j`, `k`, arrows, Page Up, and Page Down scroll.
- Tab moves through document controls and Enter activates the focused callback.
- Enter expands or collapses focused `details` content.
- `p` pauses or resumes visual tree updates.
- Decision cards use left/right arrows and Enter and remain outside MDX-owned
  content.

Terminal adaptations are intentional: CSS classes and DOM refs are ignored;
hover-only content is shown inline or through focus/expansion; pixel geometry
becomes display-cell layout; links never open automatically. Dataset updates
retain React state in a healthy worker, while document replacement starts a new
generation and resets state.

The adapters preserve the pinned component names, common semantic props,
Markdown forms, and helper composition, but they are not a pixel-equivalent
port of the browser implementation. Some highly component-specific browser
geometry and decorative animation is represented by family-level terminal
layouts. `canvas.catalog` exposes the supported props schema, example, and
compatibility notes for every entry so an agent can choose a terminal form.

The trusted renderer follows [the canvas visual direction](../DESIGN.md):
ENERGY 2 / RHYTHM 2 / MOTION 1. Its fixed operational header, document
viewport, trusted decision card, and keyboard footer prioritize hierarchy,
focus visibility, and compact use of the right-hand pane.
