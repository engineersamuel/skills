import type { JsonValue } from "../security/sanitize.ts";

export type WorkerEventHandle = {
  readonly $type: "callback";
  readonly generation: number;
  readonly revision: number;
  readonly id: string;
};

export type WorkerPropValue = JsonValue | WorkerEventHandle;

export type WorkerTreeNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, WorkerPropValue>>;
  readonly children: readonly (WorkerTreeNode | string)[];
};

export type WorkerDiagnosticCode =
  | "import_not_allowed"
  | "compile_failed"
  | "evaluation_failed"
  | "render_failed"
  | "tree_limit_exceeded"
  | "non_serializable_value"
  | "worker_closed";

export type WorkerDiagnostic = {
  readonly code: WorkerDiagnosticCode;
  readonly message: string;
};

export type WorkerSnapshot = {
  readonly generation: number;
  readonly revision: number;
  readonly tree: WorkerTreeNode;
};

export type WorkerRenderResult =
  | { readonly ok: true; readonly snapshot: WorkerSnapshot }
  | { readonly ok: false; readonly diagnostic: WorkerDiagnostic };

export type WorkerRuntime = {
  render(source: string): Promise<WorkerRenderResult>;
  setData(key: string, value: JsonValue): Promise<WorkerRenderResult>;
  dispatchEvent(handle: WorkerEventHandle, payload?: JsonValue): Promise<boolean>;
  getSnapshot(): WorkerSnapshot | null;
  subscribe(listener: (snapshot: WorkerSnapshot) => void): () => void;
  close(): Promise<void>;
};

export type WorkerRuntimeOptions = {
  readonly generation: number;
  readonly datasets?: Readonly<Record<string, JsonValue>>;
  readonly components?: Readonly<Record<string, unknown>>;
  readonly canvasRuntime?: Readonly<Record<string, unknown>>;
  readonly maxTreeNodes?: number;
  readonly maxTreeDepth?: number;
  readonly onUpdate?: (snapshot: WorkerSnapshot) => void;
  readonly onDiagnostic?: (diagnostic: WorkerDiagnostic) => void;
};
