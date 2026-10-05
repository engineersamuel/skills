import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { buildSandboxProfile } from "../src/runner/profile.ts";
import type { SandboxUnavailableReason } from "../src/runner/errors.ts";
import { hasCompleteSandboxChecks } from "../src/runner/probe-contract.ts";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;

const readBounded = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_PROBE_OUTPUT_BYTES) throw new Error("probe output limit exceeded");
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
};

const reportUnavailable = (reason: SandboxUnavailableReason): never => {
  process.stdout.write(`${JSON.stringify({ status: "sandbox_unavailable", reason })}\n`);
  process.exit(2);
};

const requiredAbsoluteFile = (
  value: string | undefined,
  missingReason: SandboxUnavailableReason,
): string => {
  if (value === undefined) reportUnavailable(missingReason);
  if (!isAbsolute(value)) reportUnavailable("nono_path_invalid");
  if (!existsSync(value)) reportUnavailable(missingReason);
  return realpathSync(value);
};

const configuredNono = process.env.CANVAS_NONO_BIN;
const discoveredNono = configuredNono ?? Bun.which("nono") ?? undefined;
const nonoBinary = requiredAbsoluteFile(discoveredNono, "nono_missing");
const bunBinary = requiredAbsoluteFile(
  process.env.CANVAS_BUN_BIN ?? process.execPath,
  "runtime_bundle_invalid",
);
const runtimeRoot = process.env.CANVAS_RUNTIME_ROOT === undefined
  ? realpathSync(dirname(bunBinary))
  : realpathSync(process.env.CANVAS_RUNTIME_ROOT);

if (!bunBinary.startsWith(`${runtimeRoot}/`)) reportUnavailable("runtime_bundle_invalid");

const probeDirectory = realpathSync(mkdtempSync(join(tmpdir(), "canvas-sandbox-probe-")));
const profileDirectory = join(probeDirectory, "profile");
const scratchDirectory = join(probeDirectory, "scratch");
const secretPath = join(probeDirectory, "synthetic-secret.txt");
const outsideWritePath = join(probeDirectory, "outside-write.txt");
const unixSocketPath = join(probeDirectory, "host.sock");

await mkdir(profileDirectory, { mode: 0o700 });
await mkdir(scratchDirectory, { mode: 0o700 });
writeFileSync(secretPath, "synthetic-probe-secret", { mode: 0o600 });
writeFileSync(join(scratchDirectory, ".env"), "CANVAS_DOTENV_LEAK=loaded\n", { mode: 0o600 });

const tcpServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data() {} },
});
const unixServer = Bun.listen({
  unix: unixSocketPath,
  socket: { data() {} },
});

const profilePath = join(profileDirectory, "profile.json");
writeFileSync(profilePath, JSON.stringify(buildSandboxProfile({
  runtimeBundle: runtimeRoot,
  profileDirectory,
  scratchDirectory,
  bunBinary,
})), { mode: 0o600 });

