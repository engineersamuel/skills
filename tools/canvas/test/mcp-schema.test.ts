import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

import {
  canvasServerInstructions,
  canvasToolDescriptions,
} from "../src/broker/guidance.ts";
import { toolNames } from "../src/broker/tools.ts";

let client: Client | undefined;

afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = undefined;
});

describe("published MCP tool schemas", () => {
  test("advertises concrete named arguments to Copilot", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dir, "../src/broker/main.ts")],
      cwd: join(import.meta.dir, ".."),
      stderr: "pipe",
    });
    client = new Client({ name: "canvas-schema-test", version: "1.0.0" });
    await client.connect(transport);

    const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect(client.getInstructions()).toBe(canvasServerInstructions);
    expect(tools.size).toBe(toolNames.length);
    for (const name of toolNames) {
      expect(tools.get(name)?.description).toBe(canvasToolDescriptions[name]);
      expect(tools.get(name)?.description).not.toContain("operation:");
    }

    expect(tools.get("canvas.open")?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        template: { type: "string", enum: ["delivery", "architecture", "debug", "blank"] },
      },
      required: ["template"],
      additionalProperties: false,
    });
    expect(tools.get("canvas.set_data")?.inputSchema).toMatchObject({
      type: "object",
      properties: { key: { type: "string" }, value: {} },
      required: ["key", "value"],
      additionalProperties: false,
    });
    expect(tools.get("canvas.request_input")?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        prompt: { type: "string" },
        options: { type: "array" },
      },
      required: ["prompt", "options"],
      additionalProperties: false,
    });
  });
});
