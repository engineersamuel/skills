# Execution boundary

Canvas MDX is executable JavaScript. It is evaluated only in a worker started
by `nono wrap` before Bun starts. The trusted runner retains the direct worker
handle and enforces startup, liveness, protocol, and shutdown deadlines.

The reviewed Nono source revision is
`e1f84a33bdfecad82490285ea65058fdabe2028a` (`nono 0.79.0`). A different or
missing binary, an invalid runtime bundle, an unsupported platform, or any
failed enforcement probe is `sandbox_unavailable`. There is no direct-Bun
fallback.

## macOS policy

- The packaged runtime and required macOS runtime files are readable.
- A new per-worker scratch directory is readable and writable because Bun and
  the MDX compiler must resolve their current working directory there.
- The profile directory, repository, credentials, Herdr sockets, renderer
  authentication, shell state, browser data, and keychains are unavailable.
- Inherited environment variables are removed. Worker `HOME` and `TMPDIR`
  point at scratch.
- Network, DNS, Unix sockets, Mach lookup, POSIX shared memory and semaphores,
  terminal access, signals, `fork`, and `posix_spawn` are denied.
- Bun runs with `--no-env-file` and `--no-install`; dependency installation and
  `.env` loading are disabled.
- Worker-created files are never loaded by a trusted process.

The release probe executes real Bun and FFI calls under the generated policy.
It must report every expected check as true, including Bun startup, environment
filtering, scratch writes, symlink traversal, and the denials above. The trusted runner separately
terminates a worker after startup timeout, liveness failure, broker-pipe loss,
or protocol abuse, escalating to forced termination after 500 ms.

## Protocol and rendering controls

Frames are length-prefixed and rejected before whole-message buffering when
they exceed 1 MiB. Partial frames expire after two seconds. Trees are limited
to 10,000 nodes and depth 64. Diagnostics and worker stderr are bounded.
Intermediate renderer updates are coalesced rather than queued without limit.

Worker trees, props, callback handles, renderer messages, and MCP inputs are
schema validated. Every untrusted string is stripped of terminal control
sequences at serialization and again at terminal formatting. Only the trusted
Ink renderer emits terminal escapes. Links are text and never launch programs.

Callbacks are opaque handles tied to the active worker generation and committed
tree revision. Replaced, terminated, and previously committed handles are
rejected. Decision controls are rendered outside document content and resolve
only once from authenticated renderer input; renderer disconnection cancels a
pending decision rather than leaving it unresolved.

## Limitations

Nono is an operating-system capability boundary, not a VM boundary. macOS does
not provide this design with a hard memory limit or a hard process-tree limit.
Synchronous JavaScript can monopolize the worker until the external watchdog
kills it. Hostile multitenant execution requires an outer VM or container.
Linux support is deferred.

The runtime manifest detects mutation through versions, hashes, file type,
symlink, and writable-mode checks, but it is packaged beside the files and is
not a detached signature or platform code signature.
