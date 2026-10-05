import React from "react";
import ReactReconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority, DiscreteEventPriority } from "react-reconciler/constants";

import { allowedNodeNames, getCatalogEntry } from "../catalog/index.ts";
import { TreeValidationError, validateTree } from "../protocol/tree.ts";
import { sanitizeText } from "../security/sanitize.ts";
import { evaluateMdx, ImportPolicyError, MdxCompileError, MdxEvaluationError } from "./mdx-compiler.ts";
import type {
  WorkerDiagnostic,
  WorkerDiagnosticCode,
  WorkerEventHandle,
  WorkerPropValue,
  WorkerRenderResult,
  WorkerRuntime,
  WorkerRuntimeOptions,
  WorkerSnapshot,
  WorkerTreeNode,
} from "./types.ts";

export type {
  WorkerDiagnostic,
  WorkerEventHandle,
  WorkerRenderResult,
  WorkerRuntime,
  WorkerRuntimeOptions,
  WorkerSnapshot,
  WorkerTreeNode,
} from "./types.ts";

const DEFAULT_MAX_TREE_NODES = 10_000;
const DEFAULT_MAX_TREE_DEPTH = 64;
const MAX_DIAGNOSTIC_LENGTH = 256;
const MAX_SAFE_DATA_DEPTH = 64;

type HostProps = Record<string, unknown>;

type HostText = { text: string };

type HostChild = HostNode | HostText;

type HostNode = {
  type: string;
  props: HostProps;
  children: HostChild[];
};

type HostContext = { readonly depth: number };

type HostContainer = {
  readonly children: HostChild[];
  readonly maxTreeNodes: number;
  readonly maxTreeDepth: number;
  createdNodeCount: number;
  onCommit: () => void;
};

type HostTimeout = ReturnType<typeof setTimeout>;

type CustomHostConfig = ReactReconciler.HostConfig<
  string,
  HostProps,
  HostContainer,
  HostNode,
  HostText,
  never,
  never,
  never,
  HostNode | HostText,
  HostContext,
  never,
  HostTimeout,
  null,
  null
>;

class RuntimeFailure extends Error {
  readonly code: WorkerDiagnosticCode;

  constructor(code: WorkerDiagnosticCode, message: string) {
    super(message);
    this.name = "RuntimeFailure";
    this.code = code;
  }
}

const hostConfig: CustomHostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: null,
  supportsMicrotasks: true,
  NotPendingTransition: null,
  HostTransitionContext: React.createContext(null) as unknown as ReactReconciler.ReactContext<null>,
  getRootHostContext: () => ({ depth: 0 }),
  getChildHostContext: (context) => ({ depth: context.depth + 1 }),
  createInstance(type, props, container, context) {
    if (getCatalogEntry(type) === undefined) {
      throw new RuntimeFailure("render_failed", "MDX rendered an unsupported terminal node");
    }
    if (context.depth + 1 > container.maxTreeDepth) {
      throw new RuntimeFailure("tree_limit_exceeded", "Tree exceeds the maximum depth");
    }
    container.createdNodeCount += 1;
    if (container.createdNodeCount > container.maxTreeNodes) {
      throw new RuntimeFailure("tree_limit_exceeded", "Tree exceeds the maximum node count");
    }
    return { type, props: { ...props }, children: [] };
  },
  createTextInstance(text) {
    return { text };
  },
  appendInitialChild(parent, child) {
    parent.children.push(child);
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit(container) {
    container.onCommit();
    container.createdNodeCount = 0;
  },
  preparePortalMount: () => undefined,
  scheduleTimeout: (callback, delay) => setTimeout(callback, delay),
  cancelTimeout: (timeout) => clearTimeout(timeout),
  scheduleMicrotask: (callback) => queueMicrotask(callback),
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => undefined,
  afterActiveInstanceBlur: () => undefined,
  prepareScopeUpdate: () => undefined,
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => undefined,
  appendChild(parent, child) {
    removeChild(parent.children, child);
    parent.children.push(child);
  },
  appendChildToContainer(container, child) {
    removeChild(container.children, child);
    container.children.push(child);
  },
  insertBefore(parent, child, beforeChild) {
    insertChild(parent.children, child, beforeChild);
  },
  insertInContainerBefore(container, child, beforeChild) {
    insertChild(container.children, child, beforeChild);
  },
  removeChild(parent, child) {
    removeChild(parent.children, child);
  },
  removeChildFromContainer(container, child) {
    removeChild(container.children, child);
  },
  commitTextUpdate(instance, _oldText, newText) {
    instance.text = newText;
  },
  commitUpdate(instance, _type, _previousProps, nextProps) {
    instance.props = { ...nextProps };
  },
  clearContainer(container) {
    container.children.length = 0;
  },
  setCurrentUpdatePriority: (priority) => setUpdatePriority(priority),
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () => currentUpdatePriority || DefaultEventPriority,
  resetFormInstance: () => undefined,
  requestPostPaintCallback: (callback) => {
    setTimeout(() => callback(performance.now()), 0);
  },
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => undefined,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => 0,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => undefined,
  suspendInstance: () => undefined,
  waitForCommitToBeReady: () => null,
};

