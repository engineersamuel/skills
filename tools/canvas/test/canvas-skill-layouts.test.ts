import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cellWidth } from "../src/renderer/cells.ts";
import { formatNode } from "../src/renderer/format.ts";
import { validateTree } from "../src/protocol/tree.ts";
import type { JsonValue } from "../src/security/sanitize.ts";
import { createWorkerRuntime, type WorkerTreeNode } from "../src/worker/runtime.ts";

const skillRoot = join(import.meta.dir, "../../../skills/herdr-canvas");

const readLayout = (name: "planning" | "delivery" | "debug"): Promise<string> =>
  readFile(join(skillRoot, "layouts", `${name}.mdx`), "utf8");

const renderLayout = async (
  name: "planning" | "delivery" | "debug",
  canvas?: Record<string, JsonValue>,
) => {
  const worker = createWorkerRuntime({
    generation: 1,
    datasets: canvas === undefined ? {} : { canvas },
  });
  const result = await worker.render(await readLayout(name));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return { worker, snapshot: result.snapshot };
};

const expectWidths = (tree: WorkerTreeNode): void => {
  const validated = validateTree(tree);
  for (const width of [31, 80]) {
    const lines = formatNode(validated, width);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => cellWidth(line) <= width)).toBe(true);
  }
};

const formattedText = (tree: WorkerTreeNode, width = 80): string =>
  formatNode(validateTree(tree), width).join("\n");

describe("packaged herdr-canvas layouts", () => {
  test("render guarded empty states at narrow and wide widths", async () => {
    for (const name of ["planning", "delivery", "debug"] as const) {
      const { worker, snapshot } = await renderLayout(name);
      expect(formattedText(snapshot.tree)).toContain("CURRENT ACTIVITY");
      expectWidths(snapshot.tree);
      await worker.close();
    }
  });

  test("updates delivery evidence without replacing the document", async () => {
    const initial = {
      title: "Canvas integration",
      phase: "working",
      activity: "Adding layout tests",
      steps: [{ id: "layouts", label: "Test layouts", status: "running" }],
      findings: ["MCP guidance is complete."],
      checks: [],
      events: [{ summary: "Started layout implementation." }],
      decisions: [],
      changes: [{ path: "skills/herdr-canvas", summary: "Added portable resources." }],
    };
    const { worker } = await renderLayout("delivery", initial);
    const updated = await worker.setData("canvas", {
      ...initial,
      phase: "complete",
      activity: "Layout tests passed",
      steps: [{ id: "layouts", label: "Test layouts", status: "passed" }],
      findings: [...initial.findings, "All three layouts preserve bounded rendering."],
      checks: [{ name: "Layout tests", status: "passed", evidence: "3 layouts" }],
      events: [...initial.events, { summary: "Verified narrow and wide rendering." }],
    });
    expect(updated.ok).toBe(true);
    const snapshot = worker.getSnapshot();
    if (snapshot === null) throw new Error("expected updated snapshot");
    const text = formattedText(snapshot.tree);
    expect(text).toContain("MCP guidance is complete.");
    expect(text).toContain("All three layouts preserve bounded rendering.");
    expect(text).toContain("Layout tests passed");
    expectWidths(snapshot.tree);
    await worker.close();
  });

  test("shows planning options and unresolved decisions", async () => {
    const { worker, snapshot } = await renderLayout("planning", {
      title: "Plan recovery",
      phase: "planning",
      activity: "Comparing persistence options",
      steps: [{ id: "compare", label: "Compare options", status: "running" }],
      findings: ["Restart recovery needs durable attempt state."],
      checks: [],
      events: [],
      decisions: [{ question: "Persist each attempt?" }],
      options: [{ label: "Persist attempts", tradeoff: "One durable write per attempt." }],
    });
    const text = formattedText(snapshot.tree);
    expect(text).toContain("Persist attempts");
    expect(text).toContain("unresolved");
    expectWidths(snapshot.tree);
    await worker.close();
  });

  test("shows supported, ruled out, failed, and blocked debugging states", async () => {
    const { worker, snapshot } = await renderLayout("debug", {
      title: "Retry failure",
      phase: "blocked",
      activity: "Waiting for a reproducible fixture",
      steps: [{ id: "repro", label: "Reproduce failure", status: "blocked" }],
      findings: ["The current fixture does not persist the attempt count."],
      checks: [{ name: "Focused test", status: "failed", evidence: "Expected 2, received 0" }],
      events: [],
      decisions: [],
      hypotheses: [
        { label: "Attempt count resets", status: "supported", evidence: "Reload reads zero." },
        { label: "Timer fires twice", status: "ruled_out", evidence: "One timer event observed." },
      ],
    });
    const text = formattedText(snapshot.tree);
    expect(text).toContain("BLOCKED");
    expect(text).toContain("supported");
    expect(text).toContain("ruled_out");
    expect(text).toContain("Expected 2, received 0");
    expectWidths(snapshot.tree);
    await worker.close();
  });
});
