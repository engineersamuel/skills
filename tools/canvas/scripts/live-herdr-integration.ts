import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const runtime = realpathSync(process.env.CANVAS_RUNTIME_BUNDLE ?? join(import.meta.dir, "../generated/runtime-darwin-arm64"));

const paneIds = (): Set<string> => {
  const result = Bun.spawnSync({ cmd: ["herdr", "pane", "list"], stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Unable to list Herdr panes");
  const parsed = JSON.parse(result.stdout.toString()) as { result?: { panes?: Array<{ pane_id?: unknown }> } };
  return new Set((parsed.result?.panes ?? []).flatMap((pane) => typeof pane.pane_id === "string" ? [pane.pane_id] : []));
};

const readPaneText = (paneId: string): string => Bun.spawnSync({
  cmd: ["herdr", "pane", "read", paneId, "--source", "recent-unwrapped", "--format", "text"],
  stdout: "pipe",
  stderr: "pipe",
}).stdout.toString();

const searchablePaneText = (text: string): string =>
  text.replace(/[^\p{L}\p{N}%]+/gu, " ").replace(/\s+/gu, " ").trim();

const containsPaneText = (text: string, match: string): boolean =>
  text.includes(match) || searchablePaneText(text).includes(searchablePaneText(match));

const waitForPaneText = async (paneId: string, match: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const read = Bun.spawnSync({
      cmd: ["herdr", "pane", "read", paneId, "--source", "recent-unwrapped", "--format", "text"],
      stdout: "pipe",
      stderr: "pipe",
    });
    lastText = read.stdout.toString();
    if (read.exitCode === 0 && containsPaneText(lastText, match)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(match)} in pane ${paneId}: ${JSON.stringify(lastText)}`);
};

const childProcessIds = (parentPid: number): number[] => {
  const result = Bun.spawnSync({ cmd: ["ps", "-ax", "-o", "pid=,ppid="], stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().split("\n").flatMap((line) => {
    const [pid, ppid] = line.trim().split(/\s+/u).map(Number);
    return Number.isSafeInteger(pid) && ppid === parentPid ? [pid!] : [];
  });
};

const waitForProcessExit = async (pid: number, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Process ${pid} remained alive after broker termination`);
};

const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<unknown> => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`MCP tool failed: ${name}: ${JSON.stringify(result.content)}`);
  return result;
};

const before = paneIds();
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
environment.CANVAS_RUNTIME_BUNDLE = runtime;
environment.CANVAS_DISCONNECT_GRACE_MS = "750";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(import.meta.dir, "../src/broker/main.ts")],
  cwd: join(import.meta.dir, ".."),
  env: environment,
  stderr: "pipe",
  maxBufferSize: 1_048_576,
});
const client = new Client({ name: "canvas-live-integration", version: "1.0.0" });
let brokerStderr = "";
transport.stderr?.on("data", (chunk) => {
  brokerStderr = `${brokerStderr}${String(chunk)}`.slice(-65_536);
});