let currentUpdatePriority = DefaultEventPriority;

const reconciler = ReactReconciler(hostConfig);

const flushSync = (operation: () => void): void => {
  reconciler.flushSyncFromReconciler(operation);
};

function setUpdatePriority(priority: number): void {
  currentUpdatePriority = priority;
}

function removeChild(children: HostChild[], child: HostChild): void {
  const childIndex = children.indexOf(child);
  if (childIndex >= 0) children.splice(childIndex, 1);
}

function insertChild(children: HostChild[], child: HostChild, beforeChild: HostChild): void {
  removeChild(children, child);
  const beforeIndex = children.indexOf(beforeChild);
  if (beforeIndex < 0) {
    children.push(child);
    return;
  }
  children.splice(beforeIndex, 0, child);
}

const messageOf = (error: unknown): string => {
  try {
    if (error instanceof Error) return error.message;
    return String(error);
  } catch {
    return "Worker operation failed";
  }
};

const diagnostic = (code: WorkerDiagnosticCode, message: string): WorkerDiagnostic => ({
  code,
  message: sanitizeText(message).slice(0, MAX_DIAGNOSTIC_LENGTH),
});

const failedResult = (code: WorkerDiagnosticCode, message: string): WorkerRenderResult => ({
  ok: false,
  diagnostic: diagnostic(code, message),
});

const evaluationDiagnostic = (error: unknown): WorkerDiagnostic => {
  if (error instanceof RuntimeFailure) return diagnostic(error.code, error.message);
  if (error instanceof ImportPolicyError) return diagnostic("import_not_allowed", error.message);
  if (error instanceof MdxCompileError) return diagnostic("compile_failed", error.message);
  if (error instanceof MdxEvaluationError) return diagnostic("evaluation_failed", error.message);
  if (error instanceof TreeValidationError) {
    if (error.code === "tree_too_deep" || error.code === "too_many_nodes") {
      return diagnostic("tree_limit_exceeded", error.message);
    }
    return diagnostic("non_serializable_value", "Rendered output failed terminal validation");
  }
  return diagnostic("render_failed", messageOf(error));
};

const isPlainRecord = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const NO_PRIMITIVE = Symbol("no primitive value");

function copyPrimitiveValue(value: unknown): unknown | typeof NO_PRIMITIVE {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RuntimeFailure("non_serializable_value", "A prop is not JSON serializable");
    return value;
  }
  if (typeof value !== "object") {
    throw new RuntimeFailure("non_serializable_value", "A prop is not JSON serializable");
  }
  return NO_PRIMITIVE;
}

function copyArrayValue(
  value: readonly unknown[],
  maxDepth: number,
  active: WeakSet<object>,
  depth: number,
): unknown[] {
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) {
      values.push(null);
      continue;
    }
    if (!("value" in descriptor)) {
      throw new RuntimeFailure("non_serializable_value", "A prop contains an accessor value");
    }
    values.push(copyJsonValue(descriptor.value, maxDepth, active, depth + 1));
  }
  return values;
}

