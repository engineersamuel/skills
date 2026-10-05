import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

import { RendererSocketServer } from "../src/broker/renderer-socket.ts";
import { connectRendererClient } from "../src/renderer/client.ts";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const scratchSocket = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-renderer-test-"));
  scratchDirectories.push(directory);
  return join(directory, "renderer.sock");
};

describe("authenticated renderer socket", () => {
  test("rejects a wrong token without exposing the current snapshot", async () => {
    const socketPath = await scratchSocket();
    const server = new RendererSocketServer({
      socketPath,
      token: "correct",
      initialState: { status: "connected", diagnostic: "private" },
    });
    await server.start();
    const states: unknown[] = [];

    const client = connectRendererClient({
      socketPath,
      token: "wrong",
      onState: (state) => states.push(state),
    });
    await client.closed;

    expect(states).toEqual([]);
    await server.close();
  });

  test("sends a fresh snapshot, revisioned updates, and genuine decisions", async () => {
    const socketPath = await scratchSocket();
    const decisions: unknown[] = [];
    const server = new RendererSocketServer({
      socketPath,
      token: "secret",
      initialState: { status: "disconnected", diagnostic: "starting" },
      onDecision: (decision) => decisions.push(decision),
    });
    await server.start();
    const states: unknown[] = [];
    let resolveSecondState: () => void = () => undefined;
    const secondState = new Promise<void>((resolve) => {
      resolveSecondState = resolve;
    });
    const client = connectRendererClient({
      socketPath,
      token: "secret",
      onState: (state) => {
        states.push(state);
        if (states.length === 2) resolveSecondState();
      },
    });

    await client.connected;
    server.publish({ status: "connected", diagnostic: "ready" });
    await secondState;
    client.choose("request-1", "Ship");
    await Bun.sleep(10);

    expect(states).toEqual([
      { revision: 0, state: { status: "disconnected", diagnostic: "starting" } },
      { revision: 1, state: { status: "connected", diagnostic: "ready" } },
    ]);
    expect(decisions).toEqual([{ requestId: "request-1", value: "Ship" }]);

    client.close();
    await client.closed;
    await server.close();
  });

  test("disconnects active renderer clients when the broker closes", async () => {
    const socketPath = await scratchSocket();
    let disconnects = 0;
    const server = new RendererSocketServer({
      socketPath,
      token: "secret",
      initialState: { status: "connected" },
      onDisconnect: () => {
        disconnects += 1;
      },
    });
    await server.start();
    const client = connectRendererClient({
      socketPath,
      token: "secret",
      onState: () => undefined,
    });
    await client.connected;

    await server.close();

    await client.closed;
    expect(disconnects).toBe(1);
  });

  test("forwards schema-validated document callback events", async () => {
    const socketPath = await scratchSocket();
    const events: unknown[] = [];
    const server = new RendererSocketServer({
      socketPath,
      token: "secret",
      initialState: { status: "connected" },
      onEvent: (event) => events.push(event),
    });
    await server.start();
    const client = connectRendererClient({ socketPath, token: "secret", onState: () => undefined });
    await client.connected;
    const handle = { $type: "callback" as const, generation: 2, revision: 7, id: "click-1" };

    client.dispatch(handle, { key: "Enter" });
    await Bun.sleep(10);

    expect(events).toEqual([{ handle, payload: { key: "Enter" } }]);
    client.close();
    await client.closed;
    await server.close();
  });

  test("closes an unauthenticated idle connection after the frame deadline", async () => {
    const socketPath = await scratchSocket();
    const server = new RendererSocketServer({
      socketPath,
      token: "secret",
      initialState: { status: "connected" },
    });
    await server.start();
    const socket = createConnection(socketPath);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await Promise.race([
      new Promise<void>((resolve) => socket.once("close", () => resolve())),
      Bun.sleep(2_500).then(() => { throw new Error("idle renderer connection remained open"); }),
    ]);
    await server.close();
  }, 4_000);
});
