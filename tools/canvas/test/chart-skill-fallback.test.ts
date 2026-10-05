import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { formatNode } from "../src/renderer/format.ts";
import { validateTree } from "../src/protocol/tree.ts";
import type { JsonValue } from "../src/security/sanitize.ts";
import { createWorkerRuntime } from "../src/worker/runtime.ts";

const skillRoot = join(import.meta.dir, "../../../skills/herdr-canvas");
const fixturePath = join(skillRoot, "fixtures/chart-correctness.json");
const fallbackPath = join(skillRoot, "layouts/labelled-bars.mdx");

const render = async (
  mdx: string,
  datasets: Record<string, JsonValue>,
  width = 110,
) => {
  const worker = createWorkerRuntime({ generation: 1, datasets });
  const result = await worker.render(mdx);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return {
    worker,
    text: formatNode(validateTree(result.snapshot.tree), width).join("\n"),
  };
};

describe("herdr-canvas chart compatibility", () => {
  test("reproduces the native GraphBars label and title-number defect", async () => {
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as {
      rangeStatus: JsonValue;
    };
    const { worker, text } = await render(
      `
<GraphBars title={data.chart.title} data={data.chart.data} />
`,
      { chart: fixtures.rangeStatus },
    );

    expect(text).toContain("01 ");
    expect(text).toContain(" 1");
    expect(text).not.toContain("Unresearched / zero");
    expect(text).not.toContain("Positive recorded");
    expect(text).not.toContain("Blank");
    await worker.close();
  });

  test("preserves labels, values, units, scales, and complete category sets", async () => {
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as Record<
      string,
      JsonValue
    >;
    const fallback = await readFile(fallbackPath, "utf8");

    const range = await render(fallback, { chart: fixtures.rangeStatus! });
    const rangeRows = range.text.split("\n").filter((line) => line.includes(" | "));
    expect(rangeRows).toHaveLength(3);
    expect(range.text).toContain("Unresearched / zero");
    expect(range.text).toContain("196,235 records");
    expect(range.text).toContain("Positive recorded");
    expect(range.text).toContain("103,444 records");
    expect(range.text).toContain("Blank");
    expect(range.text).toContain("26 records");
    expect(range.text).not.toContain("01 ");
    await range.worker.close();

    const years = await render(fallback, { chart: fixtures.yearCoverage! });
    expect(years.text.split("\n").filter((line) => line.includes(" | "))).toHaveLength(2);
    expect(years.text).toContain("2018");
    expect(years.text).toContain("99.9897%");
    expect(years.text).toContain("2024");
    expect(years.text).toContain("0.29118%");
    expect(years.text).toContain("Scale: 0 to 100%");
    expect(years.text).toContain("Denominator:");
    await years.worker.close();

    const digits = await render(fallback, { chart: fixtures.digitLabels! });
    expect(digits.text.split("\n").filter((line) => line.includes(" | "))).toHaveLength(2);
    expect(digits.text).toContain("Model 3");
    expect(digits.text).toContain("25-49");
    await digits.worker.close();

    const equal = await render(fallback, { chart: fixtures.equalValues! });
    expect(equal.text).toContain("Alpha |");
    expect(equal.text).toContain("Beta |");
    await equal.worker.close();

    const missing = await render(fallback, { chart: fixtures.missingStates! });
    expect(missing.text).toContain("Measured zero |  0 records");
    expect(missing.text).toContain("Blank | [blank in source]");
    expect(missing.text).toContain("Unknown | [unknown in source]");
    await missing.worker.close();

    const signed = await render(fallback, { chart: fixtures.percentageChanges! });
    expect(signed.text).toContain("Decrease | -12%");
    expect(signed.text).toContain("Increase | 135%");
    expect(signed.text).toContain("not a proportion scale");
    await signed.worker.close();

    const tiny = await render(fallback, { chart: fixtures.tinyPositive! });
    expect(tiny.text).toContain("Rare event");
    expect(tiny.text).toContain("0.0000042 ratio");
    await tiny.worker.close();

    const many = await render(fallback, { chart: fixtures.manyCategories! });
    expect(many.text.split("\n").filter((line) => /Category \d{2} \|/u.test(line))).toHaveLength(25);
    expect(many.text).toContain("Category 25 | 25 records");
    await many.worker.close();
  });

  test("keeps long labels, values, and units readable at 60 and 110 columns", async () => {
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as Record<
      string,
      JsonValue
    >;
    const fallback = await readFile(fallbackPath, "utf8");
    for (const width of [60, 110]) {
      const rendered = await render(fallback, { chart: fixtures.longLabels! }, width);
      for (const token of [
        "A long category label",
        "must remain readable",
        "narrow terminal",
        "12 records",
        "Scale: 0 to 12 records",
      ]) {
        expect(rendered.text).toContain(token);
      }
      await rendered.worker.close();
    }
  });

  test("formats values without locale APIs and rejects malformed inputs", async () => {
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as Record<
      string,
      JsonValue
    >;
    const fallback = await readFile(fallbackPath, "utf8");
    const localeSafe = await render(fallback, { chart: fixtures.rangeStatus! });
    expect(localeSafe.text).toContain("196,235 records");
    await localeSafe.worker.close();

    for (const malformed of fixtures.malformed as JsonValue[]) {
      const worker = createWorkerRuntime({
        generation: 2,
        datasets: { chart: malformed },
      });
      const result = await worker.render(fallback);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected malformed chart to fail");
      expect(result.diagnostic.code).toBe("render_failed");
      await worker.close();
    }

    expect(() =>
      createWorkerRuntime({
        generation: 3,
        datasets: {
          chart: {
            ...(fixtures.rangeStatus as Record<string, JsonValue>),
            data: [{ label: "Infinite", value: Number.POSITIVE_INFINITY }],
          } as unknown as JsonValue,
        },
      })
    ).toThrow();
  });

  test("does not depend on runtime locale-formatting support", async () => {
    const fallback = await readFile(fallbackPath, "utf8");
    expect(fallback).not.toContain("toLocaleString");
    expect(fallback).not.toContain("Intl.");
  });
});
