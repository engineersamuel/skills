import { randomUUID } from "node:crypto";

import { catalogEntries } from "../catalog/index.ts";
import { validateTree } from "../protocol/tree.ts";
import type { CallbackHandle } from "../protocol/tree.ts";
import type { RendererState } from "../protocol/renderer.ts";
import {
  CanvasSession,
  InputRequestStore,
  type WorkerLauncher,
} from "./session.ts";

interface PaneOwner {
  open(command: readonly string[]): Promise<string>;
  close(): Promise<void>;
}

interface RendererPublisher {
  start(): Promise<void>;
  publish(state: RendererState): void;
  close(): Promise<void>;
}

export interface CanvasBackendOptions {
  readonly ensureSandbox: () => Promise<void>;
  readonly launcher: WorkerLauncher;
  readonly pane: PaneOwner;
  readonly renderer: RendererPublisher;
  readonly rendererCommand: readonly string[];
  readonly templates: Readonly<Record<string, string>>;
  readonly requestId?: () => string;
}

type Decision = {
  readonly id: string;
  readonly prompt: string;
  readonly options: string[];
};

export class CanvasBackend {
  readonly #ensureSandbox: () => Promise<void>;
  readonly #launcher: WorkerLauncher;
  readonly #pane: PaneOwner;
  readonly #renderer: RendererPublisher;
  readonly #rendererCommand: readonly string[];
  readonly #templates: Readonly<Record<string, string>>;
  readonly #requestId: () => string;
  readonly #requests = new InputRequestStore();
  #session: CanvasSession | undefined;
  #unsubscribeSession: (() => void) | undefined;
  #decision: Decision | undefined;
  #lifecycleTail: Promise<void> = Promise.resolve();

  constructor(options: CanvasBackendOptions) {
    this.#ensureSandbox = options.ensureSandbox;
    this.#launcher = options.launcher;
    this.#pane = options.pane;
    this.#renderer = options.renderer;
    this.#rendererCommand = options.rendererCommand;
    this.#templates = options.templates;
    this.#requestId = options.requestId ?? randomUUID;
  }

  open(input: unknown): Promise<{ status: "open" }> {
    const template = recordString(input, "template");
    return this.#enqueueLifecycle(async () => {
      let createdSession = false;
      if (this.#session === undefined) {
        await this.#ensureSandbox();
        const source = this.#templates[template];
        if (source === undefined) throw new Error(`Unknown canvas template: ${template}`);
        await this.#renderer.start();
        let worker;
        try {
          worker = await this.#launcher.start(source, 1);
        } catch (error) {
          await this.#renderer.close();
          throw error;
        }
        this.#session = new CanvasSession(this.#launcher, worker, source);
        this.#unsubscribeSession = this.#session.subscribe(() => this.#publish());
        createdSession = true;
      }
      try {
        await this.#pane.open(this.#rendererCommand);
      } catch (error) {
        if (createdSession) await this.#teardown().catch(() => undefined);
        throw error;
      }
      this.#publish();
      return { status: "open" };
    });
  }

  async setLayout(input: unknown): Promise<{ status: "updated" }> {
    await this.#requireSession().setLayout(recordString(input, "mdx"));
    this.#publish();
    return { status: "updated" };
  }

  async upsert(input: unknown): Promise<{ status: "updated" }> {
    const value = asRecord(input);
    this.#requireSession().upsert(
      requiredString(value, "id"),
      requiredString(value, "component"),
      requiredRecord(value, "props"),
    );
    this.#publish();
    return { status: "updated" };
  }

  async patch(input: unknown): Promise<{ status: "updated" }> {
    const value = asRecord(input);
    this.#requireSession().patch(requiredString(value, "id"), requiredRecord(value, "props"));
    this.#publish();
    return { status: "updated" };
  }

  async remove(input: unknown): Promise<{ status: "updated" }> {
    this.#requireSession().remove(recordString(input, "id"));
    this.#publish();
    return { status: "updated" };
  }

  async setData(input: unknown): Promise<{ status: "updated" }> {
    const value = asRecord(input);
    await this.#requireSession().setData(requiredString(value, "key"), value.value);
    this.#publish();
    return { status: "updated" };
  }

  async catalog(): Promise<{ components: typeof catalogEntries }> {
    return { components: catalogEntries };
  }

  async requestInput(input: unknown): Promise<{ value: string }> {
    if (this.#decision !== undefined) throw new Error("An input request is already pending");
    this.#requireSession();
    const value = asRecord(input);
    const prompt = requiredString(value, "prompt");
    if (!Array.isArray(value.options) || !value.options.every((option) => typeof option === "string")) {
      throw new Error("Input options are invalid");
    }
    const decision = { id: this.#requestId(), prompt, options: [...value.options] as string[] };
    this.#decision = decision;
    const pending = this.#requests.create(decision.id);
    this.#publish();
    try {
      return { value: await pending };
    } finally {
      if (this.#decision?.id === decision.id) {
        this.#decision = undefined;
        this.#publish();
      }
    }
  }

  resolveDecision(requestId: string, value: string, genuineUserAction: boolean): boolean {
    const decision = this.#decision;
    if (
      decision === undefined ||
      decision.id !== requestId ||
      !decision.options.includes(value)
    ) {
      return false;
    }
    return this.#requests.resolve(requestId, value, genuineUserAction);
  }

  rendererDisconnected(): void {
    this.#requests.cancelAll("renderer_disconnected");
    this.#decision = undefined;
  }

  dispatchEvent(handle: CallbackHandle, payload?: unknown): Promise<boolean> {
    return this.#requireSession().dispatchEvent(handle, payload);
  }

  async complete(): Promise<{ status: "complete" }> {
    this.#requests.cancelAll("canvas_completed");
    this.#decision = undefined;
    this.#publish("Completed");
    return { status: "complete" };
  }

  close(): Promise<{ status: "closed" }> {
    return this.#enqueueLifecycle(async () => {
      this.#requests.cancelAll("canvas_closed");
      this.#decision = undefined;
      await this.#teardown();
      return { status: "closed" };
    });
  }

  async #teardown(): Promise<void> {
    this.#unsubscribeSession?.();
    this.#unsubscribeSession = undefined;
    const session = this.#session;
    this.#session = undefined;
    const results = await Promise.allSettled([
      session?.close() ?? Promise.resolve(),
      this.#renderer.close(),
      this.#pane.close(),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) throw failure.reason;
  }

  #requireSession(): CanvasSession {
    if (this.#session === undefined) throw new Error("Canvas is not open");
    return this.#session;
  }

  #publish(diagnostic?: string): void {
    const session = this.#session;
    if (session === undefined) return;
    const snapshot = session.snapshot();
    const effectiveDiagnostic = diagnostic ?? snapshot.diagnostic;
    this.#renderer.publish({
      status: effectiveDiagnostic === undefined ? "connected" : "diagnostic",
      tree: validateTree(snapshot.tree),
      ...(effectiveDiagnostic === undefined ? {} : { diagnostic: effectiveDiagnostic }),
      ...(this.#decision === undefined ? {} : { decision: this.#decision }),
    });
  }

  #enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#lifecycleTail.then(operation);
    this.#lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Expected ${key} to be a string`);
  return field;
};

const requiredRecord = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  asRecord(value[key]);

const recordString = (value: unknown, key: string): string => requiredString(asRecord(value), key);
