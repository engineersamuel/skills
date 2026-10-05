import { describe, expect, test } from "bun:test";

import { createWorkerLifecycle } from "../src/runner/lifecycle.ts";
import { FramedWorkerLauncher, WorkerOutputBudget, validateWorkerSnapshot } from "../src/runner/worker-client.ts";
import type { CanvasNode } from "../src/broker/session.ts";
import { callbackHandleSchema } from "../src/protocol/tree.ts";

const textContent = (node: CanvasNode | string): string =>
  typeof node === "string" ? node : node.children.map(textContent).join("");

const findProp = (node: CanvasNode, name: string): unknown => {
  if (Object.hasOwn(node.props, name)) return node.props[name];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const value = findProp(child, name);
    if (value !== undefined) return value;
  }
  return undefined;
};

describe("trusted framed worker client", () => {
  test("rejects sustained worker output floods within a bounded time window", () => {
    const budget = new WorkerOutputBudget(100, 1_000);
    expect(budget.accept(0, 60)).toBe(true);
    expect(budget.accept(500, 41)).toBe(false);
    expect(budget.accept(1_001, 100)).toBe(true);
  });

  test("binds callback handles to a strictly newer worker snapshot", () => {
    const snapshot = {
      generation: 7,
      revision: 2,
      tree: {
        type: "button",
        props: { onClick: { $type: "callback", generation: 7, revision: 2, id: "cb_1" } },
        children: ["Run"],
      },
    };

    expect(validateWorkerSnapshot(snapshot, 7, 1).revision).toBe(2);
    expect(() => validateWorkerSnapshot(snapshot, 7, 2)).toThrow("revision");
    expect(() => validateWorkerSnapshot({
      ...snapshot,
      tree: {
        ...snapshot.tree,
        props: { onClick: { $type: "callback", generation: 8, revision: 2, id: "cb_1" } },
      },
    }, 7, 1)).toThrow("callback");
  });

  test("rejects a synchronous infinite render after the external startup watchdog", async () => {
    const launcher = new FramedWorkerLauncher(() => {
      const child = Bun.spawn({
        cmd: [process.execPath, "src/worker/main.ts"],
        cwd: process.cwd(),
        env: {},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        ...createWorkerLifecycle(child, { startupTimeoutMs: 100, terminationGraceMs: 50 }),
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
      };
    });

    const start = launcher.start(`
export function Hang() {
  while (true) {}
}

<Hang />
`, 12);
    await expect(Promise.race([
      start,
      Bun.sleep(1_000).then(() => { throw new Error("candidate hang was not contained"); }),
    ])).rejects.not.toThrow("candidate hang was not contained");
  });

  test("waits for a validated first render and preserves state across dataset updates", async () => {
    const launcher = new FramedWorkerLauncher(() => {
      const child = Bun.spawn({
        cmd: [process.execPath, "src/worker/main.ts"],
        cwd: process.cwd(),
        env: {},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        ...createWorkerLifecycle(child),
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
      };
    });
    const handle = await launcher.start(`
import { useState } from 'react'

export function Counter() {
  const [count] = useState(7)
  return <p>{count}:{data.inventory?.total ?? 2}</p>
}

<Counter />
`, 3);

    expect(textContent(handle.currentTree())).toContain("7:2");
    await handle.setData("inventory", { total: 5 });
    expect(textContent(handle.currentTree())).toContain("7:5");

    await Promise.race([
      handle.close(),
      Bun.sleep(500).then(() => {
        throw new Error("worker close exceeded 500ms");
      }),
    ]);
  });

  test("keeps an idle static worker alive with protocol heartbeats", async () => {
    const launcher = new FramedWorkerLauncher(() => {
      const child = Bun.spawn({
        cmd: [process.execPath, "src/worker/main.ts"],
        cwd: process.cwd(),
        env: {},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        ...createWorkerLifecycle(child),
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
      };
    });
    const handle = await launcher.start("<p>{data.status ?? 'idle'}</p>", 9);

    await Bun.sleep(2_200);
    await handle.setData("status", "alive");

    expect(textContent(handle.currentTree())).toContain("alive");
    await handle.close();
  });

  test("dispatches current callback handles and rejects stale handles", async () => {
    const launcher = new FramedWorkerLauncher(() => {
      const child = Bun.spawn({
        cmd: [process.execPath, "src/worker/main.ts"],
        cwd: process.cwd(),
        env: {},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        ...createWorkerLifecycle(child),
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
      };
    });
    const handle = await launcher.start(`
import { useState } from 'react'
export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(value => value + 1)}>Count {count}</button>
}

<Counter />
`, 11);
    const callback = callbackHandleSchema.parse(findProp(handle.currentTree(), "onClick"));

    expect(await handle.dispatchEvent(callback)).toBe(true);
    expect(textContent(handle.currentTree())).toContain("Count 1");
    expect(await handle.dispatchEvent(callback)).toBe(false);
    await handle.close();
  });
});
