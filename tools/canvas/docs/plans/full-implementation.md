# Herdr terminal canvas completion plan

Source of truth: the user-supplied "Herdr terminal canvas: full MDX with
sandboxed JavaScript" specification in this thread.

## Global constraints

- Fail closed. There is no unsandboxed MDX execution path.
- Pin Bun 1.4.2, TypeScript 5.9.3, the available Effect 4 prerelease pair,
  Nono revision `e1f84a33bdfecad82490285ea65058fdabe2028a`, and mdxcn revision
  `9c5c7343ded45587dacda75201f4b56f026787a4`.
- Treat the broker, renderer, and runner as trusted. Treat worker output as
  hostile and schema validate and sanitize every boundary.
- Preserve the current valid canvas until a replacement worker produces a
  validated first render.
- Develop changes with failing behavioral tests first.

## Tasks

1. Install and package the pinned Nono binary, then implement real macOS
   enforcement probes for Bun startup and denied filesystem, network, DNS,
   sockets, IPC, terminal, signals, and subprocess creation.
2. Complete worker protocol, lifecycle, output bounds, event dispatch, and
   sandbox policy hardening discovered by enforcement testing.
3. Implement semantic terminal adapters, fixtures, Markdown grammars, helpers,
   Graph framing, Footnotes, callbacks, details, responsive behavior, Unicode
   widths, and pausable animation for the pinned 47-component catalog.
4. Complete broker, renderer socket, decision input, callback, reconnect,
   manual-closure, candidate-swap, and Herdr ownership behavior.
5. Add end-to-end sandbox, PTY, and live Herdr integration coverage and package
   the immutable runtime plus usage and compatibility documentation.
6. Run an independent security and correctness review, address all material
   findings test-first, and execute strict typecheck, complete tests, build,
   enforcement probes, and antislop delivery checks.

## Review focus

- Host escape or capability leaks, especially environment, filesystem,
  networking, Mach/IPC, terminal, signals, and native subprocesses.
- Unbounded frames, queues, diagnostics, render work, or stale callback use.
- Session races across close, reconnect, worker death, and layout replacement.
- False catalog parity claims where only component-name fallback exists.
- Live terminal behavior at narrow widths, keyboard-only operation, Unicode,
  empty/error states, and user-controlled animation.
