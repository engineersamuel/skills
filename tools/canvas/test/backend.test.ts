import { describe, expect, test } from "bun:test";

import { CanvasBackend } from "../src/broker/backend.ts";
import type { RendererState } from "../src/protocol/renderer.ts";
import type { WorkerHandle, WorkerLauncher } from "../src/broker/session.ts";

const worker = (generation: number, title: string): WorkerHandle & { closed: boolean } => {
  const tree = { type: "Graph", props: { title }, children: [] };
  return {
    generation,
    firstTree: tree,
    currentTree: () => tree,
    subscribe: () => () => undefined,
    closed: false,
    async setData() {},
    async dispatchEvent() { return false; },
    async close() {
      this.closed = true;
    },
  };
};

describe("canvas backend", () => {
  test("opens only after sandbox verification and publishes the first validated render", async () => {
    const calls: string[] = [];
    const states: RendererState[] = [];
    const current = worker(1, "blank");
    const launcher: WorkerLauncher = {
      async start(source, generation) {
        calls.push(`worker:${generation}:${source}`);
        return current;
      },
    };
    const backend = new CanvasBackend({
      ensureSandbox: async () => {
        calls.push("sandbox");
      },
      launcher,
      pane: {
        async open(command) {
          calls.push(`pane:${command.join(" ")}`);
          return "owned";
        },
        async close() {},
      },
      renderer: {
        async start() {
          calls.push("socket");
        },
        publish: (state) => states.push(state),
        async close() {},
      },
      rendererCommand: ["bun", "renderer.js"],
      templates: { blank: "<Graph title=\"blank\" />" },
    });

    await backend.open({ template: "blank" });

    expect(calls).toEqual([
      "sandbox",
      "socket",
      "worker:1:<Graph title=\"blank\" />",
      "pane:bun renderer.js",
    ]);
    expect(states.at(-1)).toEqual({ status: "connected", tree: current.firstTree });
  });

  test("keeps decisions outside document content and resolves them once", async () => {
    const current = worker(1, "blank");
    const states: RendererState[] = [];
    const backend = new CanvasBackend({
      ensureSandbox: async () => undefined,
      launcher: { start: async () => current },
      pane: { open: async () => "owned", close: async () => undefined },
      renderer: {
        start: async () => undefined,
        publish: (state) => states.push(state),
        close: async () => undefined,
      },
      rendererCommand: ["renderer"],
      templates: { blank: "blank" },
      requestId: () => "decision-1",
    });
    await backend.open({ template: "blank" });

    const pending = backend.requestInput({ prompt: "Ship?", options: ["Ship", "Hold"] });
    expect(states.at(-1)?.decision).toEqual({
      id: "decision-1",
      prompt: "Ship?",
      options: ["Ship", "Hold"],
    });
    expect(backend.resolveDecision("decision-1", "Ship", false)).toBe(false);
    expect(backend.resolveDecision("decision-1", "Ship", true)).toBe(true);
    expect(backend.resolveDecision("decision-1", "Hold", true)).toBe(false);
    await expect(pending).resolves.toEqual({ value: "Ship" });
    expect(states.at(-1)?.decision).toBeUndefined();
  });

  test("cancels a pending decision when the authenticated renderer disconnects", async () => {
    const current = worker(1, "blank");
    const backend = new CanvasBackend({
      ensureSandbox: async () => undefined,
      launcher: { start: async () => current },
      pane: { open: async () => "owned", close: async () => undefined },
      renderer: { start: async () => undefined, publish: () => undefined, close: async () => undefined },
      rendererCommand: ["renderer"],
      templates: { blank: "blank" },
      requestId: () => "decision-disconnect",
    });
    await backend.open({ template: "blank" });
    const pending = backend.requestInput({ prompt: "Ship?", options: ["Ship", "Hold"] });

    backend.rendererDisconnected();

    await expect(pending).rejects.toThrow("renderer_disconnected");
  });

  test("closes only owned resources and cancels pending input", async () => {
    const events: string[] = [];
    const current = worker(1, "blank");
    const backend = new CanvasBackend({
      ensureSandbox: async () => undefined,
      launcher: { start: async () => current },
      pane: {
        open: async () => "owned",
        close: async () => {
          events.push("pane");
        },
      },
      renderer: {
        start: async () => undefined,
        publish: () => undefined,
        close: async () => {
          events.push("socket");
        },
      },
      rendererCommand: ["renderer"],
      templates: { blank: "blank" },
      requestId: () => "decision-2",
    });
    await backend.open({ template: "blank" });
    const pending = backend.requestInput({ prompt: "Ship?", options: ["Ship", "Hold"] });

    await backend.close();

    await expect(pending).rejects.toThrow("canvas_closed");
    expect(current.closed).toBe(true);
    expect(events).toEqual(["socket", "pane"]);
  });

  test("does not open a pane and closes the renderer socket when first render fails", async () => {
    const events: string[] = [];
    const backend = new CanvasBackend({
      ensureSandbox: async () => undefined,
      launcher: { start: async () => { throw new Error("compile failed"); } },
      pane: {
        open: async () => {
          events.push("pane");
          return "owned";
        },
        close: async () => undefined,
      },
      renderer: {
        start: async () => {
          events.push("socket:start");
        },
        publish: () => undefined,
        close: async () => {
          events.push("socket:close");
        },
      },
      rendererCommand: ["renderer"],
      templates: { blank: "blank" },
    });

    await expect(backend.open({ template: "blank" })).rejects.toThrow("compile failed");
    expect(events).toEqual(["socket:start", "socket:close"]);
  });

  test("shares one session initialization across concurrent opens", async () => {
    const current = worker(1, "blank");
    let workerStarts = 0;
    let finishStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const backend = new CanvasBackend({
      ensureSandbox: async () => undefined,
      launcher: {
        start: async () => {
          workerStarts += 1;
          await startGate;
          return current;
        },
      },
      pane: { open: async () => "owned", close: async () => undefined },
      renderer: {
        start: async () => undefined,
        publish: () => undefined,
        close: async () => undefined,
      },
      rendererCommand: ["renderer"],
      templates: { blank: "blank" },
    });

    const first = backend.open({ template: "blank" });
    const second = backend.open({ template: "blank" });
    await Promise.resolve();
    finishStart();
    await Promise.all([first, second]);

    expect(workerStarts).toBe(1);
    await backend.close();
  });
});
