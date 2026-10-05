import { compile, run, type CompileOptions, type RunOptions } from "@mdx-js/mdx";
import * as React from "react";
import * as Effect from "effect";
import * as jsxRuntime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

const BASE_URL = "canvas-worker://runtime/layout.mdx";
const ALLOWED_IMPORTS = new Set(["react", "effect", "@canvas/runtime"]);

export class ImportPolicyError extends Error {
  constructor() {
    super("MDX imports must use an allowlisted runtime module");
    this.name = "ImportPolicyError";
  }
}

export class MdxCompileError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause));
    this.name = "MdxCompileError";
  }
}

export class MdxEvaluationError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause));
    this.name = "MdxEvaluationError";
  }
}

type AstNode = Record<string, unknown> & { readonly type: string };
type AstParent = Record<string, unknown> | unknown[];
type RuntimeModuleTable = Readonly<Record<string, Promise<unknown>>>;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isAstNode = (value: unknown): value is AstNode => {
  const record = asRecord(value);
  return record !== undefined && typeof record.type === "string";
};

const literalString = (value: unknown): string | undefined => {
  const node = asRecord(value);
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
};

const importedSpecifier = (source: unknown): string | undefined => {
  const direct = literalString(source);
  if (direct !== undefined) return direct;

  const call = asRecord(source);
  if (call?.type !== "CallExpression") return undefined;
  const callee = asRecord(call.callee);
  if (callee?.type !== "Identifier" || callee.name !== "_resolveDynamicMdxSpecifier") {
    return undefined;
  }
  const args = Array.isArray(call.arguments) ? call.arguments : [];
  return literalString(args[0]);
};

const moduleReference = (specifier: string): AstNode => ({
  type: "MemberExpression",
  object: { type: "Identifier", name: "__herdrRuntimeModules" },
  property: { type: "Literal", value: specifier },
  computed: true,
  optional: false,
});

const argumentProperty = (name: string): AstNode => ({
  type: "MemberExpression",
  object: {
    type: "MemberExpression",
    object: { type: "Identifier", name: "arguments" },
    property: { type: "Literal", value: 0 },
    computed: true,
    optional: false,
  },
  property: { type: "Identifier", name },
  computed: false,
  optional: false,
});

const injectedBindings = (): AstNode => ({
  type: "VariableDeclaration",
  kind: "const",
  declarations: [
    {
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "__herdrRuntimeModules" },
      init: argumentProperty("modules"),
    },
    {
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "data" },
      init: argumentProperty("data"),
    },
  ],
});

const replaceChild = (parent: AstParent, key: string | number, next: unknown): void => {
  if (Array.isArray(parent)) {
    parent[key as number] = next;
    return;
  }
  parent[key as string] = next;
};

const rewriteImport = (node: AstNode, parent: AstParent, key: string | number): void => {
  const specifier = importedSpecifier(node.source);
  if (specifier === undefined || !ALLOWED_IMPORTS.has(specifier)) {
    throw new ImportPolicyError();
  }
  replaceChild(parent, key, moduleReference(specifier));
};

const visitAst = (value: unknown, parent: AstParent, key: string | number): void => {
  if (!isAstNode(value)) return;
  if (value.type === "ImportExpression") {
    rewriteImport(value, parent, key);
    return;
  }
  visitAstProperties(value);
};

const visitAstArray = (values: unknown[], parent: AstParent = values): void => {
  for (let index = 0; index < values.length; index += 1) {
    visitAst(values[index], parent, index);
  }
};

const visitAstProperties = (value: AstNode): void => {
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      visitAstArray(child, child);
      continue;
    }
    visitAst(child, value, key);
  }
};

const addInjectedBindings = (body: unknown[]): void => {
  const first = body[0];
  const directiveEnd = isAstNode(first) && typeof first.directive === "string" ? 1 : 0;
  body.splice(directiveEnd, 0, injectedBindings());
};

const programBody = (tree: unknown): unknown[] => {
  const program = asRecord(tree);
  if (!program || !Array.isArray(program.body)) {
    throw new Error("MDX compiler produced an invalid program");
  }
  return program.body;
};

const workerModulePolicy = () => (tree: unknown): void => {
  const body = programBody(tree);
  visitAstArray(body);
  addInjectedBindings(body);
};

const moduleNamespace = (
  canvasRuntime: Readonly<Record<string, unknown>>,
): RuntimeModuleTable => {
  const reactImport = Object.freeze({
    ...React,
    default: (React as unknown as { default?: unknown }).default ?? React,
  });
  const canvasImport = Object.freeze({ ...canvasRuntime, default: canvasRuntime.default ?? canvasRuntime });
  const table = Object.create(null) as Record<string, Promise<unknown>>;
  table.react = Promise.resolve(reactImport);
  table.effect = Promise.resolve(Effect);
  table["@canvas/runtime"] = Promise.resolve(canvasImport);
  return Object.freeze(table);
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const evaluateMdx = async (options: {
  readonly source: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly canvasRuntime?: Readonly<Record<string, unknown>>;
}): Promise<React.ComponentType<{ components?: Readonly<Record<string, unknown>> }>> => {
  let compiled: Awaited<ReturnType<typeof compile>>;
  try {
    const recmaPlugins = [workerModulePolicy] as unknown as NonNullable<CompileOptions["recmaPlugins"]>;
    compiled = await compile(options.source, {
      format: "mdx",
      outputFormat: "function-body",
      baseUrl: BASE_URL,
      recmaPlugins,
      remarkPlugins: [remarkGfm],
    });
  } catch (error) {
    if (error instanceof ImportPolicyError) throw error;
    throw new MdxCompileError(error);
  }

  try {
    const modules = moduleNamespace(options.canvasRuntime ?? {});
    const runtime = {
      ...jsxRuntime,
      baseUrl: BASE_URL,
      data: options.data,
      modules,
    } as unknown as RunOptions;
    const evaluated = await run(compiled, runtime);
    if (typeof evaluated.default !== "function") {
      throw new Error("MDX document did not produce a component");
    }
    return evaluated.default as React.ComponentType<{
      components?: Readonly<Record<string, unknown>>;
    }>;
  } catch (error) {
    throw new MdxEvaluationError(error);
  }
};
