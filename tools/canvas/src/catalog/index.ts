export type NodeClassification = "component" | "composition-helper" | "internal" | "intrinsic";

export type CatalogCategory =
  | "Content"
  | "Diagrams"
  | "Data"
  | "Charts"
  | "Time"
  | "Primitive"
  | "Helpers"
  | "Internal"
  | "MDX";

export interface CatalogEntry {
  readonly name: string;
  readonly category: CatalogCategory;
  readonly classification: NodeClassification;
  readonly propsSchema: Readonly<Record<string, unknown>>;
  readonly example: string;
  readonly compatibilityNotes: readonly string[];
}

export const componentGroups = [
  {
    category: "Content",
    names: [
      "Callout",
      "Quote",
      "Steps",
      "Terminal",
      "Changelog",
      "Annotate",
      "Decision",
      "Chat",
      "Env",
      "Endpoint",
      "Keys",
      "Faq",
    ],
    compatibilityNotes: [
      "Text and semantic props are preserved in terminal output.",
      "Hover states, CSS styling, and DOM references have no terminal equivalent.",
    ],
  },
  {
    category: "Diagrams",
    names: ["GraphFlow", "GraphTimeline", "GraphTree", "GraphGantt", "GraphBoard"],
    compatibilityNotes: [
      "Diagram layout adapts to the terminal width.",
      "Pointer hover and exact browser geometry are unavailable.",
    ],
  },
  {
    category: "Data",
    names: [
      "GraphStat",
      "GraphSpec",
      "GraphCheck",
      "GraphDiff",
      "GraphKpi",
      "GraphTable",
      "GraphSheet",
      "GraphCompare",
      "GraphMatrix",
      "GraphInvoice",
    ],
    compatibilityNotes: [
      "Structured values use terminal text and table layouts.",
      "Column widths adapt to the available terminal width.",
    ],
  },
  {
    category: "Charts",
    names: [
      "GraphRank",
      "GraphFunnel",
      "GraphSlope",
      "GraphBullet",
      "GraphScore",
      "GraphWaterfall",
      "GraphStack",
      "GraphSpark",
      "GraphPlot",
      "GraphMeter",
      "GraphWaffle",
      "GraphCells",
      "GraphBars",
      "GraphHeatmap",
      "GraphActivity",
    ],
    compatibilityNotes: [
      "Charts use text and Unicode glyphs sized to the terminal width.",
      "Pointer hover, animation, and pixel-level styling are unavailable.",
      "The current native terminal formatter may infer observations from numeric text and omit category labels. Inspect rendered output and use an explicit labelled Graph/pre layout when semantics are lost.",
    ],
  },
  {
    category: "Time",
    names: ["GraphUptime", "GraphCalendar", "GraphTimer", "GraphCountdown"],
    compatibilityNotes: [
      "Time data is laid out for terminal cells and the current pane width.",
      "Animation can be paused; browser hover and CSS styling are unavailable.",
    ],
  },
  {
    category: "Primitive",
    names: ["Graph"],
    compatibilityNotes: [
      "Graph frames child content for terminal display.",
      "Browser CSS and DOM references are unavailable.",
    ],
  },
] as const;

export const publicComponentNames = componentGroups.flatMap((group) => group.names);

export const compositionHelperNames = [
  "Head",
  "Row",
  "Foot",
  "Cell",
  "Step",
  "Change",
  "Section",
  "Path",
  "Series",
  "Rank",
  "Grid",
  "Node",
  "Event",
  "Task",
  "Bar",
  "Segment",
  "Stage",
  "Span",
  "Line",
  "From",
  "To",
  "Meta",
  "Item",
  "Total",
  "Col",
  "Stat",
  "Field",
  "Delta",
  "Target",
] as const;

export const internalNodeNames = ["Footnotes", "Canvas.Slot"] as const;

export const intrinsicNodeNames = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "section",
  "button",
  "input",
  "details",
  "summary",
  "sup",
] as const;

export const allowedNodeNames = [
  ...publicComponentNames,
  ...compositionHelperNames,
  ...internalNodeNames,
  ...intrinsicNodeNames,
] as const;

const componentEntries: CatalogEntry[] = componentGroups.flatMap((group) =>
  group.names.map((name) => ({
    name,
    category: group.category,
    classification: "component" as const,
    propsSchema: componentPropsSchema(group.category),
    example: componentExample(name, group.category),
    compatibilityNotes: group.compatibilityNotes,
  })),
);

const genericPropsSchema = Object.freeze({
  type: "object",
  additionalProperties: true,
});

function componentPropsSchema(category: CatalogCategory): Readonly<Record<string, unknown>> {
  const properties: Record<string, unknown> = {
    title: { type: "string" },
  };
  if (category === "Data" || category === "Diagrams" || category === "Time") {
    properties.data = { type: "array", items: {} };
    properties.items = { type: "array", items: {} };
    properties.value = { type: ["number", "string"] };
  }
  return Object.freeze({ type: "object", properties: Object.freeze(properties), additionalProperties: true });
}

function componentExample(name: string, category: CatalogCategory): string {
  if (name === "Graph") return '<Graph title="Plan">Terminal content</Graph>';
  if (name === "GraphMeter") return '<GraphMeter title="Usage" value="72%" caption="CPU" />';
  if (category === "Charts") {
    return "<Graph title=\"Labelled values\"><pre>{'A | █ 1 unit'}</pre><p>Scale: 0 to 1 unit</p></Graph>";
  }
  if (category === "Data" || category === "Diagrams" || category === "Time") {
    return `<${name} title="Example" data={[{ label: 'A', value: 1 }]} />`;
  }
  return `<${name} title="Example">Terminal content</${name}>`;
}

const helperNotes = [
  "Composition-only node; props and children carry JSON data to a parent renderer.",
];

const internalNotesByName = {
  Footnotes: [
    "Footnote references render as a numbered terminal list; hover-only tooltips are unavailable.",
  ],
  "Canvas.Slot": [
    "Inserts a named instance into the document; unmatched instances append after document content.",
  ],
} as const;

const intrinsicNotes = [
  "Safe MDX host element rendered with terminal text and semantic structure.",
  "Browser CSS, DOM references, and pointer hover are unavailable.",
];

export const catalogEntries: readonly CatalogEntry[] = [
  ...componentEntries,
  ...compositionHelperNames.map((name) => ({
    name,
    category: "Helpers" as const,
    classification: "composition-helper" as const,
    propsSchema: genericPropsSchema,
    example: `<${name}>content</${name}>`,
    compatibilityNotes: helperNotes,
  })),
  ...internalNodeNames.map((name) => ({
    name,
    category: "Internal" as const,
    classification: "internal" as const,
    propsSchema: name === "Canvas.Slot"
      ? { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["id"], additionalProperties: false }
      : genericPropsSchema,
    example: name === "Canvas.Slot" ? '<Canvas.Slot id="summary" />' : '<Footnotes>Notes</Footnotes>',
    compatibilityNotes: internalNotesByName[name],
  })),
  ...intrinsicNodeNames.map((name) => ({
    name,
    category: "MDX" as const,
    classification: "intrinsic" as const,
    propsSchema: genericPropsSchema,
    example: `<${name}>content</${name}>`,
    compatibilityNotes: intrinsicNotes,
  })),
];

const entriesByName = new Map(catalogEntries.map((entry) => [entry.name, entry]));

export const getCatalogEntry = (name: string): CatalogEntry | undefined =>
  entriesByName.get(name);
