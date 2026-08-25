---
name: ui-guidelines
description: Use when creating, editing, reviewing, or testing any user interface, frontend component, web page, HTML, or CSS; apply practical visual, motion, typography, color, accessibility, layout, and UI-writing guidelines.
---

# UI Guidelines

Apply these defaults to every UI surface in scope. Inspect the repository's
design system, tokens, component patterns, and accessibility requirements
first. Preserve stronger project requirements and explicit product decisions.
Do not apply a visual rule when it would reduce correctness, usability, or
accessibility.

## Workflow

1. Identify the components, states, breakpoints, themes, and interactions in
   scope.
2. Reuse existing semantic tokens and component primitives before adding new
   ones.
3. Apply the relevant rules below as one coherent change, not as unrelated
   cosmetic patches.
4. Verify keyboard use, focus, contrast, motion preferences, responsive text,
   touch targets, and state communication before finishing.

## Interface

- Use concentric border radius on nested elements. Account for the inset or
  padding so the inner and outer curves share a visual center.
- Align for optical alignment, not only geometric alignment. Correct icons,
  text, and asymmetric shapes when mathematical centering looks wrong.
- Give images a `1px` outline with `outline-offset: -1px`. Use black at 8%
  opacity in light mode and white at 8% opacity in dark mode.

## Motion

- Never use `transition: all`; name only the properties that change.
- For pressed buttons, scale to a value from `0.95` through `0.98` with
  `transition: scale 200ms ease-out`.
- Cross-fade swapping icons. The entering icon scales from `0.25` to `1`,
  changes opacity from `0` to `1`, and changes blur from `4px` to `0`. Reverse
  the same values for the exiting icon.
- Use CSS transitions for interactions because users can interrupt them. Use
  keyframes for one-time sequences.
- Disable all transitions while switching between light and dark themes.
- Use `will-change` only for a property that actually changes: `transform`,
  `opacity`, or `filter`.
- If an animated element shifts by 1-2 pixels, especially in Safari on iOS,
  add `will-change: transform` to that element.
- Stagger entrance animation by group or by individual element when the order
  improves comprehension.
- Do not animate high-frequency interactions such as list-item hover color.
- Put nonessential motion inside
  `@media (prefers-reduced-motion: no-preference)`.

## Typography

- Serve `.woff2` fonts on the web, never `.ttf` or `.otf`.
- Add `font-variant-numeric: tabular-nums` to every changing value and to
  tables, including timers, counters, prices, and data columns. Skip it for a
  monospace font.
- Limit long-form text to 60-75 characters per line.
- Use `text-wrap: balance` on headings and `text-wrap: pretty` on
  descriptions. Use neither on long-form text.
- Use `overflow-wrap: break-word` where long words, links, or identifiers can
  escape. Use `white-space: nowrap` on labels and badges.
- Set `-webkit-font-smoothing: antialiased` and
  `-moz-osx-font-smoothing: grayscale` once on the root, never per component.
- Store copy in natural case. Use `text-transform` only for presentation.
- Use smart punctuation: curly quotation marks, an en dash for ranges, an em
  dash for asides, and the single ellipsis character.
- Set `text-underline-position: from-font` and
  `text-decoration-skip-ink: auto` so underlines clear descenders.
- Keep the full value of truncated text available through an accessible
  tooltip or expanded view.

## Color and tokens

- Give every palette step a defined role, such as page background, component
  hover, border, solid fill, or body text. Remove unused steps.
- Components must consume semantic tokens such as
  `--color-text-secondary`, never primitive tokens such as `--blue-500`.
- Name tokens for durable roles, not appearance or first use. Prefer
  `--color-accent-solid` over `--color-blue-button` or
  `--color-sidebar-gray`.
- Reserve `accent` for the brand color. Do not let `primary` mean both the
  brand and main body text.
- Do not reuse a token from another role only because its current value
  matches. Add a token for the new role so future changes remain independent.