const probeSource = `
import { dlopen, FFIType, ptr } from "bun:ffi";
import { createConnection } from "node:net";
import { symlinkSync } from "node:fs";

const inputs = ${JSON.stringify({
  scratchDirectory,
  secretPath,
  outsideWritePath,
  unixSocketPath,
  tcpPort: tcpServer.port,
  parentPid: process.pid,
})};
const debugProbe = ${JSON.stringify(process.env.CANVAS_PROBE_DEBUG === "1")};

const deniedConnection = (options) => new Promise((resolve) => {
  let settled = false;
  const finish = (denied) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.destroy();
    resolve(denied);
  };
  const socket = createConnection(options);
  const timer = setTimeout(() => finish(true), 500);
  socket.once("connect", () => finish(false));
  socket.once("error", () => finish(true));
});

const denied = async (operation) => {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
};

const lib = dlopen("/usr/lib/libSystem.B.dylib", {
  fork: { args: [], returns: FFIType.i32 },
  _exit: { args: [FFIType.i32], returns: FFIType.void },
  waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  posix_spawn: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  shm_open: { args: [FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
  shm_unlink: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_open: {
    args: [FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  sem_close: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_unlink: { args: [FFIType.ptr], returns: FFIType.i32 },
  kill: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  open: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  mach_task_self: { args: [], returns: FFIType.u32 },
  task_get_special_port: {
    args: [FFIType.u32, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  bootstrap_look_up: {
    args: [FFIType.u32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
});

const forkResult = lib.symbols.fork();
if (forkResult === 0) lib.symbols._exit(0);
if (forkResult > 0) lib.symbols.waitpid(forkResult, 0, 0);

const executable = Buffer.from("/usr/bin/true\\0");
const argv = new BigUint64Array([BigInt(ptr(executable)), 0n]);
const spawnedPid = new Int32Array(1);
const spawnResult = lib.symbols.posix_spawn(
  ptr(spawnedPid),
  ptr(executable),
  0,
  0,
  ptr(argv),
  0,
);

const ipcName = Buffer.from(\`/canvas-probe-\${process.pid}\\0\`);
const shmResult = lib.symbols.shm_open(ptr(ipcName), 0x0a02, 0o600);
if (shmResult >= 0) {
  lib.symbols.close(shmResult);
  lib.symbols.shm_unlink(ptr(ipcName));
}
const semaphoreResult = lib.symbols.sem_open(ptr(ipcName), 0x0a00, 0o600, 1);
const semaphoreFailed = semaphoreResult === null || semaphoreResult === (2n ** 64n - 1n);
if (semaphoreResult !== null) {
  if (!semaphoreFailed) {
    lib.symbols.sem_close(semaphoreResult);
    lib.symbols.sem_unlink(ptr(ipcName));
  }
}
if (debugProbe) {
  console.error(JSON.stringify({
    semaphoreResult: String(semaphoreResult),
    semaphoreType: typeof semaphoreResult,
    shmResult,
  }));
}

const ttyPath = Buffer.from("/dev/ptmx\\0");
const ttyResult = lib.symbols.open(ptr(ttyPath), 2);
if (ttyResult >= 0) lib.symbols.close(ttyResult);

const bootstrapPort = new Uint32Array(1);
const task = lib.symbols.mach_task_self();
const specialPortResult = lib.symbols.task_get_special_port(task, 4, ptr(bootstrapPort));
const servicePort = new Uint32Array(1);
const serviceName = Buffer.from("com.apple.cfprefsd.daemon\\0");
const machLookupResult = specialPortResult === 0
  ? lib.symbols.bootstrap_look_up(bootstrapPort[0], ptr(serviceName), ptr(servicePort))
  : specialPortResult;

const scratchWriteDenied = await denied(async () => {
  await Bun.write(\`\${inputs.scratchDirectory}/allowed.txt\`, "allowed");
});
const symlinkTraversalDenied = await (async () => {
  const linkPath = \`\${inputs.scratchDirectory}/outside-link\`;
  try {
    symlinkSync(inputs.outsideWritePath, linkPath);
  } catch {
    return true;
  }
  return denied(() => Bun.write(linkPath, "blocked"));
})();
const inheritedKeys = Object.keys(process.env);
const allowedEnvironmentKeys = new Set(["HOME", "TMPDIR", "NONO_CAP_FILE"]);

const checks = {
  bun_startup: true,
  dns_denied: await denied(() => Bun.dns.lookup("example.com")),
  dotenv_disabled: process.env.CANVAS_DOTENV_LEAK === undefined,
  environment_filtered:
    process.env.CANVAS_PROBE_INHERITED_SECRET === undefined &&
    inheritedKeys.every((key) => allowedEnvironmentKeys.has(key)),
  filesystem_read_denied: await denied(() => Bun.file(inputs.secretPath).text()),
  filesystem_write_denied: await denied(() => Bun.write(inputs.outsideWritePath, "blocked")),
  fork_denied: forkResult === -1,
  mach_lookup_denied: specialPortResult === 0 && machLookupResult !== 0,
  network_denied: await deniedConnection({ host: "127.0.0.1", port: inputs.tcpPort }),
  posix_semaphore_denied: semaphoreFailed,
  posix_shm_denied: shmResult === -1,
  posix_spawn_denied: spawnResult !== 0,
  signal_denied: lib.symbols.kill(inputs.parentPid, 10) === -1,
  scratch_write_allowed: !scratchWriteDenied,
  symlink_traversal_denied: symlinkTraversalDenied,
  terminal_denied: ttyResult === -1,
  unix_socket_denied: await deniedConnection({ path: inputs.unixSocketPath }),
};

console.log(JSON.stringify({ status: "probe_complete", checks }));
`;

try {
  let signalReceived = false;
  const onSignal = () => { signalReceived = true; };
  process.on("SIGUSR1", onSignal);
  const child = Bun.spawn({
    cmd: [
      nonoBinary,
      "--silent",
      "wrap",
      "--profile",
      profilePath,
      "--block-net",
      "--write",
      scratchDirectory,
      "--workdir",
      scratchDirectory,
      "--",
      bunBinary,
      "--no-env-file",
      "--no-install",
      "-e",
      probeSource,
    ],
    cwd: scratchDirectory,
    env: {
      HOME: profileDirectory,
      TMPDIR: profileDirectory,
      XDG_STATE_HOME: profileDirectory,
      CANVAS_PROBE_INHERITED_SECRET: process.env.CANVAS_PROBE_INHERITED_SECRET ?? "synthetic-canary",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
  const [stdout, exitCode, stderr] = await Promise.all([
    readBounded(child.stdout),
    child.exited,
    readBounded(child.stderr),
  ]);
  process.off("SIGUSR1", onSignal);
  clearTimeout(timeout);

  let result: { status?: string; checks?: Record<string, boolean> };
  try {
    result = JSON.parse(stdout.trim()) as typeof result;
  } catch {
    if (process.env.CANVAS_PROBE_DEBUG === "1") {
      process.stderr.write(`${JSON.stringify({ exitCode, workerStdout: stdout.trim(), workerStderr: stderr.trim() })}\n`);
    }
    reportUnavailable("enforcement_probe_failed");
  }
  if (
    exitCode !== 0 ||
    result.status !== "probe_complete" ||
    result.checks === undefined ||
    !hasCompleteSandboxChecks(result.checks) ||
    signalReceived
  ) {
    if (process.env.CANVAS_PROBE_DEBUG === "1") {
      const failedChecks = result.checks === undefined
        ? []
        : Object.entries(result.checks)
            .filter(([, passed]) => !passed)
            .map(([name]) => name);
      process.stderr.write(`${JSON.stringify({ exitCode, failedChecks, workerStderr: stderr.trim() })}\n`);
    }
    reportUnavailable("enforcement_probe_failed");
  }
  process.stdout.write(`${JSON.stringify({ status: "sandbox_ready", checks: result.checks })}\n`);
} catch (error) {
  if (process.env.CANVAS_PROBE_DEBUG === "1") {
    process.stderr.write(`${JSON.stringify({ probeError: String(error) })}\n`);
  }
  reportUnavailable("enforcement_probe_failed");
} finally {
  tcpServer.stop(true);
  unixServer.stop(true);
  rmSync(probeDirectory, { recursive: true, force: true });
}
