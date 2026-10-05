import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const runtime = realpathSync(
  process.env.CANVAS_RUNTIME_BUNDLE ?? join(repositoryRoot, "generated/runtime-darwin-arm64"),
);
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
environment.CANVAS_RUNTIME_BUNDLE = runtime;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repositoryRoot, "src/broker/main.ts")],
  cwd: repositoryRoot,
  env: environment,
  stderr: "pipe",
  maxBufferSize: 1_048_576,
});
const client = new Client({ name: "canvas-live-showcase", version: "1.0.0" });

const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`Canvas tool failed: ${name}`);
  return result.structuredContent ?? result.content;
};

const layout = `
import { useState } from 'react'
import { Graph, GraphMeter, GraphTimeline, GraphCheck, Callout } from '@canvas/runtime'

export function HarnessCanvas() {
  const [inspections, setInspections] = useState(0)
  const run = data.run ?? {}
  return <Graph title="Harness pressure test">
    <h1>{run.phase ?? 'Preparing run'}</h1>
    <GraphMeter value={run.progress ?? 0} caption={run.summary ?? 'Waiting for activity'} />
    <GraphTimeline title="Recent activity" items={run.events ?? []} />
    <GraphCheck title="Verification" items={run.checks ?? []} />
    <Callout title="Live interaction">
      <p>Document controls retain React state while datasets stream.</p>
      <button onClick={() => setInspections(value => value + 1)}>Inspections: {inspections}</button>
    </Callout>
  </Graph>
}

<HarnessCanvas />
`;

const phases = [
  ["Inspecting repository", "Mapping broker, worker, and renderer boundaries"],
  ["Compiling MDX", "Building the candidate document in the sandbox"],
  ["Streaming datasets", "Coalescing harness activity into live revisions"],
  ["Checking interactions", "Preserving React state and callback generations"],
  ["Verifying containment", "Confirming the sandbox and watchdog remain healthy"],
] as const;

let closed = false;
const close = async (): Promise<void> => {
  if (closed) return;
  closed = true;
  await call("canvas.close", {}).catch(() => undefined);
  await client.close().catch(() => undefined);
};

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

try {
  await client.connect(transport);
  await call("canvas.open", { template: "blank" });
  await call("canvas.set_layout", { mdx: layout });

  const events: Array<{ step: number; activity: string }> = [];
  for (const [index, [phase, summary]] of phases.entries()) {
    events.unshift({ step: index + 1, activity: summary });
    await call("canvas.set_data", {
      key: "run",
      value: {
        phase,
        summary,
        progress: (index + 1) / (phases.length + 1),
        events: events.slice(0, 5),
        checks: [
          { name: "sandbox", status: index >= 1 ? "passed" : "running" },
          { name: "live updates", status: index >= 2 ? "passed" : "pending" },
          { name: "callbacks", status: index >= 3 ? "passed" : "pending" },
          { name: "trusted input", status: "waiting" },
        ],
      },
    });
    await Bun.sleep(350);
  }

  const response = await call("canvas.request_input", {
    prompt: "The live-update pressure test reached its decision point. Continue to final verification?",
    options: ["Continue", "Stop"],
  }) as { value?: string };
  const continued = response.value === "Continue";
  events.unshift({
    step: phases.length + 1,
    activity: continued ? "User approved final verification" : "User stopped the run",
  });
  await call("canvas.set_data", {
    key: "run",
    value: {
      phase: continued ? "Pressure test complete" : "Stopped by user",
      summary: continued
        ? "Live updates, callbacks, and trusted input completed"
        : "The canvas preserved the last committed state",
      progress: continued ? 1 : phases.length / (phases.length + 1),
      events: events.slice(0, 5),
      checks: [
        { name: "sandbox", status: "passed" },
        { name: "live updates", status: "passed" },
        { name: "callbacks", status: "passed" },
        { name: "trusted input", status: continued ? "passed" : "stopped" },
      ],
    },
  });
  await call("canvas.complete", {});
  process.stdout.write("Canvas showcase complete. Press Ctrl-C to close it.\n");
  await new Promise<void>(() => undefined);
} catch (error) {
  await close();
  throw error;
}
