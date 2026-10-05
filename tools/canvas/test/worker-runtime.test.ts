import { describe, expect, test } from "bun:test";

import {
  createWorkerRuntime,
  type WorkerEventHandle,
  type WorkerTreeNode,
} from "../src/worker/runtime.ts";

const textContent = (node: WorkerTreeNode | string): string =>
  typeof node === "string" ? node : node.children.map(textContent).join("");

const findNode = (node: WorkerTreeNode | string, type: string): WorkerTreeNode | undefined => {
  if (typeof node === "string") return undefined;
  if (node.type === type) return node;
  for (const child of node.children) {
    const match = findNode(child, type);
    if (match) return match;
  }
  return undefined;
};

const waitForText = async (
  read: () => string,
  expected: string,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for rendered text: ${expected}`);
};

describe("MDX worker runtime", () => {
  test("renders a live harness dashboard from dataset-driven component props", async () => {
    const worker = createWorkerRuntime({
      generation: 2,
      datasets: {
        run: {
          progress: 0.5,
          phase: "running checks",
          events: [{ step: 2, activity: "typecheck complete" }],
          checks: [{ name: "sandbox", status: "passed" }],
        },
      },
    });
    const result = await worker.render(`
import { useState } from 'react'
import { Graph, GraphMeter, GraphTimeline, GraphCheck } from '@canvas/runtime'

export function Live() {
  const [count, setCount] = useState(0)
  const run = data.run ?? {}
  return <Graph title="Harness run">
    <GraphMeter value={run.progress ?? 0} caption={run.phase ?? 'waiting'} />
    <p>State: {run.phase ?? 'waiting'}</p>
    <button onClick={() => setCount(value => value + 1)}>Interactions: {count}</button>
    <GraphTimeline title="Recent activity" items={run.events ?? []} />
    <GraphCheck title="Checks" items={run.checks ?? []} />
  </Graph>
}

<Live />
`);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
    expect(textContent(result.snapshot.tree)).toContain("running checks");
    expect(findNode(result.snapshot.tree, "GraphMeter")?.props.value).toBe(0.5);
    expect(findNode(result.snapshot.tree, "GraphTimeline")?.props.items).toEqual([
      { step: 2, activity: "typecheck complete" },
    ]);
    await worker.close();
  });

  test("imports canvas components into module-scoped custom components", async () => {
    const worker = createWorkerRuntime({ generation: 3 });
    const result = await worker.render(`
import { Graph } from '@canvas/runtime'

export function Layout() {
  return <Graph title="Imported">module component</Graph>
}

<Layout />
`);

    expect(result.ok).toBe(true);
    expect(worker.getSnapshot()?.tree).toMatchObject({
      type: "Graph",
      props: { title: "Imported" },
      children: ["module component"],
    });
    await worker.close();
  });

  test("resolves the packaged Effect runtime without repository imports", async () => {
    const worker = createWorkerRuntime({ generation: 5 });
    const result = await worker.render(`
import { Effect } from 'effect'

<p>{Effect.runSync(Effect.succeed('effect-ready'))}</p>
`);

    expect(result.ok).toBe(true);
    expect(worker.getSnapshot()?.tree.children).toEqual([
      { type: "p", props: {}, children: ["effect-ready"] },
    ]);
    await worker.close();
  });

  test("renders MDX and dispatches a committed event handle to update React state", async () => {
    const worker = createWorkerRuntime({ generation: 4 });
    const result = await worker.render(`
import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
}

<Counter />
`);

    expect(result.ok).toBe(true);
    const first = worker.getSnapshot();
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected an initial worker snapshot");

    expect(first.tree.type).toBe("Graph");
    const button = findNode(first.tree, "button");
    expect(button).toBeDefined();
    const handle = button?.props.onClick as WorkerEventHandle | undefined;
    if (!handle) throw new Error("expected an opaque event handle");
    expect(handle).toEqual({
      $type: "callback",
      generation: 4,
      revision: first.revision,
      id: handle.id,
    });
    expect(typeof handle?.id).toBe("string");
    expect(JSON.parse(JSON.stringify(first.tree))).toEqual(first.tree);

    await expect(worker.dispatchEvent(handle)).resolves.toBe(true);

    const second = worker.getSnapshot();
    expect(second).not.toBeNull();
    if (!second) throw new Error("expected an updated worker snapshot");
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(textContent(second.tree)).toBe("Count: 1");
    await expect(worker.dispatchEvent(handle)).resolves.toBe(false);

    await worker.close();
  });

  test("updates a dataset without recompiling or resetting component state", async () => {
    const worker = createWorkerRuntime({
      generation: 9,
      datasets: { inventory: { total: 2 } },
    });
    const result = await worker.render(`
import { useState } from 'react'

