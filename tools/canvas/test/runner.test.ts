import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";


type WorkerProcessControl = {
  readonly exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
};
type LifecycleFactory = (
  processHandle: WorkerProcessControl,
  options: { readonly scheduler: FakeScheduler; readonly brokerSignal?: AbortSignal },
) => {
  readonly ready: Promise<void>;
  readonly terminated: Promise<{ readonly reason: string; readonly exitCode: number }>;
  markFirstRenderValidated(): boolean;
  markHeartbeat(): boolean;
};
type RuntimeVersionCommand = (
  tool: "bun" | "nono",
  binaryPath: string,
  cwd: string,
) => { readonly exitCode: number; readonly stdout: string };
type RuntimeBundleValidator = (
  root: string,
  options?: { readonly runVersionCommand?: RuntimeVersionCommand },
) => Promise<{
  readonly root: string;
  readonly bunBinary: string;
  readonly nonoBinary: string;
  readonly workerEntrypoint: string;
}>;

const loadLifecycleFactory = async (): Promise<LifecycleFactory | undefined> => {
  const lifecycleUrl = new URL("../src/runner/lifecycle.ts", import.meta.url);
  const lifecycle = await import(lifecycleUrl.href).catch(() => undefined);
  expect(lifecycle?.createWorkerLifecycle).toBeTypeOf("function");
  return lifecycle?.createWorkerLifecycle;
};

const loadRuntimeBundleValidator = async (): Promise<RuntimeBundleValidator | undefined> => {
  const bundleUrl = new URL("../src/runner/runtime-bundle.ts", import.meta.url);
  const bundle = await import(bundleUrl.href).catch(() => undefined);
  expect(bundle?.validateRuntimeBundle).toBeTypeOf("function");
  return bundle?.validateRuntimeBundle;
};

const writeBundleFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), "canvas-runtime-bundle-"));
  const files = {
    bun: "trusted bun fixture",
    nono: "trusted nono fixture",
    worker: "trusted worker fixture",
  };
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(root, name === "worker" ? "worker.js" : name);
    writeFileSync(filePath, contents);
    chmodSync(filePath, name === "worker" ? 0o444 : 0o555);
  }

  const manifest = {
    formatVersion: 1,
    bun: {
      path: "bun",
      sha256: createHash("sha256").update(files.bun).digest("hex"),
      version: "1.4.2",
    },
    nono: {
      path: "nono",
      sha256: createHash("sha256").update(files.nono).digest("hex"),
      sourceRevision: "e1f84a33bdfecad82490285ea65058fdabe2028a",
      version: "0.79.0",
    },
    worker: {
      path: "worker.js",
      sha256: createHash("sha256").update(files.worker).digest("hex"),
    },
  };
  writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
  chmodSync(join(root, "runtime-manifest.json"), 0o444);
  chmodSync(root, 0o555);
  return root;
};

const versionCommand = (tool: "bun" | "nono", binaryPath: string) => ({
  exitCode: 0,
  stdout: tool === "bun" ? "1.4.2\n" : "nono 0.79.0\n",
  binaryPath,
});

