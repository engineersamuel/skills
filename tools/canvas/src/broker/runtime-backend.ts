import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createNonoInvocation } from "../runner/invocation.ts";
import { spawnNonoWorker } from "../runner/lifecycle.ts";
import { buildSandboxProfile } from "../runner/profile.ts";
import type { VerifiedRuntimeBundle } from "../runner/runtime-bundle.ts";
import { FramedWorkerLauncher } from "../runner/worker-client.ts";
import { CanvasBackend } from "./backend.ts";
import { HerdrCanvasOwner } from "./herdr.ts";
import { RendererSocketServer } from "./renderer-socket.ts";

const templates = {
  blank: "<Graph />",
  delivery: '<Graph title="Delivery"><Canvas.Slot id="summary" /></Graph>',
  architecture: '<Graph title="Architecture"><Canvas.Slot id="overview" /></Graph>',
  debug: '<Graph title="Debug"><Canvas.Slot id="diagnostic" /></Graph>',
} as const;

export interface RuntimeBackend {
  readonly backend: CanvasBackend;
  dispose(): Promise<void>;
}

export const createRuntimeBackend = async (
  bundle: VerifiedRuntimeBundle,
): Promise<RuntimeBackend> => {
  const brokerDirectory = await mkdtemp(join(tmpdir(), "canvas-broker-"));
  await chmod(brokerDirectory, 0o700);
  const socketPath = join(brokerDirectory, "renderer.sock");
  const token = randomBytes(32).toString("hex");
  const rendererConfigPath = join(brokerDirectory, "renderer-auth.json");
  writeFileSync(rendererConfigPath, JSON.stringify({ socketPath, token }), { mode: 0o600 });
  const brokerAbort = new AbortController();
  let backend: CanvasBackend | undefined;
  const renderer = new RendererSocketServer({
    socketPath,
    token,
    initialState: { status: "disconnected", diagnostic: "Waiting for the first canvas render" },
    onDecision: ({ requestId, value }) => backend?.resolveDecision(requestId, value, true),
    onEvent: ({ handle, payload }) => {
      void backend?.dispatchEvent(handle, payload).catch(() => undefined);
    },
    onDisconnect: () => backend?.rendererDisconnected(),
  });
  const launcher = new FramedWorkerLauncher(() => {
    const workerDirectory = mkdtempSync(join(tmpdir(), "canvas-worker-"));
    try {
      const scratchDirectory = join(workerDirectory, "scratch");
      const profileDirectory = join(workerDirectory, "profile");
      mkdirSync(scratchDirectory, { mode: 0o700 });
      mkdirSync(profileDirectory, { mode: 0o700 });
      const profilePath = join(profileDirectory, "profile.json");
      const profile = buildSandboxProfile({
        runtimeBundle: bundle.root,
        profileDirectory,
        scratchDirectory,
        bunBinary: bundle.bunBinary,
      });
      writeFileSync(profilePath, JSON.stringify(profile), { mode: 0o600 });
      const worker = spawnNonoWorker(createNonoInvocation({
        nonoBinary: bundle.nonoBinary,
        profilePath,
        scratchDirectory,
        bunBinary: bundle.bunBinary,
        workerEntrypoint: bundle.workerEntrypoint,
      }), { brokerSignal: brokerAbort.signal });
      void worker.terminated.finally(() => rm(workerDirectory, { recursive: true, force: true }));
      return worker;
    } catch (error) {
      rmSync(workerDirectory, { recursive: true, force: true });
      throw error;
    }
  });
  const executeHerdr = async (args: readonly string[]) => {
    const result = Bun.spawn({ cmd: ["herdr", ...args], cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    return { exitCode, stdout, stderr };
  };
  const pane = new HerdrCanvasOwner(executeHerdr, process.cwd(), process.env.HERDR_PANE_ID);
  const configuredRenderer = process.env.CANVAS_RENDERER_ENTRYPOINT;
  const rendererEntrypoint = configuredRenderer ?? [
    fileURLToPath(new URL("../renderer/main.tsx", import.meta.url)),
    fileURLToPath(new URL("../renderer/main.js", import.meta.url)),
  ].find(existsSync);
  if (rendererEntrypoint === undefined) throw new Error("Renderer entrypoint is missing");
  if (!isAbsolute(rendererEntrypoint)) throw new Error("Renderer entrypoint must be absolute");
  const configuredDisconnectGrace = Number(process.env.CANVAS_DISCONNECT_GRACE_MS ?? "30000");
  const rendererDisconnectGraceMs = Number.isFinite(configuredDisconnectGrace) && configuredDisconnectGrace >= 0
    ? String(configuredDisconnectGrace)
    : "30000";
  backend = new CanvasBackend({
    ensureSandbox: async () => undefined,
    launcher,
    pane,
    renderer,
    rendererCommand: [
      "env",
      `CANVAS_RENDERER_CONFIG=${rendererConfigPath}`,
      `CANVAS_DISCONNECT_GRACE_MS=${rendererDisconnectGraceMs}`,
      process.execPath,
      rendererEntrypoint,
    ],
    templates,
  });
  return {
    backend,
    async dispose() {
      brokerAbort.abort();
      await backend?.close().catch(() => undefined);
      await rm(brokerDirectory, { recursive: true, force: true });
    },
  };
};
