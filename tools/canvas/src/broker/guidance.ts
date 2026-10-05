import { toolNames } from "./tools.ts";

type CanvasToolName = (typeof toolNames)[number];

export const canvasServerInstructions = [
  "Use this server only after the user explicitly requests a live Herdr canvas, such as by saying `canvas on` or `use herdr-canvas`.",
  "Do not open a canvas solely because a task is substantial, complex, or uses planning, investigation, implementation, or verification.",
  "Open an appropriate template early. Repeated canvas.open calls reuse the owned session and do not change its layout.",
  "When a packaged skill layout is available, initialize its complete dataset and apply that layout once before substantial work.",
  "Use canvas.set_data for complete named dataset replacements that preserve the active layout and React state. Pass the dataset name as the key: use `canvas`, not `data.canvas`; MDX reads that dataset as `data.canvas`.",
  "Use canvas.set_layout only when the presentation must materially change; it starts a replacement worker and resets document state after a valid first render.",
  "Use canvas.request_input only for a real 2-12 option choice, and wait for its returned value. Ask free-text questions in chat.",
  "If access is missing, denied, or sandbox_unavailable, explain once and continue the underlying task in chat.",
  "Publish only observed progress and evidence. Finish with canvas.complete so the view remains visible; use canvas.close only when closure is requested.",
].join(" ");

export const canvasToolDescriptions: Readonly<Record<CanvasToolName, string>> = {
  "canvas.open":
    "Open the owned Herdr canvas early with a delivery, architecture, debug, or blank template. Repeated calls reuse the same session and do not switch its current layout.",
  "canvas.set_layout":
    "Replace the complete MDX document when the presentation must materially change. A valid first render is required before the new worker replaces the current canvas; React document state resets.",
  "canvas.upsert":
    "Create or replace one slot component by stable id in the current template. Props replace that slot's complete props object.",
  "canvas.patch":
    "Shallow-merge props into an existing slot component by id. Nested objects are replaced, not recursively merged.",
  "canvas.remove":
    "Remove one existing slot component by stable id from the current template.",
  "canvas.set_data":
    "Replace one complete named JSON dataset while preserving the active layout and healthy worker React state. Pass only the dataset name as key, for example `canvas`, not `data.canvas`; the layout reads it as `data.canvas`. Include every field that must remain.",
  "canvas.catalog":
    "Inspect supported terminal components, props, examples, and compatibility notes before authoring MDX beyond the tested skill layouts.",
  "canvas.request_input":
    "Show a trusted 2-12 option choice outside untrusted MDX and wait for the actual returned value. Cancellation, timeout, or disconnect is not an answer; free text belongs in chat.",
  "canvas.complete":
    "Mark the task view complete and leave it visible while the broker remains connected. This does not promise persistence after the host exits.",
  "canvas.close":
    "Explicitly close the owned canvas pane and end its session. Use only when the user asks to close it; do not repeatedly reopen a manually closed pane.",
};