function copyRecordValue(
  value: object,
  maxDepth: number,
  active: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new RuntimeFailure("non_serializable_value", "A prop is not a plain JSON value");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const sanitizedKeys = new Set<string>();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new RuntimeFailure("non_serializable_value", "A prop contains an accessor value");
    }
    if (descriptor.value === undefined) continue;
    const safeKey = sanitizeText(key);
    if (sanitizedKeys.has(safeKey)) {
      throw new RuntimeFailure("non_serializable_value", "Prop names collide after sanitization");
    }
    sanitizedKeys.add(safeKey);
    result[safeKey] = copyJsonValue(descriptor.value, maxDepth, active, depth + 1);
  }
  return result;
}

function copyJsonValue(
  value: unknown,
  maxDepth: number,
  active: WeakSet<object> = new WeakSet(),
  depth = 1,
): unknown {
  const primitive = copyPrimitiveValue(value);
  if (primitive !== NO_PRIMITIVE) return primitive;
  if (typeof value !== "object" || value === null) {
    throw new RuntimeFailure("non_serializable_value", "A prop is not JSON serializable");
  }
  if (depth > maxDepth) {
    throw new RuntimeFailure("tree_limit_exceeded", "Tree exceeds the maximum depth");
  }
  if (active.has(value)) {
    throw new RuntimeFailure("non_serializable_value", "A prop contains a circular value");
  }

  active.add(value);
  try {
    return Array.isArray(value)
      ? copyArrayValue(value, maxDepth, active, depth)
      : copyRecordValue(value, maxDepth, active, depth);
  } finally {
    active.delete(value);
  }
}

const normalizeRoot = (forest: readonly (WorkerTreeNode | string)[]): WorkerTreeNode => {
  if (forest.length === 1) {
    const onlyChild = forest[0];
    if (onlyChild && typeof onlyChild !== "string" && onlyChild.type === "Graph") return onlyChild;
  }
  return {
    type: "Graph",
    props: { document: true },
    children: forest,
  };
};

const freezeTree = (node: WorkerTreeNode): WorkerTreeNode => {
  const children = node.children.map((child) =>
    typeof child === "string" ? child : freezeTree(child),
  );
  return Object.freeze({
    type: node.type,
    props: Object.freeze({ ...node.props }),
    children: Object.freeze(children),
  });
};

const createDataBinding = (datasets: Record<string, unknown>): Readonly<Record<string, unknown>> =>
  new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== "string" || !Object.hasOwn(datasets, key)) return undefined;
      return datasets[key];
    },
    has(_target, key) {
      return typeof key === "string" && Object.hasOwn(datasets, key);
    },
    ownKeys() {
      return Object.keys(datasets);
    },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== "string" || !Object.hasOwn(datasets, key)) return undefined;
      return { configurable: true, enumerable: true, value: datasets[key] };
    },
  });

type MdxComponentProps = Readonly<Record<string, unknown>> & {
  readonly children?: React.ReactNode;
};

const createTerminalComponent = (type: string) =>
  function TerminalComponent({ children, ...props }: MdxComponentProps): React.ReactElement {
    return React.createElement(type, props, children);
  };

const DEFAULT_MDX_COMPONENTS = Object.freeze(
  Object.fromEntries(allowedNodeNames.map((name) => [name, createTerminalComponent(name)])),
);

const createMdxComponents = (
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => {
  const flatSlot = Object.hasOwn(overrides, "Canvas.Slot")
    ? overrides["Canvas.Slot"]
    : DEFAULT_MDX_COMPONENTS["Canvas.Slot"];
  const providedCanvas = overrides.Canvas;
  const canvasOverrides =
    typeof providedCanvas === "object" && providedCanvas !== null && !Array.isArray(providedCanvas)
      ? (providedCanvas as Record<string, unknown>)
      : {};
  const canvasNamespace = Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, { Slot: flatSlot }, canvasOverrides),
  );
  return Object.freeze(
    Object.assign(
      Object.create(null) as Record<string, unknown>,
      DEFAULT_MDX_COMPONENTS,
      overrides,
      { Canvas: canvasNamespace },
    ),
  );
};

const validateLimit = (name: string, value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
};

