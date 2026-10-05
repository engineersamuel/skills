import { z } from "zod";

import type { CanvasNode, WorkerHandle, WorkerLauncher } from "../broker/session.ts";
import { FrameDecoder, encodeFrame } from "../protocol/frame.ts";
import { validateTree, type CallbackHandle } from "../protocol/tree.ts";
import type { JsonValue } from "../security/sanitize.ts";
import { WORKER_LIVENESS_TIMEOUT_MS, type SpawnedWorker } from "./lifecycle.ts";

const HEARTBEAT_INTERVAL_MS = Math.floor(WORKER_LIVENESS_TIMEOUT_MS / 2);
const MAX_WORKER_STDERR_BYTES = 64 * 1024;
const MAX_WORKER_STDOUT_BYTES_PER_SECOND = 4 * 1024 * 1024;

export class WorkerOutputBudget {
  readonly #maxBytes: number;
  readonly #windowMs: number;
  #windowStartedAt: number | undefined;
  #bytes = 0;

  constructor(maxBytes: number, windowMs: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new RangeError("Worker output budget must use positive integers");
    }
    this.#maxBytes = maxBytes;
    this.#windowMs = windowMs;
  }

  accept(now: number, bytes: number): boolean {
    if (this.#windowStartedAt === undefined || now - this.#windowStartedAt >= this.#windowMs) {
      this.#windowStartedAt = now;
      this.#bytes = 0;
    }
    this.#bytes += bytes;
    return this.#bytes <= this.#maxBytes;
  }
}

const replySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), requestId: z.string(), generation: z.number().int() }).strict(),
  z.object({
    type: z.literal("snapshot"),
    requestId: z.string().optional(),
    snapshot: z.object({
      generation: z.number().int().nonnegative(),
      revision: z.number().int().nonnegative(),
      tree: z.unknown(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("event_result"),
    requestId: z.string(),
    accepted: z.boolean(),
  }).strict(),
  z.object({ type: z.literal("closed"), requestId: z.string() }).strict(),
  z.object({ type: z.literal("heartbeat"), requestId: z.string() }).strict(),
  z.object({
    type: z.literal("diagnostic"),
    requestId: z.string().optional(),
    diagnostic: z.object({ code: z.string(), message: z.string() }).strict(),
  }).strict(),
]);

type Pending = {
  readonly expected: "ready" | "snapshot" | "event_result" | "closed" | "heartbeat";
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

export type WorkerSpawner = (generation: number) => SpawnedWorker;

export interface ValidatedWorkerSnapshot {
  readonly generation: number;
  readonly revision: number;
  readonly tree: CanvasNode;
}

export const validateWorkerSnapshot = (
  snapshot: { readonly generation: number; readonly revision: number; readonly tree: unknown },
  expectedGeneration: number,
  currentRevision: number,
): ValidatedWorkerSnapshot => {
  if (snapshot.generation !== expectedGeneration) throw new Error("Worker generation changed");
  if (snapshot.revision <= currentRevision) throw new Error("Worker snapshot revision did not increase");
  const tree = validateTree(snapshot.tree) as CanvasNode;
  const pending: CanvasNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    for (const value of Object.values(node.props)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "$type" in value &&
        value.$type === "callback" &&
        (value.generation !== expectedGeneration || value.revision !== snapshot.revision)
      ) {
        throw new Error("Worker callback handle does not match its committed snapshot");
      }
    }
    for (const child of node.children) if (typeof child !== "string") pending.push(child);
  }
  return { generation: snapshot.generation, revision: snapshot.revision, tree };
};

export class FramedWorkerLauncher implements WorkerLauncher {
  readonly #spawn: WorkerSpawner;

  constructor(spawn: WorkerSpawner) {
    this.#spawn = spawn;
  }

