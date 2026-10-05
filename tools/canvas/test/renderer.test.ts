import { describe, expect, test } from "bun:test";

import { publicComponentNames } from "../src/catalog/index.ts";
import { formatNode } from "../src/renderer/format.ts";
import { cellWidth } from "../src/renderer/cells.ts";

describe("native terminal adapters", () => {
  test("renders every public mdxcn component name through a trusted adapter", () => {
    for (const name of publicComponentNames) {
      const output = formatNode({ type: name, props: { title: name }, children: ["content"] }, 40);
      expect(output.length).toBeGreaterThan(0);
      expect(output.join("\n")).not.toContain("undefined");
      expect(output.join("\n")).not.toContain(`[${name}]`);
      expect(output.every((line) => cellWidth(line) <= 40)).toBe(true);
    }
  });

  test("sanitizes text again at the terminal boundary", () => {
    const output = formatNode(
      { type: "Callout", props: { title: "\u001b[2JAlert" }, children: ["safe\u0007text"] },
      40,
    );

    expect(output.join("\n")).not.toContain("\u001b");
    expect(output.join("\n")).not.toContain("\u0007");
    expect(output.join("\n")).toContain("Alert");
    expect(output.join("\n")).toContain("safetext");
  });

  test("uses a plain attribution marker for terminal quotes", () => {
    const output = formatNode({ type: "Quote", props: { by: "Ada" }, children: ["hello"] }, 30).join("\n");
    expect(output).toContain("- Ada");
    expect(output).not.toContain("—");
  });

  test("adapts meters to the available terminal width", () => {
    const output = formatNode(
      { type: "GraphMeter", props: { value: "50%", caption: "disk" }, children: [] },
      20,
    );

    expect(output.join("\n")).toContain("[=====-----] 50%");
    expect(output.join("\n")).toContain("disk");
    expect(output.every((line) => cellWidth(line) <= 20)).toBe(true);
  });

  test("uses terminal display cells for Unicode and narrow layouts", () => {
    const output = formatNode(
      { type: "Graph", props: { title: "界🙂" }, children: ["cafe\u0301 and 界🙂"] },
      12,
    );
    expect(output.every((line) => cellWidth(line) <= 12)).toBe(true);
    expect(output.join("\n")).toContain("界");
  });

  test("keeps inline text and expression children on the same line", () => {
    const output = formatNode({
      type: "button",
      props: {},
      children: ["Inspections: ", "11"],
    }, 20);

    expect(output).toEqual(["Inspections: 11"]);
  });

  test("consumes helper nodes without exposing structural labels", () => {
    const output = formatNode({
      type: "GraphStat",
      props: { title: "Stats" },
      children: [{ type: "Stat", props: { value: "12", label: "docs" }, children: [] }],
    }, 30).join("\n");
    expect(output).not.toContain("[Stat]");
    expect(output).toContain("value: 12");
  });

  test("caps component-specific rendering work for implausibly wide terminals", () => {
    const output = formatNode({ type: "Graph", props: { title: "wide" }, children: ["content"] }, 10_000);
    expect(Math.max(...output.map(cellWidth))).toBeLessThanOrEqual(512);
  });

  test("bounds helper prop formatting work", () => {
    const props = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field${index}`, index]));
    const output = formatNode({ type: "Field", props, children: [] }, 40);
    expect(output.length).toBeLessThanOrEqual(256);
  });

  test("keeps wide tables and nested structures within narrow display widths", () => {
    const table: Parameters<typeof formatNode>[0] = {
      type: "table",
      props: {},
      children: [{
        type: "tbody",
        props: {},
        children: [{
          type: "tr",
          props: {},
          children: Array.from({ length: 8 }, (_, index) => ({
            type: "td",
            props: {},
            children: [`column ${index + 1}`],
          })),
        }],
      }],
    };
    const nested: Parameters<typeof formatNode>[0] = {
      type: "blockquote",
      props: {},
      children: [{ type: "ul", props: {}, children: [{ type: "li", props: {}, children: ["narrow nested content"] }] }],
    };

    expect(formatNode(table, 8).every((line) => cellWidth(line) <= 8)).toBe(true);
    expect(formatNode(nested, 8).every((line) => cellWidth(line) <= 8)).toBe(true);
  });
});
