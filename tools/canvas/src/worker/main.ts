import { once } from "node:events";

import { FrameDecoder, FrameError, encodeFrame } from "../protocol/frame.ts";
import type { JsonValue } from "../security/sanitize.ts";
import { sanitizeText } from "../security/sanitize.ts";
import { createWorkerRuntime } from "./runtime.ts";
import type {
  WorkerDiagnostic,
  WorkerEventHandle,
  WorkerRenderResult,
  WorkerRuntime,
  WorkerSnapshot,
} from "./types.ts";

const DEFAULT_MAX_FRAME_BYTES = 1_048_576;
const DEFAULT_PARTIAL_FRAME_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_PENDING_OUTPUT_FRAMES = 64;
const MAX_DIAGNOSTIC_LENGTH = 256;
const MAX_JSON_DEPTH = 64;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type WorkerProtocolDiagnosticCode =
  | "invalid_request"
  | "frame_too_large"
  | "partial_frame_timeout"
  | "invalid_json"
  | "decoder_closed"
  | "input_read_failed"
  | "output_frame_too_large"
  | "output_queue_full"
  | "output_write_failed";

export type WorkerProtocolDiagnostic = {
  readonly code: WorkerProtocolDiagnosticCode;
  readonly message: string;
};

export type WorkerProtocolRequest =
  | {
      readonly type: "init";
      readonly requestId: string;
      readonly generation: number;
      readonly datasets: Readonly<Record<string, JsonValue>>;
    }
  | { readonly type: "render"; readonly requestId: string; readonly source: string }
  | {
      readonly type: "set_data";
      readonly requestId: string;
      readonly key: string;
      readonly value: JsonValue;
    }
  | {
      readonly type: "event";
      readonly requestId: string;
      readonly handle: WorkerEventHandle;
      readonly payload?: JsonValue;
    }
  | { readonly type: "heartbeat"; readonly requestId: string }
  | { readonly type: "close"; readonly requestId: string };

export type WorkerProtocolReply =
  | { readonly type: "ready"; readonly requestId: string; readonly generation: number }
  | { readonly type: "snapshot"; readonly requestId?: string; readonly snapshot: WorkerSnapshot }
  | { readonly type: "event_result"; readonly requestId: string; readonly accepted: boolean }
  | { readonly type: "heartbeat"; readonly requestId: string }
  | { readonly type: "closed"; readonly requestId: string }
  | {
      readonly type: "diagnostic";
      readonly requestId?: string;
      readonly diagnostic: WorkerDiagnostic | WorkerProtocolDiagnostic;
    };

export type WorkerProtocolExit =
  | { readonly kind: "closed" }
  | { readonly kind: "input_closed" }
  | { readonly kind: "protocol_error"; readonly diagnostic: WorkerProtocolDiagnostic };

export type WorkerProtocolOptions = {
  readonly maxFrameBytes?: number;
  readonly partialFrameTimeoutMs?: number;
  readonly maxPendingOutputFrames?: number;
};