  async start(
    source: string,
    generation: number,
    datasets: Readonly<Record<string, unknown>> = {},
  ): Promise<WorkerHandle> {
    const client = new WorkerClient(this.#spawn(generation), generation);
    try {
      await client.initialize(datasets);
      await client.render(source);
      client.startHeartbeats();
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }
}

class WorkerClient implements WorkerHandle {
  readonly generation: number;
  readonly #worker: SpawnedWorker;
  readonly #decoder = new FrameDecoder({ maxFrameBytes: 1_048_576, partialFrameTimeoutMs: 2_000 });
  readonly #pending = new Map<string, Pending>();
  readonly #listeners = new Set<() => void>();
  #requestNumber = 0;
  #revision = 0;
  #tree: CanvasNode | undefined;
  #closed = false;
  #terminated = false;
  #failure: string | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #heartbeatPending = false;

  constructor(worker: SpawnedWorker, generation: number) {
    this.#worker = worker;
    this.generation = generation;
    void this.#readOutput();
    void this.#drainStderr();
    void worker.terminated.then((termination) => {
      this.#terminated = true;
      this.#stopHeartbeats();
      if (!this.#closed) this.#markFailure(`Worker terminated: ${termination.reason}`);
      this.#failPending(new Error(`Worker terminated: ${termination.reason}`));
    });
  }

  get firstTree(): CanvasNode {
    return this.currentTree();
  }

  currentTree(): CanvasNode {
    if (this.#tree === undefined) throw new Error("Worker has not rendered a tree");
    return this.#tree;
  }

  diagnostic(): string | undefined {
    return this.#failure;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize(datasets: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#request("ready", {
      type: "init",
      requestId: this.#nextRequestId(),
      generation: this.generation,
      datasets: datasets as Readonly<Record<string, JsonValue>>,
    });
  }

  startHeartbeats(): void {
    if (this.#heartbeatTimer !== undefined || this.#closed) return;
    this.#heartbeatTimer = setInterval(() => {
      if (this.#heartbeatPending || this.#closed) return;
      this.#heartbeatPending = true;
      void this.#request("heartbeat", {
        type: "heartbeat",
        requestId: this.#nextRequestId(),
      }).catch(() => undefined).finally(() => {
        this.#heartbeatPending = false;
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  async render(source: string): Promise<void> {
    await this.#request("snapshot", {
      type: "render",
      requestId: this.#nextRequestId(),
      source,
    });
  }

  async setData(key: string, value: unknown): Promise<void> {
    await this.#request("snapshot", {
      type: "set_data",
      requestId: this.#nextRequestId(),
      key,
      value: value as JsonValue,
    });
  }

  async dispatchEvent(handle: CallbackHandle, payload?: unknown): Promise<boolean> {
    const reply = await this.#request("event_result", {
      type: "event",
      requestId: this.#nextRequestId(),
      handle,
      ...(payload === undefined ? {} : { payload: payload as JsonValue }),
    }) as { readonly accepted: boolean };
    return reply.accepted;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopHeartbeats();
    if (this.#terminated) {
      await this.#worker.close();
      return;
    }
    try {
      await Promise.race([
        this.#request("closed", { type: "close", requestId: this.#nextRequestId() }),
        this.#worker.terminated.then(() => { throw new Error("Worker terminated during close"); }),
      ]);
      await this.#worker.close();
    } catch {
      await this.#worker.close();
    }
  }

  async #request(expected: Pending["expected"], message: Record<string, unknown>): Promise<unknown> {
    const requestId = message.requestId;
    if (typeof requestId !== "string") throw new Error("Worker request id is missing");
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(requestId, { expected, resolve, reject });
    });
    try {
      this.#worker.stdin.write(encodeFrame(message));
      await this.#worker.stdin.flush();
    } catch (error) {
      this.#pending.delete(requestId);
      throw error;
    }
    return response;
  }

  async #readOutput(): Promise<void> {
    const outputBudget = new WorkerOutputBudget(MAX_WORKER_STDOUT_BYTES_PER_SECOND, 1_000);
    try {
      for await (const chunk of this.#worker.stdout) {
        if (!outputBudget.accept(Date.now(), chunk.byteLength)) throw new Error("Worker output limit exceeded");
        for (const raw of this.#decoder.push(chunk, Date.now())) this.#handleReply(raw);
      }
      if (!this.#closed) {
        this.#failPending(new Error("Worker output closed"));
        await this.#worker.close();
      }
    } catch {
      this.#markFailure("Worker protocol failed");
      this.#failPending(new Error("Worker protocol failed"));
      await this.#worker.close();
    }
  }

  #handleReply(raw: unknown): void {
    const reply = replySchema.parse(raw);
    let tree: CanvasNode | undefined;
    if (reply.type === "snapshot") {
      const snapshot = validateWorkerSnapshot(reply.snapshot, this.generation, this.#revision);
      this.#revision = snapshot.revision;
      tree = snapshot.tree;
      this.#tree = tree;
      this.#worker.markFirstRenderValidated();
      for (const listener of this.#listeners) listener();
    }
    if (reply.type === "diagnostic") {
      const error = new Error(`${reply.diagnostic.code}: ${reply.diagnostic.message}`);
      if (reply.requestId === undefined) {
        this.#failPending(error);
      } else {
        this.#pending.get(reply.requestId)?.reject(error);
        this.#pending.delete(reply.requestId);
      }
      return;
    }
    if (reply.requestId === undefined) return;
    const pending = this.#pending.get(reply.requestId);
    if (pending === undefined || pending.expected !== reply.type) return;
    this.#worker.markHeartbeat();
    this.#pending.delete(reply.requestId);
    pending.resolve(tree ?? reply);
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #markFailure(message: string): void {
    if (this.#failure !== undefined) return;
    this.#failure = message;
    for (const listener of this.#listeners) listener();
  }

  async #drainStderr(): Promise<void> {
    let bytes = 0;
    try {
      for await (const chunk of this.#worker.stderr) {
        bytes += chunk.byteLength;
        if (bytes > MAX_WORKER_STDERR_BYTES) {
          this.#markFailure("Worker stderr limit exceeded");
          this.#failPending(new Error("Worker stderr limit exceeded"));
          await this.#worker.close();
          return;
        }
      }
    } catch {
      this.#markFailure("Worker stderr failed");
      await this.#worker.close();
    }
  }

  #stopHeartbeats(): void {
    if (this.#heartbeatTimer === undefined) return;
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
  }

  #nextRequestId(): string {
    this.#requestNumber += 1;
    return `req-${this.#requestNumber}`;
  }
}