describe("sandbox enforcement probe", () => {
  test("reports a missing Nono binary as sandbox_unavailable", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "scripts/probe-sandbox.ts"],
      cwd: process.cwd(),
      env: { CANVAS_NONO_BIN: "/definitely/missing/nono" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout?.toString() ?? "")).toEqual({
      status: "sandbox_unavailable",
      reason: "nono_missing",
    });
  });

  test("proves Bun startup and the required macOS capability denials", () => {
    if (process.platform !== "darwin") return;
    const bundledNono = join(
      process.cwd(),
      "generated/runtime-darwin-arm64/nono",
    );
    const nonoBinary = existsSync(bundledNono) ? bundledNono : Bun.which("nono");
    if (nonoBinary === null) return;

    const result = Bun.spawnSync({
      cmd: [process.execPath, "scripts/probe-sandbox.ts"],
      cwd: process.cwd(),
      env: {
        CANVAS_NONO_BIN: nonoBinary,
        CANVAS_BUN_BIN: process.execPath,
        CANVAS_RUNTIME_ROOT: realpathSync(dirname(process.execPath)),
        CANVAS_PROBE_INHERITED_SECRET: "must-not-cross",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout?.toString() ?? "") as {
      status: string;
      checks: Record<string, boolean>;
    };
    expect(report.status).toBe("sandbox_ready");
    expect(Object.keys(report.checks).sort()).toEqual([
      "bun_startup",
      "dns_denied",
      "dotenv_disabled",
      "environment_filtered",
      "filesystem_read_denied",
      "filesystem_write_denied",
      "fork_denied",
      "mach_lookup_denied",
      "network_denied",
      "posix_semaphore_denied",
      "posix_shm_denied",
      "posix_spawn_denied",
      "scratch_write_allowed",
      "signal_denied",
      "symlink_traversal_denied",
      "terminal_denied",
      "unix_socket_denied",
    ]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  }, 20_000);
});

describe("Nono launch configuration", () => {
  test("keeps launcher state outside scratch and gives Bun only scratch HOME and TMPDIR", async () => {
    const runnerUrl = new URL("../src/runner/invocation.ts", import.meta.url);
    const runner = await import(runnerUrl.href).catch(() => undefined);

    expect(
      runner?.createNonoInvocation({
        nonoBinary: "/Applications/Herdr.app/Contents/Resources/runtime/nono",
        profilePath: "/private/tmp/canvas-123/profile/profile.json",
        scratchDirectory: "/private/tmp/canvas-123/scratch",
        bunBinary: "/Applications/Herdr.app/Contents/Resources/runtime/bun",
        workerEntrypoint: "/Applications/Herdr.app/Contents/Resources/runtime/worker.js",
      }),
    ).toEqual({
      cmd: [
        "/Applications/Herdr.app/Contents/Resources/runtime/nono",
        "--silent",
        "wrap",
        "--profile",
        "/private/tmp/canvas-123/profile/profile.json",
        "--block-net",
        "--write",
        "/private/tmp/canvas-123/scratch",
        "--workdir",
        "/private/tmp/canvas-123/scratch",
        "--",
        "/Applications/Herdr.app/Contents/Resources/runtime/bun",
        "--no-env-file",
        "--no-install",
        "/Applications/Herdr.app/Contents/Resources/runtime/worker.js",
      ],
      cwd: "/private/tmp/canvas-123/scratch",
      env: {
        HOME: "/private/tmp/canvas-123/profile",
        TMPDIR: "/private/tmp/canvas-123/profile",
        XDG_STATE_HOME: "/private/tmp/canvas-123/profile",
      },
    });
  });
});

describe("Nono artifact pin", () => {
  test("requires the reviewed revision, version, and binary checksum", async () => {
    const pinUrl = new URL("../src/runner/nono-pin.ts", import.meta.url);
    const pin = await import(pinUrl.href).catch(() => undefined);
    expect(pin?.validateNonoArtifact).toBeTypeOf("function");
    if (pin === undefined) return;

    const checksum = "a".repeat(64);
    expect(() =>
      pin.validateNonoArtifact(
        {
          sourceRevision: "not-the-reviewed-revision",
          version: "0.79.0",
          sha256: checksum,
        },
        checksum,
        "nono 0.79.0\n",
      ),
    ).toThrow();
    expect(() =>
      pin.validateNonoArtifact(
        {
          sourceRevision: "e1f84a33bdfecad82490285ea65058fdabe2028a",
          version: "0.79.0",
          sha256: checksum,
        },
        checksum,
        "nono 0.79.0\n",
      ),
    ).not.toThrow();
    expect(() =>
      pin.validateNonoArtifact(
        {
          sourceRevision: "e1f84a33bdfecad82490285ea65058fdabe2028a",
          version: "0.79.0",
          sha256: checksum,
        },
        "b".repeat(64),
        "nono 0.79.0\n",
      ),
    ).toThrow();
  });
});

describe("canvas Nono profile", () => {
  test("keeps implicit default grants out and scopes the remaining runtime paths", async () => {
    const profileUrl = new URL("../src/runner/profile.ts", import.meta.url);
    const profileModule = await import(profileUrl.href).catch(() => undefined);
    const profile = profileModule?.buildSandboxProfile({
      runtimeBundle: "/Applications/Herdr.app/Contents/Resources/runtime",
      profileDirectory: "/private/tmp/canvas-123/profile",
      scratchDirectory: "/private/tmp/canvas-123/scratch",
      bunBinary: "/Applications/Herdr.app/Contents/Resources/runtime/bun",
    });

    expect(profile).toBeDefined();
    expect(profile).toMatchObject({
      meta: { name: "default" },
      groups: {
        include: [
          "deny_credentials",
          "deny_keychains_macos",
          "deny_browser_data_macos",
          "deny_macos_private",
          "deny_shell_configs",
          "deny_shell_history",
        ],
        exclude: [],
      },
      workdir: { access: "none" },
      filesystem: {
        read: [
          "/Applications/Herdr.app/Contents/Resources/runtime",
          "/private/tmp/canvas-123/scratch",
          "/usr/lib",
          "/System/Library",
          "/private/var/db/dyld",
          "/dev/null",
          "/dev/urandom",
          "/dev/random",
        ],
        deny: [
          "/private/tmp/canvas-123/profile",
          "/dev/tty*",
          "/dev/ptmx",
          "/dev/console",
          "/dev/pts",
          "/dev/pts/*",
        ],
      },
      network: { block: true },
      environment: {
        allow_vars: [],
        set_vars: {
          HOME: "/private/tmp/canvas-123/scratch",
          TMPDIR: "/private/tmp/canvas-123/scratch",
        },
      },
      security: {
        signal_mode: "isolated",
        process_info_mode: "isolated",
        ipc_mode: "shared_memory_only",
        capability_elevation: false,
      },
      unsafe_macos_seatbelt_rules: [
        "(deny process-fork)",
        "(deny process-exec*)",
        '(allow process-exec* (literal "/Applications/Herdr.app/Contents/Resources/runtime/bun"))',
        "(deny mach-lookup)",
        "(deny mach-per-user-lookup)",
        "(deny mach-task-name)",
        "(deny ipc-posix-shm-read-data)",
        "(deny ipc-posix-shm-write-data)",
        "(deny ipc-posix-shm-write-create)",
        "(deny ipc-posix-sem*)",
        '(deny file-read* (regex #"^/dev/(tty.*|console|pts(/.*)?)$"))',
        '(deny file-write* (regex #"^/dev/(tty.*|console|pts(/.*)?)$"))',
        '(deny file-ioctl (regex #"^/dev/(tty.*|console|pts(/.*)?)$"))',
        "(deny pseudo-tty)",
        "(deny network*)",
      ],
    });
  });
});

class FakeScheduler {
  #now = 0;
  #nextId = 0;
  readonly #timers = new Map<number, { at: number; callback: () => void }>();

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + delayMs, callback });
    return () => this.#timers.delete(id);
  }

  async advance(delayMs: number): Promise<void> {
    const target = this.#now + delayMs;
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (next === undefined) break;
      const [id, timer] = next;
      this.#timers.delete(id);
      this.#now = timer.at;
      timer.callback();
      await Promise.resolve();
    }
    this.#now = target;
    await Promise.resolve();
  }
}

