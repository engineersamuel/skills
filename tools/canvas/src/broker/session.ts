import { validateTree, type CallbackHandle, type TreeNode } from "../protocol/tree.ts";
import { encodeFrame } from "../protocol/frame.ts";

export type CanvasNode = TreeNode;

export interface WorkerHandle {
  readonly generation: number;
  readonly firstTree: CanvasNode;
  currentTree(): CanvasNode;
  diagnostic?(): string | undefined;
  subscribe(listener: () => void): () => void;
  setData(key: string, value: unknown): Promise<void>;
  dispatchEvent(handle: CallbackHandle, payload?: unknown): Promise<boolean>;
  close(): Promise<void>;
}

export interface WorkerLauncher {
  start(
    mdx: string,
    generation: number,
    datasets?: Readonly<Record<string, unknown>>,
  ): Promise<WorkerHandle>;
}

export class LayoutRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutRejected";
  }
}

export class CanvasSession {
  readonly #launcher: WorkerLauncher;
  #worker: WorkerHandle;
  #mdx: string;
  readonly #instances = new Map<string, CanvasNode>();
  readonly #datasets = new Map<string, unknown>();
  readonly #listeners = new Set<() => void>();
  #unsubscribeWorker: () => void;
  #mutationTail: Promise<void> = Promise.resolve();
  #nextGeneration: number;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    launcher: WorkerLauncher,
    worker: WorkerHandle,
    mdx: string,
  ) {
    this.#launcher = launcher;
    this.#worker = worker;
    this.#mdx = mdx;
    this.#nextGeneration = worker.generation + 1;
    this.#unsubscribeWorker = worker.subscribe(() => this.#notify());
  }

  setLayout(mdx: string): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Canvas session is closed"));
    return this.#enqueueMutation(async () => {
      if (this.#closed) throw new Error("Canvas session is closed");
      const generation = this.#nextGeneration;
      this.#nextGeneration += 1;
      let candidate: WorkerHandle;
      try {
        candidate = await this.#launcher.start(
          mdx,
          generation,
          Object.fromEntries(this.#datasets),
        );
      } catch (error) {
        if (this.#closed) throw new Error("Canvas session is closed");
        const message = error instanceof Error ? error.message : String(error);
        throw new LayoutRejected(sanitizeText(message));
      }
      if (this.#closed) {
        await candidate.close();
        throw new Error("Canvas session is closed");
      }
      const previous = this.#worker;
      this.#unsubscribeWorker();
      this.#worker = candidate;
      this.#unsubscribeWorker = candidate.subscribe(() => this.#notify());
      this.#mdx = mdx;
      this.#notify();
      await previous.close();
    });
  }

  setData(key: string, value: unknown): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Canvas session is closed"));
    return this.#enqueueMutation(async () => {
      if (this.#closed) throw new Error("Canvas session is closed");
      await this.#worker.setData(key, value);
      this.#datasets.set(key, value);
    });
  }

  dispatchEvent(handle: CallbackHandle, payload?: unknown): Promise<boolean> {
    if (this.#closed) return Promise.resolve(false);
    return this.#worker.dispatchEvent(handle, payload);
  }

  upsert(id: string, type: string, props: Record<string, unknown>): void {
    const candidate = validateTree({
      type,
      props: { ...props },
      children: [],
    });
    const nextInstances = new Map(this.#instances);
    nextInstances.set(id, candidate);
    this.#assertInstancesFit(nextInstances);
    this.#instances.set(id, candidate);
    this.#notify();
  }

  patch(id: string, props: Record<string, unknown>): void {
    const current = this.#instances.get(id);
    if (current === undefined) {
      throw new Error(`Unknown component instance: ${id}`);
    }
    const candidate = validateTree({
      ...current,
      props: { ...current.props, ...props },
    });
    const nextInstances = new Map(this.#instances);
    nextInstances.set(id, candidate);
    this.#assertInstancesFit(nextInstances);
    this.#instances.set(id, candidate);
    this.#notify();
  }

  remove(id: string): void {
    this.#instances.delete(id);
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closed = true;
    this.#unsubscribeWorker();
    this.#closePromise = this.#enqueueMutation(() => this.#worker.close());
    return this.#closePromise;
  }

  snapshot(): { tree: CanvasNode; generation: number; instances: Record<string, CanvasNode>; diagnostic?: string } {
    const instances = Object.fromEntries(this.#instances);
    const diagnostic = this.#worker.diagnostic?.();
    const tree = materializeSlots(this.#worker.currentTree(), instances);
    return {
      tree: diagnostic === undefined ? tree : disableCallbacks(tree),
      generation: this.#worker.generation,
      instances,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #assertInstancesFit(instances: ReadonlyMap<string, CanvasNode>): void {
    const tree = materializeSlots(this.#worker.currentTree(), Object.fromEntries(instances));
    encodeFrame({ type: "state", revision: Number.MAX_SAFE_INTEGER, state: { status: "connected", tree } });
  }

  #enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.catch(() => undefined);
    return result;
  }
}

const disableCallbacks = (node: CanvasNode): CanvasNode => ({
  ...node,
  props: Object.fromEntries(
    Object.entries(node.props).filter(([name]) => !/^on[A-Z]/u.test(name)),
  ),
  children: node.children.map((child) => typeof child === "string" ? child : disableCallbacks(child)),
});

export const materializeSlots = (
  tree: CanvasNode,
  instances: Readonly<Record<string, CanvasNode>>,
): CanvasNode => {
  const placed = new Set<string>();
  const visit = (node: CanvasNode | string): (CanvasNode | string)[] => {
    if (typeof node === "string") return [node];
    if (node.type === "Canvas.Slot") {
      const id = node.props.id;
      if (typeof id !== "string" || placed.has(id) || instances[id] === undefined) {
        return [];
      }
      placed.add(id);
      return [instances[id]];
    }
    return [{ ...node, children: node.children.flatMap(visit) }];
  };
  const [root] = visit(tree);
  if (root === undefined || typeof root === "string") {
    throw new Error("The document root cannot be a slot");
  }
  return {
    ...root,
    children: [
      ...root.children,
      ...Object.entries(instances)
        .filter(([id]) => !placed.has(id))
        .map(([, node]) => node),
    ],
  };
};

export class InputRequestStore {
  readonly #pending = new Map<
    string,
    { resolve: (value: string) => void; reject: (reason: Error) => void }
  >();

  create(id: string): Promise<string> {
    if (this.#pending.has(id)) {
      return Promise.reject(new Error(`Duplicate input request: ${id}`));
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  resolve(id: string, value: string, genuineUserAction: boolean): boolean {
    if (!genuineUserAction) {
      return false;
    }
    const pending = this.#pending.get(id);
    if (pending === undefined) {
      return false;
    }
    this.#pending.delete(id);
    pending.resolve(value);
    return true;
  }

  cancelAll(reason: string): void {
    for (const pending of this.#pending.values()) {
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }
}
import { sanitizeText } from "../security/sanitize.ts";
