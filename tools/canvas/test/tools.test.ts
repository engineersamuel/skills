import { describe, expect, test } from "bun:test";

import { createToolHandlers, toolNames, type CanvasToolsBackend } from "../src/broker/tools.ts";

const createBackend = () => {
  const calls: [string, unknown][] = [];
  const backend: CanvasToolsBackend = {
    async open(input) { calls.push(["open", input]); return { sessionId: "session" }; },
    async setLayout(input) { calls.push(["set_layout", input]); return { revision: 1 }; },
    async upsert(input) { calls.push(["upsert", input]); return { revision: 2 }; },
    async patch(input) { calls.push(["patch", input]); return { revision: 3 }; },
    async remove(input) { calls.push(["remove", input]); return { revision: 4 }; },
    async setData(input) { calls.push(["set_data", input]); return { revision: 5 }; },
    async catalog() { calls.push(["catalog", {}]); return { components: [] }; },
    async requestInput(input) { calls.push(["request_input", input]); return { value: "yes" }; },
    async complete() { calls.push(["complete", {}]); return { visible: true }; },
    async close() { calls.push(["close", {}]); return { closed: true }; },
  };
  return { backend, calls };
};

describe("canvas MCP tools", () => {
  test("exports the complete fixed tool surface", () => {
    expect(toolNames).toEqual([
      "canvas.open",
      "canvas.set_layout",
      "canvas.upsert",
      "canvas.patch",
      "canvas.remove",
      "canvas.set_data",
      "canvas.catalog",
      "canvas.request_input",
      "canvas.complete",
      "canvas.close",
    ]);
  });

  test("validates inputs and never accepts pane ids, commands, or socket paths", async () => {
    const { backend, calls } = createBackend();
    const handlers = createToolHandlers(backend);

    await expect(handlers["canvas.open"]({ template: "delivery" })).resolves.toEqual({ sessionId: "session" });
    await expect(
      handlers["canvas.open"]({ template: "delivery", paneId: "attacker" }),
    ).rejects.toThrow();
    expect(calls).toEqual([["open", { template: "delivery" }]]);
  });

  test("rejects invalid component and dataset payloads before backend mutation", async () => {
    const { backend, calls } = createBackend();
    const handlers = createToolHandlers(backend);

    await expect(handlers["canvas.upsert"]({ id: "", component: "Callout", props: {} })).rejects.toThrow();
    await expect(handlers["canvas.set_data"]({ key: "data", value: () => 1 })).rejects.toThrow();
    await expect(
      handlers["canvas.set_data"]({ key: "data.canvas", value: {} }),
    ).rejects.toThrow("Use the dataset name only");
    expect(calls).toEqual([]);
  });
});
