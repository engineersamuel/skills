# Herdr terminal canvas

A macOS-first terminal canvas for agent-authored MDX. A trusted MCP broker,
runner, and Ink renderer are separated from an executable MDX worker launched
through a pinned Nono sandbox. There is no unsandboxed fallback.

## Runtime

- Bun `1.4.2`
- TypeScript `5.9.3`
- React 19 and Ink 6
- MDX 3
- Effect and `@effect/platform-bun` `4.0.0-rc.117`
- Nono `0.79.0` built from revision
  `e1f84a33bdfecad82490285ea65058fdabe2028a`
- mdxcn catalog revision `9c5c7343ded45587dacda75201f4b56f026787a4`

Stable Effect 4.0.0 packages are not published, so the matching release
candidate pair is pinned instead.

The packaged runtime contains immutable copies of Bun, Nono, the worker bundle,
and a hash manifest. Startup fails with `sandbox_unavailable` if the bundle,
versions, hashes, Nono enforcement, or platform do not match.

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run test:live
```

`verify` runs strict TypeScript and the test suite. Trusted broker and renderer
code runs directly from TypeScript with Bun, so routine development does not
need a transpilation build.

`runtime:package` is a separate, conditional sandbox preparation step. Run it
only when the pinned worker or its production dependency inputs change. It
stages the untrusted worker and exact dependencies in an immutable runtime; it
must not expose the repository or a shared package cache.

`test:live` opens real Herdr panes. It verifies stateful MDX, dataset updates,
callbacks, trusted input, manual close/reopen, broker crash cleanup, renderer
disconnect cancellation/grace, host disconnect cleanup, and owned-pane removal.

To watch the live harness showcase and answer its trusted decision yourself:

```sh
bun run showcase
```

The showcase streams progress, activity, and checks into the canvas, preserves
document React state, pauses for `request_input`, then leaves the completed
canvas visible until you press Ctrl-C.

To build and register Nono from the reviewed source:

```sh
git clone https://github.com/nolabs-ai/nono.git /tmp/canvas-nono
git -C /tmp/canvas-nono checkout e1f84a33bdfecad82490285ea65058fdabe2028a
cargo build --release -p nono-cli --bin nono --manifest-path /tmp/canvas-nono/Cargo.toml
install -m 0555 /tmp/canvas-nono/target/release/nono ~/.local/bin/nono
bun scripts/pin-nono.ts /tmp/canvas-nono ~/.local/bin/nono
```

The pinning script rejects a different revision, dirty source tree, version,
checksum, symlink, or non-regular binary. Do not replace the reviewed artifact
silently.

## MCP use

Start the stdio broker with the packaged runtime in its environment:

```sh
CANVAS_RUNTIME_BUNDLE="$PWD/generated/runtime-darwin-arm64" \
  bun src/broker/main.ts
```

The fixed tool surface is:

- `canvas.open`
- `canvas.set_layout`
- `canvas.upsert`, `canvas.patch`, `canvas.remove`
- `canvas.set_data`
- `canvas.catalog`
- `canvas.request_input`
- `canvas.complete`, `canvas.close`

`canvas.open` accepts only `delivery`, `architecture`, `debug`, or `blank`.
Pane IDs, commands, socket paths, and renderer credentials are never accepted
from tool input. `canvas.catalog` returns component classifications, terminal
notes, props schemas, and MDX examples.

MDX may import `react`, `effect`, and `@canvas/runtime`. The last module exports
the terminal component catalog for use inside module-scoped custom components:

```mdx
import { useState } from 'react'
import { Graph } from '@canvas/runtime'

export function Counter() {
  const [count, setCount] = useState(0)
  return <Graph title="Counter"><button onClick={() => setCount(count + 1)}>{count}</button></Graph>
}

<Counter />
```

See [docs/SECURITY.md](docs/SECURITY.md) and
[docs/TERMINAL_COMPATIBILITY.md](docs/TERMINAL_COMPATIBILITY.md) for the trust
boundary and terminal adaptations.

## Copilot installation

Use the stable installer after reviewing its dry run:

```sh
bun run install:copilot --dry-run
bun run install:copilot
```

It installs versioned application files under
`~/.local/share/herdr-canvas/`, a stable `~/.local/bin/herdr-canvas` launcher,
the portable `herdr-canvas` skill, persistent activation, and the selected
Copilot MCP registration. Existing registrations require
`--replace-existing-mcp`. See [docs/COPILOT.md](docs/COPILOT.md).

From the repository root, install or upgrade the complete integration for
Copilot CLI, Claude Code, Codex, and Pi with one command:

```sh
mise run herdr-canvas
```

The mise task pins Bun, verifies the application, and runs the staged installer
for all four harnesses. It preserves unrelated skill and MCP configuration.

Herdr Canvas is opt-in. Start a task with `canvas on` to activate it. Task size,
complexity, and MCP availability do not activate it automatically.