export const createWorkerRuntime = (options: WorkerRuntimeOptions): WorkerRuntime => {
  if (!Number.isSafeInteger(options.generation) || options.generation < 0) {
    throw new RangeError("generation must be a non-negative safe integer");
  }

  const maxTreeNodes = validateLimit("maxTreeNodes", options.maxTreeNodes, DEFAULT_MAX_TREE_NODES);
  const maxTreeDepth = validateLimit("maxTreeDepth", options.maxTreeDepth, DEFAULT_MAX_TREE_DEPTH);
  const datasets = Object.create(null) as Record<string, unknown>;
  const initialDatasets = options.datasets ?? {};
  for (const [key, value] of Object.entries(initialDatasets)) {
    datasets[key] = copyJsonValue(value, MAX_SAFE_DATA_DEPTH);
  }
  const dataBinding = createDataBinding(datasets);
  const components = createMdxComponents(options.components);
  const canvasRuntime = Object.freeze({ ...components, ...options.canvasRuntime });
  const eventCallbacks = new Map<string, (payload?: unknown) => unknown>();
  const listeners = new Set<(snapshot: WorkerSnapshot) => void>();
  let callbackSequence = 0;
  let revision = 0;
  let dataRevision = 0;
  let activeDocument: React.ComponentType<{ components?: Readonly<Record<string, unknown>> }> | null = null;
  let snapshot: WorkerSnapshot | null = null;
  let closed = false;
  let operationDiagnostic: WorkerDiagnostic | null = null;
  let operationActive = false;
  let commitRejected = false;
  let operationTail: Promise<void> = Promise.resolve();

  const reportDiagnostic = (value: WorkerDiagnostic): void => {
    try {
      options.onDiagnostic?.(value);
    } catch {
      // Diagnostic consumers must not affect worker state.
    }
  };

  const reportFailure = (error: unknown): WorkerDiagnostic => {
    eventCallbacks.clear();
    commitRejected = true;
    const value = evaluationDiagnostic(error);
    if (operationActive) operationDiagnostic = value;
    reportDiagnostic(value);
    return value;
  };

  const container: HostContainer = {
    children: [],
    maxTreeNodes,
    maxTreeDepth,
    createdNodeCount: 0,
    onCommit: () => undefined,
  };

  const commitTree = (): void => {
    if (closed || commitRejected) return;
    try {
      if (revision >= Number.MAX_SAFE_INTEGER) {
        throw new RuntimeFailure("render_failed", "Worker revision limit reached");
      }
      const nextRevision = revision + 1;
      const pendingCallbacks = new Map<string, (payload?: unknown) => unknown>();
      const serializeChild = (child: HostChild): WorkerTreeNode | string => {
        if ("text" in child) return sanitizeText(child.text);
        const props: Record<string, WorkerPropValue> = Object.create(null) as Record<string, WorkerPropValue>;
        for (const [rawName, value] of Object.entries(child.props)) {
          if (rawName === "children" || rawName === "key" || rawName === "ref") continue;
          if (value === undefined) continue;
          const name = sanitizeText(rawName);
          if (typeof value === "function" && /^on[A-Z]/.test(name)) {
            callbackSequence += 1;
            const id = `cb_${callbackSequence}`;
            pendingCallbacks.set(id, value as (payload?: unknown) => unknown);
            props[name] = {
              $type: "callback",
              generation: options.generation,
              revision: nextRevision,
              id,
            };
            continue;
          }
          props[name] = copyJsonValue(value, maxTreeDepth) as WorkerPropValue;
        }
        return {
          type: sanitizeText(child.type),
          props,
          children: child.children.map(serializeChild),
        };
      };

      const forest = container.children.map(serializeChild);
      const candidateTree = normalizeRoot(forest);
      const validated = validateTree(candidateTree, { maxDepth: maxTreeDepth, maxNodes: maxTreeNodes });
      const nextSnapshot: WorkerSnapshot = Object.freeze({
        generation: options.generation,
        revision: nextRevision,
        tree: freezeTree(validated as unknown as WorkerTreeNode),
      });
      revision = nextRevision;
      snapshot = nextSnapshot;
      eventCallbacks.clear();
      for (const [id, callback] of pendingCallbacks) eventCallbacks.set(id, callback);
      notifySnapshot(nextSnapshot);
    } catch (error) {
      reportFailure(error);
    }
  };

  container.onCommit = commitTree;

  const root = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    `herdr-worker-${options.generation}-`,
    (error) => reportFailure(error),
    (error) => reportFailure(error),
    (error) => reportFailure(error),
    () => undefined,
  );

  function notifySnapshot(nextSnapshot: WorkerSnapshot): void {
    const callbacks = [...listeners];
    if (options.onUpdate) callbacks.unshift(options.onUpdate);
    for (const listener of callbacks) {
      try {
        listener(nextSnapshot);
      } catch (error) {
        reportDiagnostic(evaluationDiagnostic(error));
      }
    }
  }

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const runDocument = (): WorkerRenderResult => {
    const document = activeDocument;
    if (!document) return failedResult("render_failed", "No MDX document is loaded");
    const previousRevision = revision;
    operationDiagnostic = null;
    operationActive = true;
    commitRejected = false;
    eventCallbacks.clear();
    container.createdNodeCount = 0;
    const props = { components, __herdrDataRevision: dataRevision };
    try {
      flushSync(() => {
        reconciler.updateContainerSync(React.createElement(document, props), root, null, null);
      });
      reconciler.flushPassiveEffects();
    } catch (error) {
      reportFailure(error);
    }
    operationActive = false;
    if (operationDiagnostic) {
      const failure = operationDiagnostic;
      operationDiagnostic = null;
      return { ok: false, diagnostic: failure };
    }
    if (!snapshot || snapshot.revision === previousRevision) {
      operationDiagnostic = null;
      return failedResult("render_failed", "MDX did not produce a terminal tree");
    }
    operationDiagnostic = null;
    return { ok: true, snapshot };
  };

  const runtime: WorkerRuntime = {
    render(source) {
      return enqueue(async () => {
        if (closed) return failedResult("worker_closed", "Worker is closed");
        try {
          activeDocument = await evaluateMdx({
            source,
            data: dataBinding,
            canvasRuntime,
          });
        } catch (error) {
          const value = reportFailure(error);
          operationDiagnostic = null;
          return { ok: false, diagnostic: value };
        }
        return runDocument();
      });
    },
    setData(key, value) {
      return enqueue(() => {
        if (closed) return failedResult("worker_closed", "Worker is closed");
        if (key.length === 0 || key.length > 128) {
          return failedResult("render_failed", "Dataset key must contain 1 to 128 characters");
        }
        try {
          datasets[key] = copyJsonValue(value, MAX_SAFE_DATA_DEPTH);
        } catch (error) {
          const failure = evaluationDiagnostic(error);
          reportDiagnostic(failure);
          return { ok: false, diagnostic: failure };
        }
        dataRevision += 1;
        if (!activeDocument) return failedResult("render_failed", "No MDX document is loaded");
        return runDocument();
      });
    },
    dispatchEvent(handle, payload) {
      return enqueue(() => {
        if (closed || !snapshot) return false;
        if (
          handle.$type !== "callback" ||
          handle.generation !== options.generation ||
          handle.revision !== snapshot.revision
        ) {
          return false;
        }
        const callback = eventCallbacks.get(handle.id);
        if (!callback) return false;
        operationDiagnostic = null;
        operationActive = true;
        commitRejected = false;
        try {
          const safePayload = payload === undefined ? undefined : copyJsonValue(payload, MAX_SAFE_DATA_DEPTH);
          flushSync(() => {
            setUpdatePriority(DiscreteEventPriority);
            try {
              callback(safePayload);
            } finally {
              setUpdatePriority(DefaultEventPriority);
            }
          });
          reconciler.flushPassiveEffects();
        } catch (error) {
          reportFailure(error);
        }
        operationActive = false;
        const succeeded = operationDiagnostic === null;
        operationDiagnostic = null;
        return succeeded;
      });
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      return enqueue(() => {
        if (closed) return;
        closed = true;
        eventCallbacks.clear();
        operationDiagnostic = null;
        try {
          flushSync(() => {
            reconciler.updateContainerSync(null, root, null, null);
          });
          reconciler.flushPassiveEffects();
        } catch (error) {
          reportDiagnostic(evaluationDiagnostic(error));
        }
        listeners.clear();
      });
    },
  };

  return runtime;
};
