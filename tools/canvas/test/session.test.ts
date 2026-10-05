import { describe, expect, test } from "bun:test";

import {
  CanvasSession,
  InputRequestStore,
  LayoutRejected,
  materializeSlots,
  type WorkerHandle,
  type WorkerLauncher,
} from "../src/broker/session.ts";

const worker = (generation: number, label: string, props: Record<string, unknown> = {}): WorkerHandle & {
  closed: boolean;
  updates: unknown[];
  publish(label: string): void;
  fail(reason: string): void;
} => {
  let tree = { type: "Graph", props: { title: label, ...props }, children: [] } as WorkerHandle["firstTree"];
  let failure: string | undefined;
  const listeners = new Set<() => void>();
  return {
    generation,
    firstTree: tree,
    currentTree: () => tree,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closed: false,
    updates: [],
    publish(nextLabel) {
      tree = { type: "Graph", props: { title: nextLabel }, children: [] };
      for (const listener of listeners) listener();
    },
    diagnostic: () => failure,
    fail(reason) {
      failure = reason;
      for (const listener of listeners) listener();
    },
    async setData(key, value) {
      this.updates.push([key, value]);
    },
    async dispatchEvent() { return false; },
    async close() {
      this.closed = true;
    },
  };
};

describe("canvas session", () => {
  test("atomically swaps only after a candidate produces its first valid tree", async () => {
    const oldWorker = worker(1, "old");
    const nextWorker = worker(2, "next");
    const launcher: WorkerLauncher = {
      start: async (mdx, generation) => {
        expect(mdx).toBe("# next");
        expect(generation).toBe(2);
        return nextWorker;
      },
    };
    const session = new CanvasSession(launcher, oldWorker, "# old");

    await session.setLayout("# next");

    expect(session.snapshot().tree).toEqual(nextWorker.firstTree);
    expect(oldWorker.closed).toBe(true);
    expect(session.snapshot().generation).toBe(2);
  });

  test("preserves the last valid worker and display when replacement fails", async () => {
    const oldWorker = worker(1, "old");
    const launcher: WorkerLauncher = {
      start: async () => {
        throw new Error("compile exploded\u001b[2J");
      },
    };
    const session = new CanvasSession(launcher, oldWorker, "# old");

    await expect(session.setLayout("broken")).rejects.toEqual(
      new LayoutRejected("compile exploded"),
    );
    expect(session.snapshot().tree).toEqual(oldWorker.firstTree);
    expect(oldWorker.closed).toBe(false);
  });

  test("updates datasets in the existing worker without changing generation", async () => {
    const current = worker(7, "live");
    const session = new CanvasSession({ start: async () => current }, current, "# live");

    await session.setData("builds", [{ id: 1 }]);

    expect(current.updates).toEqual([["builds", [{ id: 1 }]]]);
    expect(session.snapshot().generation).toBe(7);
  });

  test("seeds replacement workers with the current datasets", async () => {
    const current = worker(1, "old");
    const replacement = worker(2, "new");
    let initialDatasets: unknown;
    const launcher: WorkerLauncher = {
      start: async (...args: unknown[]) => {
        initialDatasets = args[2];
        return replacement;
      },
    };
    const session = new CanvasSession(launcher, current, "# old");

    await session.setData("inventory", { total: 5 });
    await session.setLayout("# new");

    expect(initialDatasets).toEqual({ inventory: { total: 5 } });
  });

  test("does not install a replacement that finishes after close begins", async () => {
    const current = worker(1, "old");
    const replacement = worker(2, "new");
    let finishStart!: (value: WorkerHandle) => void;
    const launcher: WorkerLauncher = {
      start: () => new Promise((resolve) => {
        finishStart = resolve;
      }),
    };
    const session = new CanvasSession(launcher, current, "# old");

    const replacementResult = session.setLayout("# new");
    await Promise.resolve();
    const closing = session.close();
    finishStart(replacement);

    await expect(replacementResult).rejects.toThrow("closed");
    await closing;
    expect(replacement.closed).toBe(true);
    expect(current.closed).toBe(true);
  });

  test("commits concurrent layout replacements in invocation order with unique generations", async () => {
    const current = worker(1, "old");
    const first = worker(2, "first");
    const second = worker(3, "second");
    const starts: Array<{ mdx: string; generation: number }> = [];
    let finishFirst!: (value: WorkerHandle) => void;
    const launcher: WorkerLauncher = {
      start: (mdx, generation) => {
        starts.push({ mdx, generation });
        return mdx === "# first"
          ? new Promise((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve(second);
      },
    };
    const session = new CanvasSession(launcher, current, "# old");

    const firstUpdate = session.setLayout("# first");
    const secondUpdate = session.setLayout("# second");
    await Promise.resolve();
    expect(starts).toEqual([{ mdx: "# first", generation: 2 }]);

    finishFirst(first);
    await Promise.all([firstUpdate, secondUpdate]);

    expect(starts).toEqual([
      { mdx: "# first", generation: 2 },
      { mdx: "# second", generation: 3 },
    ]);
    expect(session.snapshot().tree).toEqual(second.firstTree);
    expect(first.closed).toBe(true);
  });

  test("publishes live worker renders through the current session snapshot", () => {
    const current = worker(4, "first");
    const session = new CanvasSession({ start: async () => current }, current, "# live");
    let updates = 0;
    session.subscribe(() => {
      updates += 1;
    });

    current.publish("second");

    expect(session.snapshot().tree.props.title).toBe("second");
    expect(updates).toBe(1);
  });

  test("preserves a dead worker's last display but disables its callbacks", () => {
    const current = worker(4, "last", {
      onClick: { $type: "callback", generation: 4, revision: 1, id: "cb_1" },
    });
    const session = new CanvasSession({ start: async () => current }, current, "# live");

    current.fail("Worker terminated: worker_unresponsive");

    const snapshot = session.snapshot();
    expect(snapshot.diagnostic).toBe("Worker terminated: worker_unresponsive");
    expect(snapshot.tree.props.title).toBe("last");
    expect(snapshot.tree.props.onClick).toBeUndefined();
  });

  test("shallow-merges patches and removes named instances", () => {
    const current = worker(1, "live");
    const session = new CanvasSession({ start: async () => current }, current, "# live");
    session.upsert("summary", "Callout", { title: "Build", type: "note" });

    session.patch("summary", { type: "warning" });
    expect(session.snapshot().instances).toEqual({
      summary: { type: "Callout", props: { title: "Build", type: "warning" }, children: [] },
    });

    session.remove("summary");
    expect(session.snapshot().instances).toEqual({});
  });

  test("rejects invalid instance props before mutating session state", () => {
    const session = new CanvasSession({ start: async () => worker(2, "unused") }, worker(1, "root"), "# root");
    expect(() => session.upsert("action", "button", { onClick: "not-a-handle" })).toThrow();
    expect(session.snapshot().instances).toEqual({});
    session.upsert("action", "button", { title: "safe" });
    expect(() => session.patch("action", { onClick: "still-not-a-handle" })).toThrow();
    expect(session.snapshot().instances.action?.props).toEqual({ title: "safe" });
  });

  test("rejects instance accumulation that would exceed the renderer frame", () => {
    const session = new CanvasSession({ start: async () => worker(2, "unused") }, worker(1, "root"), "# root");
    const payload = "x".repeat(600_000);
    session.upsert("first", "Callout", { payload });

    expect(() => session.upsert("second", "Callout", { payload })).toThrow("Frame");
    expect(Object.keys(session.snapshot().instances)).toEqual(["first"]);
  });
});

describe("slot materialization", () => {
  test("places matching instances and appends unplaced instances once", () => {
    const tree = {
      type: "Graph",
      props: {},
      children: [{ type: "Canvas.Slot", props: { id: "a" }, children: [] }],
    };
    const instances = {
      a: { type: "Callout", props: { title: "A" }, children: [] },
      b: { type: "Quote", props: { by: "B" }, children: [] },
    };

    expect(materializeSlots(tree, instances)).toEqual({
      type: "Graph",
      props: {},
      children: [instances.a, instances.b],
    });
  });

  test("preserves ordinary MDX text children while materializing slots", () => {
    const tree = {
      type: "Graph",
      props: {},
      children: ["heading", { type: "Canvas.Slot", props: { id: "a" }, children: [] }],
    };
    const instance = { type: "Callout", props: { title: "A" }, children: ["body"] };

    expect(materializeSlots(tree, { a: instance })).toEqual({
      type: "Graph",
      props: {},
      children: ["heading", instance],
    });
  });
});

describe("trusted input requests", () => {
  test("resolves once only from a genuine current user action", async () => {
    const requests = new InputRequestStore();
    const pending = requests.create("req-1");

    expect(requests.resolve("req-1", "yes", false)).toBe(false);
    expect(requests.resolve("stale", "yes", true)).toBe(false);
    expect(requests.resolve("req-1", "yes", true)).toBe(true);
    expect(requests.resolve("req-1", "no", true)).toBe(false);
    await expect(pending).resolves.toBe("yes");
  });

  test("rejects pending input explicitly when the canvas closes", async () => {
    const requests = new InputRequestStore();
    const pending = requests.create("req-2");
    requests.cancelAll("canvas_closed");

    await expect(pending).rejects.toThrow("canvas_closed");
  });
});