try {
  await client.connect(transport);
  await call(client, "canvas.open", { template: "blank" });
  const created = [...paneIds()].filter((id) => !before.has(id));
  if (created.length !== 1) throw new Error(`Expected one canvas pane, found ${created.length}`);
  let paneId = created[0]!;

  await call(client, "canvas.set_layout", {
    mdx: `
import { useState } from 'react'
import { Graph, GraphMeter, GraphTimeline, GraphCheck } from '@canvas/runtime'
export function Live() {
  const [count, setCount] = useState(0)
  const run = data.run ?? {}
  return <>
    <h1>Harness run</h1>
    <Graph title="Execution">
      <GraphMeter value={run.progress ?? 0} caption={run.phase ?? 'waiting'} />
      <p>State: {run.phase ?? 'waiting'}</p>
      <button onClick={() => setCount(value => value + 1)}>Interactions: {count}</button>
    </Graph>
    <GraphTimeline title="Recent activity" items={run.events ?? []} />
    <GraphCheck title="Checks" items={run.checks ?? []} />
  </>
}

<Live />
`,
  });
  await call(client, "canvas.set_data", {
    key: "run",
    value: {
      progress: 0,
      phase: "starting",
      events: [{ step: 0, activity: "broker connected" }],
      checks: [{ name: "sandbox", status: "pending" }],
    },
  });
  await waitForPaneText(paneId, "starting");
  let paneText = readPaneText(paneId);
  if (!paneText.includes("starting") || !paneText.includes("Interactions: 0")) {
    throw new Error(`Live renderer did not display the stateful dataset fixture: ${JSON.stringify(paneText)}`);
  }

  Bun.spawnSync({ cmd: ["herdr", "pane", "send-keys", paneId, "Enter"] });
  await waitForPaneText(paneId, "Interactions: 1");
  paneText = readPaneText(paneId);
  if (!paneText.includes("Interactions: 1")) throw new Error("Document callback did not update the live canvas");

  const updateStartedAt = Date.now();
  for (let step = 1; step <= 24; step += 1) {
    await call(client, "canvas.set_data", {
      key: "run",
      value: {
        progress: step / 24,
        phase: step === 24 ? "verification complete" : `running check ${step}`,
        events: Array.from({ length: Math.min(step, 6) }, (_, index) => ({
          step: step - index,
          activity: `completed operation ${step - index}`,
        })),
        checks: [
          { name: "sandbox", status: "passed" },
          { name: "renderer", status: step === 24 ? "passed" : "running" },
          { name: "input", status: step === 24 ? "ready" : "pending" },
        ],
      },
    });
  }
  await waitForPaneText(paneId, "verification complete");
  paneText = readPaneText(paneId);
  if (!paneText.includes("100%") || !paneText.includes("Interactions: 1")) {
    throw new Error(`Burst updates lost the final state or reset React state: ${JSON.stringify(paneText)}`);
  }
  if (Date.now() - updateStartedAt > 5_000) {
    throw new Error("Burst dataset updates exceeded the live-update pressure-test budget");
  }

  const hangStartedAt = Date.now();
  let hangingLayoutRejected = false;
  try {
    await call(client, "canvas.set_layout", {
      mdx: "export function Hang() { while (true) {} }\n\n<Hang />",
    });
  } catch {
    hangingLayoutRejected = true;
  }
  if (!hangingLayoutRejected || Date.now() - hangStartedAt > 7_000) {
    throw new Error("Infinite JavaScript was not contained by the candidate worker startup watchdog");
  }
  paneText = readPaneText(paneId);
  if (!paneText.includes("Interactions: 1")) throw new Error("Failed layout replacement did not preserve the last valid display");

  const interruptedDecision = call(client, "canvas.request_input", {
    prompt: "Interrupt this decision?",
    options: ["Continue", "Stop"],
  });
  await waitForPaneText(paneId, "Interrupt this decision?");
  const manualClose = Bun.spawnSync({ cmd: ["herdr", "pane", "close", paneId], stdout: "pipe", stderr: "pipe" });
  if (manualClose.exitCode !== 0 || paneIds().has(paneId)) throw new Error("Manual canvas pane closure failed");
  let interruptedDecisionCancelled = false;
  try {
    await interruptedDecision;
  } catch {
    interruptedDecisionCancelled = true;
  }
  if (!interruptedDecisionCancelled) throw new Error("Manual pane closure did not cancel the pending decision");
  const beforeReopen = paneIds();
  await call(client, "canvas.open", { template: "blank" });
  const reopened = [...paneIds()].filter((id) => !beforeReopen.has(id));
  if (reopened.length !== 1) throw new Error(`Expected one explicitly reopened pane, found ${reopened.length}`);
  paneId = reopened[0]!;
  await waitForPaneText(paneId, "Interactions: 1");
  paneText = readPaneText(paneId);
  if (!containsPaneText(paneText, "verification complete") || !containsPaneText(paneText, "Interactions: 1")) {
    throw new Error(`Explicit reopen did not preserve the healthy canvas session: ${JSON.stringify(paneText)}`);
  }

  const decision = call(client, "canvas.request_input", { prompt: "Ship this canvas?", options: ["Ship", "Hold"] });
  await waitForPaneText(paneId, "Ship this canvas?");
  Bun.spawnSync({ cmd: ["herdr", "pane", "send-keys", paneId, "Right", "Enter"] });
  const decisionResult = JSON.stringify(await decision);
  if (!decisionResult.includes("Hold")) throw new Error("Trusted request_input did not resolve the selected PTY choice");

  await call(client, "canvas.complete", {});
  await call(client, "canvas.close", {});
  if (paneIds().has(paneId)) throw new Error("Owned canvas pane remained after close");

  const beforeCrashOpen = paneIds();
  await call(client, "canvas.open", { template: "blank" });
  const crashPanes = [...paneIds()].filter((id) => !beforeCrashOpen.has(id));
  if (crashPanes.length !== 1) throw new Error(`Expected one crash-test pane, found ${crashPanes.length}`);
  paneId = crashPanes[0]!;
  await waitForPaneText(paneId, "CONNECTED");
  const brokerPid = transport.pid;
  if (brokerPid === null) throw new Error("MCP transport did not expose the broker process id");
  const workerPids = childProcessIds(brokerPid);
  if (workerPids.length === 0) {
    const processes = Bun.spawnSync({ cmd: ["ps", "-ax", "-o", "pid=,ppid=,command="], stdout: "pipe" }).stdout.toString();
    throw new Error(`Broker had no sandbox worker child before crash test: broker=${brokerPid}\n${processes.split("\n").filter((line) => line.includes("canvas-worker-") || line.includes("worker.js") || line.includes(String(brokerPid))).join("\n")}`);
  }
  process.kill(brokerPid, "SIGKILL");
  await Promise.all(workerPids.map((pid) => waitForProcessExit(pid)));
  await waitForPaneText(paneId, "Broker connection lost");
  await Bun.sleep(1_000);
  const marker = `canvas-renderer-exited-${Date.now()}`;
  const markerSend = Bun.spawnSync({ cmd: ["herdr", "pane", "run", paneId, `echo ${marker}`], stdout: "pipe", stderr: "pipe" });
  if (markerSend.exitCode !== 0) throw new Error("Unable to probe renderer exit after broker crash");
  await waitForPaneText(paneId, marker, 2_000);
  Bun.spawnSync({ cmd: ["herdr", "pane", "close", paneId], stdout: "pipe", stderr: "pipe" });

  const disconnectTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dir, "../src/broker/main.ts")],
    cwd: join(import.meta.dir, ".."),
    env: environment,
    stderr: "pipe",
    maxBufferSize: 1_048_576,
  });
  const disconnectClient = new Client({ name: "canvas-host-disconnect", version: "1.0.0" });
  const beforeDisconnectOpen = paneIds();
  await disconnectClient.connect(disconnectTransport);
  await call(disconnectClient, "canvas.open", { template: "blank" });
  const disconnectPanes = [...paneIds()].filter((id) => !beforeDisconnectOpen.has(id));
  if (disconnectPanes.length !== 1) throw new Error(`Expected one host-disconnect pane, found ${disconnectPanes.length}`);
  const disconnectPane = disconnectPanes[0]!;
  await waitForPaneText(disconnectPane, "CONNECTED");
  const disconnectBrokerPid = disconnectTransport.pid;
  if (disconnectBrokerPid === null) throw new Error("Host-disconnect broker pid was unavailable");
  const disconnectWorkerPids = childProcessIds(disconnectBrokerPid);
  const disconnectStartedAt = Date.now();
  await disconnectClient.close();
  if (Date.now() - disconnectStartedAt >= 1_500) throw new Error("Broker did not react directly to host stdin closure");
  await waitForProcessExit(disconnectBrokerPid);
  await Promise.all(disconnectWorkerPids.map((pid) => waitForProcessExit(pid)));
  if (paneIds().has(disconnectPane)) throw new Error("Host disconnect left the owned canvas pane open");
  process.stdout.write("live_herdr_integration_ready\n");
} finally {
  await client.close().catch(() => undefined);
  if (brokerStderr.length > 0) process.stderr.write(brokerStderr);
}