type OutputFrame = {
  frame: Uint8Array;
  queued: boolean;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

type ReadOutcome =
  | { readonly kind: "chunk"; readonly chunk: Uint8Array }
  | { readonly kind: "input_closed" }
  | { readonly kind: "failed"; readonly diagnostic: WorkerProtocolDiagnostic };

class WorkerProtocolFault extends Error {
  readonly diagnostic: WorkerProtocolDiagnostic;

  constructor(diagnostic: WorkerProtocolDiagnostic) {
    super(diagnostic.message);
    this.name = "WorkerProtocolFault";
    this.diagnostic = diagnostic;
  }
}

class BoundedFrameWriter {
  readonly #write: (frame: Uint8Array) => Promise<void>;
  readonly #maxFrameBytes: number;
  readonly #maxPendingFrames: number;
  #tail: Promise<void> = Promise.resolve();
  #pendingCount = 0;
  #lastQueuedSnapshot: OutputFrame | undefined;
  #hasFailure = false;
  #failure: unknown;

  constructor(
    write: (frame: Uint8Array) => Promise<void>,
    maxFrameBytes: number,
    maxPendingFrames: number,
  ) {
    this.#write = write;
    this.#maxFrameBytes = maxFrameBytes;
    this.#maxPendingFrames = maxPendingFrames;
  }

  enqueue(value: WorkerProtocolReply): Promise<void> {
    if (this.#hasFailure) throw this.#outputFailure();
    const frame = encodeFrame(value);
    if (frame.byteLength - 4 > this.#maxFrameBytes) {
      throw new WorkerProtocolFault({
        code: "output_frame_too_large",
        message: "Worker response exceeds the frame limit",
      });
    }

    const coalescesSnapshot = value.type === "snapshot" && !Object.hasOwn(value, "requestId");
    if (coalescesSnapshot && this.#lastQueuedSnapshot?.queued) {
      this.#lastQueuedSnapshot.frame = frame;
      return this.#lastQueuedSnapshot.promise;
    }
    if (this.#pendingCount >= this.#maxPendingFrames) {
      throw new WorkerProtocolFault({
        code: "output_queue_full",
        message: "Worker response queue exceeded its limit",
      });
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const output: OutputFrame = { frame, queued: true, promise, resolve, reject };
    this.#pendingCount += 1;
    if (coalescesSnapshot) this.#lastQueuedSnapshot = output;

    const writeTask = this.#tail.then(async () => {
      output.queued = false;
      if (this.#lastQueuedSnapshot === output) this.#lastQueuedSnapshot = undefined;
      if (this.#hasFailure) throw this.#failure;
      await this.#write(output.frame);
    });
    this.#tail = writeTask
      .then(
        () => output.resolve(),
        (error: unknown) => {
          this.#hasFailure = true;
          this.#failure = error;
          output.reject(error);
        },
      )
      .finally(() => {
        this.#pendingCount -= 1;
        if (this.#lastQueuedSnapshot === output) this.#lastQueuedSnapshot = undefined;
      });
    return promise;
  }

  async flush(): Promise<void> {
    await this.#tail;
    if (this.#hasFailure) throw this.#outputFailure();
  }

  #outputFailure(): WorkerProtocolFault {
    return new WorkerProtocolFault({
      code: "output_write_failed",
      message: "Could not write worker response",
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
};

const isJsonPrimitive = (value: unknown): boolean =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

const jsonChildren = (value: unknown): readonly unknown[] | undefined => {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? Object.values(value) : undefined;
};

const isJsonValue = (value: unknown): value is JsonValue => {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined || entry.depth > MAX_JSON_DEPTH) return false;
    if (isJsonPrimitive(entry.value)) continue;
    const children = jsonChildren(entry.value);
    if (children === undefined) return false;
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
  return true;
};

const isJsonRecord = (value: unknown): value is Record<string, JsonValue> =>
  isRecord(value) && Object.values(value).every(isJsonValue);

const isRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

const isWorkerEventHandle = (value: unknown): value is WorkerEventHandle => {
  if (!isRecord(value) || !hasExactKeys(value, ["$type", "generation", "revision", "id"])) {
    return false;
  }
  return value.$type === "callback" &&
    typeof value.generation === "number" &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0 &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.id === "string" &&
    REQUEST_ID_PATTERN.test(value.id);
};

const parseInitRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined => {
  if (!hasExactKeys(value, ["type", "requestId", "generation"], ["datasets"])) return undefined;
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0
  ) {
    return undefined;
  }
  const datasets = value.datasets === undefined ? {} : value.datasets;
  if (!isJsonRecord(datasets)) return undefined;
  return { type: "init", requestId, generation: value.generation, datasets };
};

const parseRenderRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined => {
  if (!hasExactKeys(value, ["type", "requestId", "source"])) return undefined;
  return typeof value.source === "string"
    ? { type: "render", requestId, source: value.source }
    : undefined;
};

const parseSetDataRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined => {
  if (!hasExactKeys(value, ["type", "requestId", "key", "value"])) return undefined;
  if (
    typeof value.key !== "string" ||
    value.key.length === 0 ||
    value.key.length > 128 ||
    !isJsonValue(value.value)
  ) {
    return undefined;
  }
  return { type: "set_data", requestId, key: value.key, value: value.value };
};

const parseEventRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined => {
  if (
    !hasExactKeys(value, ["type", "requestId", "handle"], ["payload"]) ||
    !isWorkerEventHandle(value.handle)
  ) {
    return undefined;
  }
  if (!Object.hasOwn(value, "payload")) {
    return { type: "event", requestId, handle: value.handle };
  }
  return isJsonValue(value.payload)
    ? { type: "event", requestId, handle: value.handle, payload: value.payload }
    : undefined;
};

const parseCloseRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined =>
  hasExactKeys(value, ["type", "requestId"]) ? { type: "close", requestId } : undefined;

const parseHeartbeatRequest = (
  value: Record<string, unknown>,
  requestId: string,
): WorkerProtocolRequest | undefined =>
  hasExactKeys(value, ["type", "requestId"])
    ? { type: "heartbeat", requestId }
    : undefined;

const parseRequest = (value: unknown): WorkerProtocolRequest | undefined => {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== "string") {
    return undefined;
  }
  const requestId = value.requestId;
  switch (value.type) {
    case "init":
      return parseInitRequest(value, requestId);
    case "render":
      return parseRenderRequest(value, requestId);
    case "set_data":
      return parseSetDataRequest(value, requestId);
    case "event":
      return parseEventRequest(value, requestId);
    case "heartbeat":
      return parseHeartbeatRequest(value, requestId);
    case "close":
      return parseCloseRequest(value, requestId);
    default:
      return undefined;
  }
};

const safeRequestId = (value: unknown): string | undefined =>
  isRecord(value) && isRequestId(value.requestId) ? value.requestId : undefined;

const protocolDiagnostic = (
  code: WorkerProtocolDiagnosticCode,
  message: string,
): WorkerProtocolDiagnostic => ({
  code,
  message: sanitizeText(message).slice(0, MAX_DIAGNOSTIC_LENGTH),
});

const frameDiagnostic = (error: unknown): WorkerProtocolDiagnostic => {
  if (error instanceof FrameError) return protocolDiagnostic(error.code, error.message);
  return protocolDiagnostic("invalid_json", "Worker frame could not be decoded");
};

const writerDiagnostic = (error: unknown): WorkerProtocolDiagnostic =>
  error instanceof WorkerProtocolFault
    ? error.diagnostic
    : protocolDiagnostic("output_write_failed", "Could not write worker response");

const validateOption = (name: string, value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
};

class WorkerProtocolSession {
  readonly #decoder: FrameDecoder;
  readonly #writer: BoundedFrameWriter;
  readonly #partialFrameTimeoutMs: number;
  #runtime: WorkerRuntime | undefined;
  #activeRequestId: string | undefined;
  #asynchronousFault: WorkerProtocolDiagnostic | undefined;
  #protocolFailure: WorkerProtocolDiagnostic | undefined;
  #failureRequestId: string | undefined;
  #stopAfterClose = false;
  #inputEnded = false;
  #exitKind: "closed" | "input_closed" = "input_closed";
  #rejectFatal!: (reason: unknown) => void;
  readonly #fatalSignal: Promise<never>;

  constructor(
    write: (frame: Uint8Array) => Promise<void>,
    options: WorkerProtocolOptions,
  ) {
    const maxFrameBytes = validateOption("maxFrameBytes", options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES);
    this.#partialFrameTimeoutMs = validateOption(
      "partialFrameTimeoutMs",
      options.partialFrameTimeoutMs,
      DEFAULT_PARTIAL_FRAME_TIMEOUT_MS,
    );
    const maxPendingFrames = validateOption(
      "maxPendingOutputFrames",
      options.maxPendingOutputFrames,
      DEFAULT_MAX_PENDING_OUTPUT_FRAMES,
    );
    this.#decoder = new FrameDecoder({
      maxFrameBytes,
      partialFrameTimeoutMs: this.#partialFrameTimeoutMs,
    });
    this.#writer = new BoundedFrameWriter(write, maxFrameBytes, maxPendingFrames);
    this.#fatalSignal = new Promise<never>((_resolve, reject) => {
      this.#rejectFatal = reject;
    });
    void this.#fatalSignal.catch(() => undefined);
  }

  async run(input: AsyncIterable<Uint8Array>): Promise<WorkerProtocolExit> {
    const iterator = input[Symbol.asyncIterator]();
    const timer = this.#startDeadlineTimer();
    try {
      await this.#readLoop(iterator);
    } finally {
      clearInterval(timer);
    }
    await this.#cleanup(iterator);
    return this.#exitResult();
  }

  #startDeadlineTimer(): ReturnType<typeof setInterval> {
    return setInterval(() => {
      try {
        this.#decoder.checkDeadline(Date.now());
      } catch (error) {
        this.#signalFatal(frameDiagnostic(error));
      }
    }, Math.max(1, Math.min(this.#partialFrameTimeoutMs, 50)));
  }

  async #readLoop(iterator: AsyncIterator<Uint8Array>): Promise<void> {
    while (!this.#stopAfterClose && this.#protocolFailure === undefined) {
      const next = await this.#readNext(iterator);
      if (next.kind === "failed") {
        this.#protocolFailure = next.diagnostic;
        break;
      }
      if (next.kind === "input_closed") {
        this.#handleInputClosed();
        break;
      }
      if (!(await this.#processChunk(next.chunk))) break;
    }
  }

  async #readNext(iterator: AsyncIterator<Uint8Array>): Promise<ReadOutcome> {
    try {
      const next = await Promise.race([iterator.next(), this.#fatalSignal]);
      return next.done
        ? { kind: "input_closed" }
        : { kind: "chunk", chunk: next.value };
    } catch (error) {
      return {
        kind: "failed",
        diagnostic: this.#asynchronousFault ?? protocolDiagnostic(
          "input_read_failed",
          "Worker input pipe failed",
        ),
      };
    }
  }

  #handleInputClosed(): void {
    this.#inputEnded = true;
    try {
      this.#decoder.checkDeadline(Date.now() + this.#partialFrameTimeoutMs + 1);
    } catch (error) {
      this.#protocolFailure = frameDiagnostic(error);
    }
  }

  async #processChunk(chunk: Uint8Array): Promise<boolean> {
    let requests: unknown[];
    try {
      requests = this.#decoder.push(chunk, Date.now());
    } catch (error) {
      this.#protocolFailure = frameDiagnostic(error);
      return false;
    }
    return this.#processRequests(requests);
  }

  async #processRequests(requests: readonly unknown[]): Promise<boolean> {
    for (const rawRequest of requests) {
      const request = parseRequest(rawRequest);
      if (request === undefined) {
        this.#rejectRequest(rawRequest);
        return false;
      }
      if (!this.#isRequestAllowed(request)) {
        this.#rejectRequest(rawRequest);
        return false;
      }
      if (!(await this.#processValidRequest(request))) return false;
    }
    return true;
  }

  #isRequestAllowed(request: WorkerProtocolRequest): boolean {
    if (this.#runtime === undefined) {
      return request.type === "init" || request.type === "close";
    }
    return request.type !== "init";
  }

  #rejectRequest(rawRequest: unknown): void {
    this.#failureRequestId = safeRequestId(rawRequest);
    this.#protocolFailure = protocolDiagnostic("invalid_request", "Worker request is malformed");
  }

  async #processValidRequest(request: WorkerProtocolRequest): Promise<boolean> {
    try {
      this.#stopAfterClose = await this.#dispatch(request);
      await this.#writer.flush();
    } catch (error) {
      this.#protocolFailure = writerDiagnostic(error);
      return false;
    }
    if (this.#asynchronousFault !== undefined) {
      this.#protocolFailure = this.#asynchronousFault;
      return false;
    }
    if (this.#stopAfterClose) this.#exitKind = "closed";
    return !this.#stopAfterClose;
  }

  async #dispatch(request: WorkerProtocolRequest): Promise<boolean> {
    switch (request.type) {
      case "init":
        await this.#initialize(request);
        return false;
      case "render":
        await this.#render(request.requestId, request.source);
        return false;
      case "set_data":
        await this.#setData(request.requestId, request.key, request.value);
        return false;
      case "event":
        await this.#dispatchEvent(request);
        return false;
      case "heartbeat":
        await this.#writer.enqueue({ type: "heartbeat", requestId: request.requestId });
        return false;
      case "close":
        await this.#close(request.requestId);
        return true;
    }
  }

  async #initialize(request: Extract<WorkerProtocolRequest, { type: "init" }>): Promise<void> {
    this.#runtime = createWorkerRuntime({
      generation: request.generation,
      datasets: request.datasets,
      onUpdate: (snapshot) => this.#handleBackgroundSnapshot(snapshot),
      onDiagnostic: (diagnostic) => this.#handleBackgroundDiagnostic(diagnostic),
    });
    await this.#writer.enqueue({
      type: "ready",
      requestId: request.requestId,
      generation: request.generation,
    });
  }

  #handleBackgroundSnapshot(snapshot: WorkerSnapshot): void {
    if (this.#activeRequestId !== undefined) return;
    this.#queueBackgroundReply({ type: "snapshot", snapshot });
  }

  #handleBackgroundDiagnostic(diagnostic: WorkerDiagnostic): void {
    if (this.#activeRequestId !== undefined) return;
    this.#queueBackgroundReply({ type: "diagnostic", diagnostic });
  }

  #queueBackgroundReply(reply: WorkerProtocolReply): void {
    try {
      void this.#writer.enqueue(reply).catch((error: unknown) => {
        this.#signalFatal(writerDiagnostic(error));
      });
    } catch (error) {
      this.#signalFatal(writerDiagnostic(error));
    }
  }

  async #render(requestId: string, source: string): Promise<void> {
    const runtime = this.#requireRuntime();
    await this.#withRequest(requestId, async () => {
      const result = await runtime.render(source);
      await this.#writeRenderResult(requestId, result);
    });
  }

  async #setData(requestId: string, key: string, value: JsonValue): Promise<void> {
    const runtime = this.#requireRuntime();
    await this.#withRequest(requestId, async () => {
      const result = await runtime.setData(key, value);
      await this.#writeRenderResult(requestId, result);
    });
  }

  async #writeRenderResult(requestId: string, result: WorkerRenderResult): Promise<void> {
    if (result.ok) {
      await this.#writer.enqueue({ type: "snapshot", requestId, snapshot: result.snapshot });
    } else {
      await this.#writer.enqueue({ type: "diagnostic", requestId, diagnostic: result.diagnostic });
    }
  }

  async #dispatchEvent(
    request: Extract<WorkerProtocolRequest, { type: "event" }>,
  ): Promise<void> {
    const runtime = this.#requireRuntime();
    await this.#withRequest(request.requestId, async () => {
      const previous = runtime.getSnapshot();
      const accepted = request.payload === undefined
        ? await runtime.dispatchEvent(request.handle)
        : await runtime.dispatchEvent(request.handle, request.payload);
      const current = runtime.getSnapshot();
      if (accepted && current !== null && current.revision !== previous?.revision) {
        await this.#writer.enqueue({
          type: "snapshot",
          requestId: request.requestId,
          snapshot: current,
        });
      }
      await this.#writer.enqueue({
        type: "event_result",
        requestId: request.requestId,
        accepted,
      });
    });
  }

  async #close(requestId: string): Promise<void> {
    await this.#withRequest(requestId, async () => {
      await this.#runtime?.close();
      await this.#writer.enqueue({ type: "closed", requestId });
    });
  }

  #requireRuntime(): WorkerRuntime {
    if (this.#runtime === undefined) {
      throw new WorkerProtocolFault(protocolDiagnostic("invalid_request", "Worker request is malformed"));
    }
    return this.#runtime;
  }

  async #withRequest<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
    this.#activeRequestId = requestId;
    try {
      return await operation();
    } finally {
      this.#activeRequestId = undefined;
    }
  }

  #signalFatal(diagnostic: WorkerProtocolDiagnostic): void {
    if (this.#asynchronousFault !== undefined) return;
    this.#asynchronousFault = diagnostic;
    this.#rejectFatal(diagnostic);
  }

  async #cleanup(iterator: AsyncIterator<Uint8Array>): Promise<void> {
    if (this.#protocolFailure !== undefined) await this.#stopInput(iterator);
    await this.#closeRuntime();
    if (this.#protocolFailure !== undefined) await this.#sendFailureDiagnostic();
    await this.#flushOutput();
  }

  async #stopInput(iterator: AsyncIterator<Uint8Array>): Promise<void> {
    if (this.#inputEnded) return;
    try {
      await iterator.return?.();
    } catch {
      // Input teardown must not replace the protocol diagnostic.
    }
  }

  async #closeRuntime(): Promise<void> {
    try {
      await this.#runtime?.close();
    } catch {
      // The runner watchdog owns workers that cannot close cleanly.
    }
  }

  async #sendFailureDiagnostic(): Promise<void> {
    const diagnostic = this.#protocolFailure;
    if (diagnostic === undefined || diagnostic.code === "output_write_failed") return;
    const reply: WorkerProtocolReply = {
      type: "diagnostic",
      ...(this.#failureRequestId === undefined ? {} : { requestId: this.#failureRequestId }),
      diagnostic,
    };
    try {
      await this.#writer.flush();
      await this.#writer.enqueue(reply);
    } catch {
      // A diagnostic is best-effort when the output pipe is already blocked or closed.
    }
  }

  async #flushOutput(): Promise<void> {
    try {
      await this.#writer.flush();
    } catch {
      this.#protocolFailure ??= protocolDiagnostic(
        "output_write_failed",
        "Could not write worker response",
      );
    }
  }

  #exitResult(): WorkerProtocolExit {
    if (this.#protocolFailure !== undefined) {
      return { kind: "protocol_error", diagnostic: this.#protocolFailure };
    }
    return { kind: this.#exitKind };
  }
}

export const serveWorkerProtocol = (
  input: AsyncIterable<Uint8Array>,
  write: (frame: Uint8Array) => Promise<void>,
  options: WorkerProtocolOptions = {},
): Promise<WorkerProtocolExit> => new WorkerProtocolSession(write, options).run(input);

const writeStdout = async (frame: Uint8Array): Promise<void> => {
  if (!process.stdout.write(frame)) await once(process.stdout, "drain");
};

if (import.meta.main) {
  const result = await serveWorkerProtocol(process.stdin, writeStdout);
  if (result.kind === "protocol_error") process.exitCode = 1;
}
