import { z } from "zod";

import { treeSchema } from "./tree.ts";
import { callbackHandleSchema } from "./tree.ts";

export interface RendererStateUpdate {
  readonly revision: number;
  readonly state: RendererState;
}

export const rendererStateSchema = z.object({
  status: z.enum(["connected", "disconnected", "diagnostic"]),
  tree: treeSchema.optional(),
  diagnostic: z.string().max(16_384).optional(),
  decision: z.object({
    id: z.string().min(1).max(128),
    prompt: z.string().min(1).max(4_096),
    options: z.array(z.string().min(1).max(256)).min(2).max(12),
  }).strict().optional(),
}).strict();

export type RendererState = z.output<typeof rendererStateSchema>;
export type RendererDecision = NonNullable<RendererState["decision"]>;

export const brokerToRendererSchema = z.object({
  type: z.literal("state"),
  revision: z.number().int().nonnegative(),
  state: rendererStateSchema,
}).strict();

export const rendererToBrokerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1).max(256) }).strict(),
  z.object({
    type: z.literal("decision"),
    requestId: z.string().min(1).max(128),
    value: z.string().min(1).max(256),
  }).strict(),
  z.object({
    type: z.literal("event"),
    handle: callbackHandleSchema,
    payload: z.unknown().optional(),
  }).strict(),
]);