- Measure contrast against the background on which the element actually
  renders, not automatically against the page background.
- Design dark mode deliberately; it is not the light palette reversed.
- Choose one theme mechanism, either `prefers-color-scheme` or a `.dark`
  class, and use it for every token.
- Choose a gradient interpolation space deliberately: `in oklab` for even
  brightness, `in oklch` for more vivid middle tones, or default sRGB for a
  classic muted midpoint.

## Accessibility

- Use semantically correct native elements. Use `<button>` for actions and
  `<a>` for navigation; do not use a plain `<div>` when native HTML works.
- Style `:focus-visible`. Never use `outline: none` without a visible
  replacement.
- Use only `tabindex="0"` and `tabindex="-1"`. Positive values break natural
  tab order.
- Give icon-only buttons a descriptive `aria-label`. Never put
  `aria-hidden="true"` on a focusable element.
- Write alt text for purpose, not appearance. For example, use `alt="Search"`
  for a functional search image rather than `alt="magnifying glass"`.
  Decorative images use `alt=""`.
- Give every input a real `<label>`, an appropriate `type`, and an
  `inputmode`.
- Never block paste. Passwords and one-time codes must work with password
  managers, paste, and autofill.
- Do not depend on a tooltip attached to a disabled control; it cannot open
  reliably for keyboard or touch users. Put the explanation in visible text,
  or use `aria-disabled="true"` when the control must remain focusable.
- Keep submit controls enabled until the request starts. Validate on submit,
  set `aria-invalid="true"`, connect the error with `aria-describedby`, and
  focus the first invalid field.
- Provide at least a `24x24px` hit area. Prefer `44x44px` on touch and
  `40x40px` on desktop. Extended hit areas must not overlap.
- Set `pointer-events: none` on decorative glows, gradients, and similar
  layers so they cannot intercept control input.
- Put hover-only styling inside `@media (hover: hover)` so touch does not keep
  a sticky hover state after a tap.
- Put motion inside `@media (prefers-reduced-motion: no-preference)` so it
  plays only when the user has not requested reduced motion.
- Use `role="status"` for routine updates. Reserve `role="alert"` for urgent
  errors.
- Never communicate a status by color alone. Add an icon, label, underline, or
  another non-color cue.
- Make the skip-to-content link the first focusable element. Add
  `scroll-margin-top` to anchored headings so fixed UI does not obscure them.

## Layout

- Make the gap between groups at least twice the gap inside a group, such as
  `8px` within and `16px` or more between groups.
- Use logical properties such as `margin-inline-start` and
  `padding-inline-end` instead of physical left and right properties.
- Do not set fixed widths or heights on text containers.

## UI writing

- Start button labels with a verb, such as "Save draft" or "Delete project".
  Do not use "OK!" or a bare "Yes".
- Repeat the consequence in confirmation actions. Pair "Delete project" with
  "Cancel".
- Pick one word for each flow and keep it through every step. Do not alternate
  between "Continue" and "Next".
- Describe the destination in link text, such as "Read docs". Do not use
  "Click here".
- Capitalize buttons, headings, and labels consistently. Prefer sentence case
  unless the product has another established convention.
- Label toggles with the state they turn on, such as "Send read receipts", not
  "Disable read receipts".
- Orient the reader in empty states and provide one useful next action instead
  of only saying "No results".
- Address the reader as "you", not "the user".

## Completion check

- Confirm nested geometry, spacing, and optical alignment at all supported
  breakpoints.
- Confirm interactive states work with keyboard, pointer, and touch input.
- Confirm focus remains visible and follows a logical order.
- Confirm text reflows, long values do not escape, and truncation has an
  accessible full-value path.
- Confirm light and dark themes use the same switching mechanism and meet
  contrast requirements on their actual rendered backgrounds.
- Confirm reduced-motion users receive no nonessential animation.
- Confirm dynamic updates have the correct live-region urgency and no state
  depends on color alone.
- Report any rule that could not be applied and the stronger requirement that
  took precedence.