class FakeWorkerProcess implements WorkerProcessControl {
  readonly signals: string[] = [];
  readonly exited: Promise<number>;
  readonly #resolveExit: (code: number) => void;

  constructor(readonly exitOnTerm = false) {
    let resolveExit: (code: number) => void = () => undefined;
    this.exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    this.#resolveExit = resolveExit;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.signals.push(signal);
    if (signal === "SIGKILL" || (signal === "SIGTERM" && this.exitOnTerm)) {
      this.#resolveExit(signal === "SIGKILL" ? 137 : 0);
    }
  }
}

describe("trusted worker lifecycle", () => {
  test("terminates a worker that misses the five-second first-render deadline", async () => {
    const createWorkerLifecycle = await loadLifecycleFactory();
    if (createWorkerLifecycle === undefined) return;
    const scheduler = new FakeScheduler();
    const processHandle = new FakeWorkerProcess();
    const worker = createWorkerLifecycle(processHandle, { scheduler });

    const readiness = worker.ready;
    await scheduler.advance(4_999);
    expect(processHandle.signals).toEqual([]);

    await scheduler.advance(1);
    await expect(readiness).rejects.toMatchObject({ reason: "worker_startup_timeout" });
    expect(processHandle.signals).toEqual(["SIGTERM"]);

    await scheduler.advance(500);
    await expect(worker.terminated).resolves.toMatchObject({
      reason: "worker_startup_timeout",
      exitCode: 137,
    });
    expect(processHandle.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("kills a worker that stops answering liveness checks", async () => {
    const createWorkerLifecycle = await loadLifecycleFactory();
    if (createWorkerLifecycle === undefined) return;
    const scheduler = new FakeScheduler();
    const processHandle = new FakeWorkerProcess();
    const worker = createWorkerLifecycle(processHandle, { scheduler });

    worker.markFirstRenderValidated();
    await scheduler.advance(1_999);
    expect(processHandle.signals).toEqual([]);

    await scheduler.advance(1);
    await scheduler.advance(500);
    await expect(worker.terminated).resolves.toMatchObject({
      reason: "worker_unresponsive",
      exitCode: 137,
    });
    expect(processHandle.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("cleans up on broker-pipe disconnect and avoids escalation after graceful exit", async () => {
    const createWorkerLifecycle = await loadLifecycleFactory();
    if (createWorkerLifecycle === undefined) return;
    const scheduler = new FakeScheduler();
    const processHandle = new FakeWorkerProcess(true);
    const brokerPipe = new AbortController();
    const worker = createWorkerLifecycle(processHandle, {
      scheduler,
      brokerSignal: brokerPipe.signal,
    });

    brokerPipe.abort();

    await expect(worker.terminated).resolves.toMatchObject({
      reason: "broker_disconnected",
      exitCode: 0,
    });
    await scheduler.advance(500);
    expect(processHandle.signals).toEqual(["SIGTERM"]);
  });

  test("resets liveness only when a valid heartbeat arrives", async () => {
    const createWorkerLifecycle = await loadLifecycleFactory();
    if (createWorkerLifecycle === undefined) return;
    const scheduler = new FakeScheduler();
    const processHandle = new FakeWorkerProcess();
    const worker = createWorkerLifecycle(processHandle, { scheduler });

    worker.markFirstRenderValidated();
    await scheduler.advance(1_500);
    expect(worker.markHeartbeat()).toBe(true);
    await scheduler.advance(1_999);
    expect(processHandle.signals).toEqual([]);

    await scheduler.advance(1);
    expect(processHandle.signals).toEqual(["SIGTERM"]);
  });
});

describe("trusted runtime bundle", () => {
  test("verifies executable versions and file hashes before returning paths", async () => {
    const validateRuntimeBundle = await loadRuntimeBundleValidator();
    if (validateRuntimeBundle === undefined) return;
    const root = writeBundleFixture();
    const versionCalls: string[] = [];

    try {
      const bundle = await validateRuntimeBundle(root, {
        runVersionCommand(tool, binaryPath) {
          versionCalls.push(`${tool}:${binaryPath}`);
          return versionCommand(tool, binaryPath);
        },
      });

      expect(bundle).toEqual({
        root: realpathSync(root),
        bunBinary: join(realpathSync(root), "bun"),
        nonoBinary: join(realpathSync(root), "nono"),
        workerEntrypoint: join(realpathSync(root), "worker.js"),
      });
      expect(versionCalls).toEqual([
        `bun:${join(realpathSync(root), "bun")}`,
        `nono:${join(realpathSync(root), "nono")}`,
      ]);
    } finally {
      chmodSync(root, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects symlinked assets and manifest paths outside the bundle", async () => {
    const validateRuntimeBundle = await loadRuntimeBundleValidator();
    if (validateRuntimeBundle === undefined) return;
    const root = writeBundleFixture();
    const workerPath = join(root, "worker.js");
    const outsideWorker = `${root}-outside-worker.js`;

    try {
      chmodSync(root, 0o755);
      chmodSync(workerPath, 0o644);
      chmodSync(join(root, "runtime-manifest.json"), 0o644);
      const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json"), "utf8"));
      writeFileSync(outsideWorker, "trusted worker fixture");
      rmSync(workerPath);
      symlinkSync(outsideWorker, workerPath);
      await expect(
        validateRuntimeBundle(root, { runVersionCommand: versionCommand }),
      ).rejects.toMatchObject({ reason: "runtime_bundle_invalid" });

      rmSync(workerPath);
      writeFileSync(workerPath, "trusted worker fixture");
      manifest.worker.path = "../canvas-outside-worker.js";
      writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(manifest));
      await expect(
        validateRuntimeBundle(root, { runVersionCommand: versionCommand }),
      ).rejects.toMatchObject({ reason: "runtime_bundle_invalid" });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideWorker, { force: true });
    }
  });

  test("rejects a digest or pinned runtime version mismatch", async () => {
    const validateRuntimeBundle = await loadRuntimeBundleValidator();
    if (validateRuntimeBundle === undefined) return;
    const root = writeBundleFixture();

    try {
      chmodSync(root, 0o755);
      chmodSync(join(root, "worker.js"), 0o644);
      writeFileSync(join(root, "worker.js"), "changed worker fixture");
      await expect(
        validateRuntimeBundle(root, { runVersionCommand: versionCommand }),
      ).rejects.toMatchObject({ reason: "runtime_bundle_invalid" });

      const unchangedRoot = writeBundleFixture();
      try {
        await expect(
          validateRuntimeBundle(unchangedRoot, {
            runVersionCommand: (tool, binaryPath) => ({
              ...versionCommand(tool, binaryPath),
              stdout: tool === "bun" ? "1.5.0\n" : "nono 0.79.0\n",
            }),
          }),
        ).rejects.toMatchObject({ reason: "bun_version_mismatch" });
      } finally {
        chmodSync(unchangedRoot, 0o755);
        rmSync(unchangedRoot, { recursive: true, force: true });
      }
    } finally {
      chmodSync(root, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
