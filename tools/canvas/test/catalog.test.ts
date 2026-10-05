import { describe, expect, test } from "bun:test";

import { catalogEntries } from "../src/catalog/index.ts";

describe("trusted component catalog", () => {
  test("lists all 47 public mdxcn components in their documented categories", () => {
    const expectedByCategory = {
      Content: [
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
      Diagrams: ["GraphFlow", "GraphTimeline", "GraphTree", "GraphGantt", "GraphBoard"],
      Data: [
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
      Charts: [
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
      Time: ["GraphUptime", "GraphCalendar", "GraphTimer", "GraphCountdown"],
      Primitive: ["Graph"],
    } as const;

    for (const [category, expectedNames] of Object.entries(expectedByCategory)) {
      expect(
        catalogEntries
          .filter((entry) => entry.classification === "component" && entry.category === category)
          .map((entry) => entry.name),
      ).toEqual([...expectedNames]);
    }
    expect(catalogEntries.filter((entry) => entry.classification === "component")).toHaveLength(47);
  });

  test("classifies composition helpers and internal nodes separately", () => {
    const classifiedNames = (classification: string) =>
      catalogEntries
        .filter((entry) => entry.classification === classification)
        .map((entry) => entry.name);

    expect(classifiedNames("composition-helper")).toEqual([
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
    ]);
    expect(classifiedNames("internal")).toEqual(["Footnotes", "Canvas.Slot"]);
  });

  test("classifies the safe MDX intrinsic nodes separately from mdxcn components", () => {
    const intrinsicNames = catalogEntries
      .filter((entry) => entry.classification === "intrinsic")
      .map((entry) => entry.name);

    expect(intrinsicNames).toEqual([
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
    ]);
  });

  test("provides terminal compatibility notes for every allowed node", () => {
    expect(catalogEntries.length).toBeGreaterThan(47);
    expect(
      catalogEntries.every(
        (entry) =>
          Array.isArray(entry.compatibilityNotes) &&
          entry.compatibilityNotes.length > 0 &&
          entry.compatibilityNotes.every((note) => typeof note === "string" && note.length > 0),
      ),
    ).toBe(true);
  });

  test("provides a props schema and MDX example for every public component", () => {
    const publicEntries = catalogEntries.filter((entry) => entry.classification === "component");
    for (const entry of publicEntries) {
      expect(entry.propsSchema).toMatchObject({ type: "object" });
      if (entry.category === "Charts" && entry.name !== "GraphMeter") {
        expect(entry.example).toContain("<Graph title=\"Labelled values\">");
      } else {
        expect(entry.example).toContain(`<${entry.name}`);
      }
    }
  });

  test("warns about native chart inference and recommends a labelled fallback", () => {
    const graphBars = catalogEntries.find((entry) => entry.name === "GraphBars");
    expect(graphBars).toBeDefined();
    expect(graphBars?.compatibilityNotes.join(" ")).toContain(
      "infer observations from numeric text",
    );
    expect(graphBars?.example).toContain("<Graph title=\"Labelled values\">");
    expect(graphBars?.example).toContain("Scale: 0 to 1 unit");
  });
});
