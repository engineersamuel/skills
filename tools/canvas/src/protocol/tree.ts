import { z } from "zod";

import { getCatalogEntry } from "../catalog/index.ts";
import { sanitizeValue, type JsonValue } from "../security/sanitize.ts";

export type CallbackHandle = {
  readonly $type: "callback";
  readonly generation: number;
  readonly revision: number;
  readonly id: string;
};

export type TreeNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, JsonValue | CallbackHandle>>;
  readonly children: readonly TreeChild[];
};

export type TreeChild = string | TreeNode;

export interface TreeLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export type TreeValidationCode = "invalid_tree" | "tree_too_deep" | "too_many_nodes";

export interface TreeIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export const DEFAULT_TREE_LIMITS = Object.freeze({ maxDepth: 64, maxNodes: 10_000 });

const validationMessages: Record<TreeValidationCode, string> = {
  invalid_tree: "Tree does not match the terminal component protocol",
  tree_too_deep: "Tree exceeds the maximum depth",
  too_many_nodes: "Tree exceeds the maximum node count",
};

export class TreeValidationError extends Error {
  readonly code: TreeValidationCode;
  readonly issues: readonly TreeIssue[];

  constructor(code: TreeValidationCode, issues: readonly TreeIssue[] = []) {
    super(validationMessages[code]);
    this.name = "TreeValidationError";
    this.code = code;
    this.issues = issues;
  }
}

export const callbackHandleSchema = z
  .object({
    $type: z.literal("callback"),
    generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  })
  .strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCallbackTagged = (value: unknown): boolean =>
  isRecord(value) && Object.hasOwn(value, "$type") && value.$type === "callback";

const plainJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(plainJsonValueSchema),
    z
      .record(z.string(), plainJsonValueSchema)
      .superRefine((value, context) => {
        if (isCallbackTagged(value)) {
          context.addIssue({
            code: "custom",
            message: "Callback handles must be direct event prop values",
          });
        }
      }),
  ]),
);

const plainPropsSchema = z.record(z.string(), plainJsonValueSchema);

const componentPropsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((props, context) => {
    for (const [name, value] of Object.entries(props)) {
      const isEventProp = /^on[A-Z]/.test(name);
      const isCallback = callbackHandleSchema.safeParse(value).success;

      if (isEventProp && !isCallback) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Event props must contain a callback handle",
        });
        continue;
      }
      if (!isEventProp && isCallback) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Callback handles are only allowed on event props",
        });
        continue;
      }
      if (!isEventProp && !plainJsonValueSchema.safeParse(value).success) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Props must contain JSON values",
        });
      }
    }
  });

const treeNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      type: z.string().refine((name) => getCatalogEntry(name) !== undefined, {
        message: "Unknown terminal component name",
      }),
      props: z.record(z.string(), z.unknown()),
      children: z.array(z.union([z.string(), treeNodeSchema])),
    })
    .strict()
    .superRefine((node, context) => {
      const entry = getCatalogEntry(node.type);
      if (entry === undefined) return;

      const propsSchema =
        entry.classification === "component" || entry.classification === "intrinsic"
          ? componentPropsSchema
          : plainPropsSchema;
      addPropIssues(propsSchema.safeParse(node.props), context);
      validateSlotProps(node.type, node.props, context);
    }),
);

function addPropIssues(
  result: ReturnType<typeof componentPropsSchema.safeParse> | ReturnType<typeof plainPropsSchema.safeParse>,
  context: z.RefinementCtx,
): void {
  if (result.success) return;
  for (const issue of result.error.issues) {
    context.addIssue({
      code: "custom",
      path: ["props", ...issue.path],
      message: issue.message,
    });
  }
}

function validateSlotProps(
  type: string,
  props: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  if (type !== "Canvas.Slot") return;
  const slotId = z.string().min(1).max(128).safeParse(props.id);
  if (slotId.success) return;
  context.addIssue({
    code: "custom",
    path: ["props", "id"],
    message: "Canvas.Slot requires a non-empty id",
  });
}

interface ResolvedTreeLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

const resolveLimits = (limits: TreeLimits = {}): ResolvedTreeLimits => {
  const maxDepth = limits.maxDepth ?? DEFAULT_TREE_LIMITS.maxDepth;
  const maxNodes = limits.maxNodes ?? DEFAULT_TREE_LIMITS.maxNodes;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError("maxDepth must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    throw new RangeError("maxNodes must be a positive safe integer");
  }
  return { maxDepth, maxNodes };
};

type WalkEntry =
  | { readonly kind: "tree"; readonly value: unknown; readonly depth: number }
  | { readonly kind: "data"; readonly value: unknown; readonly depth: number }
  | { readonly kind: "leave"; readonly value: object };