export function Inventory() {
  const [clicks, setClicks] = useState(0)
  return <section>
    <button onClick={() => setClicks((value) => value + 1)}>Clicks: {clicks}</button>
    <p>Total: {data.inventory.total}</p>
  </section>
}

<Inventory />
`);

    expect(result.ok).toBe(true);
    const first = worker.getSnapshot();
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected an initial worker snapshot");

    const button = findNode(first.tree, "button");
    const handle = button?.props.onClick as WorkerEventHandle | undefined;
    if (!handle) throw new Error("expected an opaque event handle");
    await expect(worker.dispatchEvent(handle)).resolves.toBe(true);

    const updated = await worker.setData("inventory", { total: 3 });
    expect(updated.ok).toBe(true);
    const snapshot = worker.getSnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("expected an updated worker snapshot");
    expect(snapshot.tree.type).toBe("Graph");
    expect(textContent(snapshot.tree)).toContain("Clicks: 1");
    expect(textContent(snapshot.tree)).toContain("Total: 3");

    await worker.close();
  });

  test("resolves mdxcn names and preserves an explicit Graph document root", async () => {
    const worker = createWorkerRuntime({ generation: 10 });
    const result = await worker.render(`
<Graph title="Summary">
  <Callout title="Result"><p>Ready</p></Callout>
</Graph>
`);

    expect(result.ok).toBe(true);
    const snapshot = worker.getSnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("expected an initial worker snapshot");
    expect(snapshot.tree.type).toBe("Graph");
    expect(snapshot.tree.props.title).toBe("Summary");
    expect(findNode(snapshot.tree, "Callout")?.props.title).toBe("Result");
    expect(textContent(snapshot.tree)).toBe("Ready");

    await worker.close();
  });

  test("resolves the namespaced Canvas.Slot component", async () => {
    const worker = createWorkerRuntime({ generation: 11 });
    const result = await worker.render(`
<Canvas.Slot id="summary" />
`);

    expect(result.ok).toBe(true);
    const snapshot = worker.getSnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("expected an initial worker snapshot");
    expect(findNode(snapshot.tree, "Canvas.Slot")?.props.id).toBe("summary");

    await worker.close();
  });

  test("supports GFM tables, task inputs, footnotes, and safe details tags", async () => {
    const worker = createWorkerRuntime({ generation: 18 });
    const result = await worker.render(`
| Name | State |
| --- | --- |
| Canvas | ready |

- [x] sandboxed

Reference[^1].

[^1]: Footnote text.

<details open><summary>More</summary><p>Visible detail.</p></details>
`);
    expect(result.ok).toBe(true);
    const snapshot = worker.getSnapshot();
    if (snapshot === null) throw new Error("expected an initial worker snapshot");
    expect(findNode(snapshot.tree, "table")).toBeDefined();
    expect(findNode(snapshot.tree, "input")?.props.checked).toBe(true);
    expect(findNode(snapshot.tree, "details")?.props.open).toBe(true);
    expect(findNode(snapshot.tree, "section")).toBeDefined();
    expect(textContent(snapshot.tree)).toContain("Footnote text");
    await worker.close();
  });

  test("runs effects and timers inside the worker and publishes later renders", async () => {
    const worker = createWorkerRuntime({ generation: 12 });
    const result = await worker.render(`
import { useEffect, useState } from 'react'

export function Timer() {
  const [status, setStatus] = useState('waiting')
  useEffect(() => {
    const timer = setTimeout(() => setStatus('finished'), 10)
    return () => clearTimeout(timer)
  }, [])
  return <p>{status}</p>
}

<Timer />
`);

    expect(result.ok).toBe(true);
    expect(worker.getSnapshot()).not.toBeNull();
    await waitForText(() => {
      const snapshot = worker.getSnapshot();
      return snapshot ? textContent(snapshot.tree) : "";
    }, "finished");

    await worker.close();
  });

  test("rejects relative and arbitrary module imports before evaluation", async () => {
    const worker = createWorkerRuntime({ generation: 15 });

    const result = await worker.render(`
import secret from '../private-data'

<p>{secret}</p>
`);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the import to be rejected");
    expect(result.diagnostic.code).toBe("import_not_allowed");
    expect(worker.getSnapshot()).toBeNull();

    await worker.close();
  });

  test("turns render exceptions into bounded terminal-safe diagnostics", async () => {
    const worker = createWorkerRuntime({ generation: 17 });
    const result = await worker.render(`
export function Broken() {
  throw new Error('\u001b[31m${"x".repeat(500)}')
}

<Broken />
`);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rendering to fail");
    expect(result.diagnostic.code).toBe("render_failed");
    expect(result.diagnostic.message).not.toContain("\u001b");
    expect(result.diagnostic.message.length).toBeLessThanOrEqual(256);

    await worker.close();
  });
});
