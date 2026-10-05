import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

import { catalogEntries } from "../catalog/index.ts";
import { SandboxUnavailable } from "../runner/errors.ts";
import { verifySandboxAvailability } from "../runner/availability.ts";
import { createRuntimeBackend, type RuntimeBackend } from "./runtime-backend.ts";
import { canvasServerInstructions, canvasToolDescriptions } from "./guidance.ts";
import {
  createToolHandlers,
  toolInputSchemas,
  toolNames,
  type CanvasToolsBackend,
} from "./tools.ts";

let runtimeBackend: Promise<RuntimeBackend> | undefined;
const getBackend = async () => {
  runtimeBackend ??= verifySandboxAvailability().then(createRuntimeBackend);
  return (await runtimeBackend).backend;
};

const backend: CanvasToolsBackend = {
  async open(input) {
    return (await getBackend()).open(input);
  },
  async setLayout(input) {
    return (await getBackend()).setLayout(input);
  },
  async upsert(input) {
    return (await getBackend()).upsert(input);
  },
  async patch(input) {
    return (await getBackend()).patch(input);
  },
  async remove(input) {
    return (await getBackend()).remove(input);
  },
  async setData(input) {
    return (await getBackend()).setData(input);
  },
  async catalog() {
    return { components: catalogEntries };
  },
  async requestInput(input) {
    return (await getBackend()).requestInput(input);
  },
  async complete() {
    return (await getBackend()).complete();
  },
  async close() {
    if (runtimeBackend === undefined) return { status: "closed" };
    const runtime = await runtimeBackend.catch(() => undefined);
    return runtime === undefined ? { status: "closed" } : runtime.backend.close();
  },
};

const handlers = createToolHandlers(backend);
const server = new McpServer(
  { name: "herdr-terminal-canvas", version: "0.1.0" },
  { instructions: canvasServerInstructions },
);

for (const name of toolNames) {
  server.registerTool(
    name,
    {
      description: canvasToolDescriptions[name],
      inputSchema: toolInputSchemas[name],
    },
    async (input: unknown) => {
      try {
        const result = await handlers[name](input);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        const payload = error instanceof SandboxUnavailable
          ? { code: error.code, reason: error.reason }
          : { code: "invalid_request" };
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        };
      }
    },
  );
}

BunRuntime.runMain(
  Effect.tryPromise(() =>
    server.connect(new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 1_048_576,
    })),
  ),
);

let disposing = false;
const dispose = (): void => {
  if (disposing) return;
  disposing = true;
  const cleanup = runtimeBackend === undefined
    ? Promise.resolve()
    : runtimeBackend.then((runtime) => runtime.dispose()).catch(() => undefined);
  void cleanup.finally(() => process.exit(0));
};
process.once("SIGTERM", dispose);
process.once("SIGINT", dispose);
process.stdin.once("end", dispose);
process.stdin.once("close", dispose);