function checkEntryDepth(entry: Exclude<WalkEntry, { readonly kind: "leave" }>, limits: ResolvedTreeLimits): void {
  if (entry.depth <= limits.maxDepth) return;
  throw new TreeValidationError("tree_too_deep");
}

function enterObject(value: unknown, active: WeakSet<object>, pending: WalkEntry[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (active.has(value)) throw new TreeValidationError("invalid_tree");
  active.add(value);
  pending.push({ kind: "leave", value });
  return true;
}

function pushTreeContents(
  value: Record<string, unknown>,
  depth: number,
  pending: WalkEntry[],
): void {
  const props = value.props;
  if (isRecord(props)) {
    for (const propValue of Object.values(props)) {
      pending.push({ kind: "data", value: propValue, depth: 1 });
    }
  }
  const children = value.children;
  if (!Array.isArray(children)) return;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (typeof child !== "string") {
      pending.push({ kind: "tree", value: child, depth: depth + 1 });
    }
  }
}

function pushDataContents(value: object, depth: number, pending: WalkEntry[]): void {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      pending.push({ kind: "data", value: value[index], depth: depth + 1 });
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const child of Object.values(value)) {
    pending.push({ kind: "data", value: child, depth: depth + 1 });
  }
}

function visitTreeEntry(
  entry: Extract<WalkEntry, { readonly kind: "tree" }>,
  active: WeakSet<object>,
  pending: WalkEntry[],
): void {
  if (!enterObject(entry.value, active, pending) || !isRecord(entry.value)) return;
  pushTreeContents(entry.value, entry.depth, pending);
}

function visitDataEntry(
  entry: Extract<WalkEntry, { readonly kind: "data" }>,
  active: WeakSet<object>,
  pending: WalkEntry[],
): void {
  if (!enterObject(entry.value, active, pending)) return;
  pushDataContents(entry.value as object, entry.depth, pending);
}

function countNode(current: number, limits: ResolvedTreeLimits): number {
  const next = current + 1;
  if (next > limits.maxNodes) throw new TreeValidationError("too_many_nodes");
  return next;
}

function processWalkEntry(
  entry: Exclude<WalkEntry, { readonly kind: "leave" }>,
  limits: ResolvedTreeLimits,
  active: WeakSet<object>,
  pending: WalkEntry[],
  nodeCount: number,
): number {
  checkEntryDepth(entry, limits);
  if (entry.kind === "tree") {
    const nextNodeCount = countNode(nodeCount, limits);
    visitTreeEntry(entry, active, pending);
    return nextNodeCount;
  }
  visitDataEntry(entry, active, pending);
  return nodeCount;
}

function assertWithinLimits(value: unknown, limits: ResolvedTreeLimits): void {
  const pending: WalkEntry[] = [{ kind: "tree", value, depth: 1 }];
  const active = new WeakSet<object>();
  let nodeCount = 0;

  try {
    while (pending.length > 0) {
      const entry = pending.pop();
      if (entry === undefined) continue;
      if (entry.kind === "leave") {
        active.delete(entry.value);
        continue;
      }
      nodeCount = processWalkEntry(entry, limits, active, pending, nodeCount);
    }
  } catch (error) {
    if (error instanceof TreeValidationError) throw error;
    throw new TreeValidationError("invalid_tree");
  }
}

const treeIssues = (error: z.ZodError): readonly TreeIssue[] =>
  error.issues.map((issue) =>
    sanitizeValue({
      path: issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number",
      ),
      message: issue.message,
    }),
  );

const parseTree = (value: unknown, limits: ResolvedTreeLimits): TreeNode => {
  assertWithinLimits(value, limits);
  const result = treeNodeSchema.safeParse(value);
  if (!result.success) {
    throw new TreeValidationError("invalid_tree", treeIssues(result.error));
  }
  return result.data as TreeNode;
};

export const validateTree = (value: unknown, limits: TreeLimits = {}): TreeNode => {
  const resolvedLimits = resolveLimits(limits);
  const parsed = parseTree(value, resolvedLimits);
  const sanitized = sanitizeValue(parsed as unknown as JsonValue);
  return parseTree(sanitized, resolvedLimits);
};

export const createTreeSchema = (limits: TreeLimits = {}) =>
  z.unknown().transform((value, context): TreeNode => {
    try {
      return validateTree(value, limits);
    } catch (error) {
      const validationError =
        error instanceof TreeValidationError ? error : new TreeValidationError("invalid_tree");
      context.addIssue({
        code: "custom",
        message: validationError.message,
      });
      return z.NEVER;
    }
  });

export const treeSchema = createTreeSchema();
