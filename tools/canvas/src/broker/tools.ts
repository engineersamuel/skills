import { z } from "zod";

import { publicComponentNames } from "../catalog/index.ts";

export interface CanvasToolsBackend {
  open(input: unknown): Promise<unknown>;
  setLayout(input: unknown): Promise<unknown>;
  upsert(input: unknown): Promise<unknown>;
  patch(input: unknown): Promise<unknown>;
  remove(input: unknown): Promise<unknown>;
  setData(input: unknown): Promise<unknown>;
  catalog(): Promise<unknown>;
  requestInput(input: unknown): Promise<unknown>;
  complete(): Promise<unknown>;
  close(): Promise<unknown>;
}

export const toolNames = [
  "canvas.open",
  "canvas.set_layout",
  "canvas.upsert",
  "canvas.patch",
  "canvas.remove",
  "canvas.set_data",
  "canvas.catalog",
  "canvas.request_input",
  "canvas.complete",
  "canvas.close",
] as const;

const jsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
const jsonObjectSchema = z.record(z.string(), jsonSchema);
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const datasetKeySchema = idSchema.refine(
  (key) => !key.startsWith("data."),
  "Use the dataset name only, for example `canvas`, not `data.canvas`.",
);
const openSchema = z.object({ template: z.enum(["delivery", "architecture", "debug", "blank"]) }).strict();
const layoutSchema = z.object({ mdx: z.string().max(1_048_576) }).strict();
const upsertSchema = z.object({
  id: idSchema,
  component: z.enum(publicComponentNames as [string, ...string[]]),
  props: jsonObjectSchema,
}).strict();
const patchSchema = z.object({ id: idSchema, props: jsonObjectSchema }).strict();
const removeSchema = z.object({ id: idSchema }).strict();
const dataSchema = z.object({ key: datasetKeySchema, value: jsonSchema }).strict();
const inputSchema = z.object({
  prompt: z.string().min(1).max(4_096),
  options: z.array(z.string().min(1).max(256)).min(2).max(12),
}).strict();
const emptySchema = z.object({}).strict();

export const toolInputSchemas = {
  "canvas.open": openSchema,
  "canvas.set_layout": layoutSchema,
  "canvas.upsert": upsertSchema,
  "canvas.patch": patchSchema,
  "canvas.remove": removeSchema,
  "canvas.set_data": dataSchema,
  "canvas.catalog": emptySchema,
  "canvas.request_input": inputSchema,
  "canvas.complete": emptySchema,
  "canvas.close": emptySchema,
} satisfies Record<(typeof toolNames)[number], z.ZodType>;

const validated = <T>(schema: z.ZodType<T>, handler: (input: T) => Promise<unknown>) =>
  async (input: unknown): Promise<unknown> => handler(schema.parse(input));

export const createToolHandlers = (
  backend: CanvasToolsBackend,
): Record<(typeof toolNames)[number], (input: unknown) => Promise<unknown>> => ({
  "canvas.open": validated(openSchema, (input) => backend.open(input)),
  "canvas.set_layout": validated(layoutSchema, (input) => backend.setLayout(input)),
  "canvas.upsert": validated(upsertSchema, (input) => backend.upsert(input)),
  "canvas.patch": validated(patchSchema, (input) => backend.patch(input)),
  "canvas.remove": validated(removeSchema, (input) => backend.remove(input)),
  "canvas.set_data": validated(dataSchema, (input) => backend.setData(input)),
  "canvas.catalog": validated(emptySchema, () => backend.catalog()),
  "canvas.request_input": validated(inputSchema, (input) => backend.requestInput(input)),
  "canvas.complete": validated(emptySchema, () => backend.complete()),
  "canvas.close": validated(emptySchema, () => backend.close()),
});
