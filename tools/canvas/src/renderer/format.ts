import { componentGroups, compositionHelperNames } from "../catalog/index.ts";
import type { TreeNode } from "../protocol/tree.ts";
import { sanitizeText } from "../security/sanitize.ts";
import { cellWidth, padCells, truncateCells, wrapCells } from "./cells.ts";

const helpers = new Set<string>(compositionHelperNames);
const charts = new Set<string>(componentGroups.find((group) => group.category === "Charts")?.names ?? []);
const graphs = new Set<string>(componentGroups.flatMap((group) => group.names).filter((name) => name.startsWith("Graph")));
const inlineIntrinsics = new Set(["p", "button", "strong", "b", "em", "i", "del", "s", "sup"]);
const MAX_RENDER_WIDTH = 512;

const propText = (node: TreeNode, key: string): string | undefined => {
  const value = node.props[key];
  return typeof value === "string" || typeof value === "number" ? sanitizeText(String(value)) : undefined;
};

const textOf = (node: TreeNode | string): string =>
  typeof node === "string" ? sanitizeText(node) : node.children.map(textOf).join("");

const childNodes = (node: TreeNode, type?: string): TreeNode[] =>
  node.children.filter((child): child is TreeNode => typeof child !== "string" && (type === undefined || child.type === type));

const childNodesDeep = (node: TreeNode, type: string): TreeNode[] => {
  const output: TreeNode[] = [];
  for (const child of childNodes(node)) {
    if (child.type === type) output.push(child);
    output.push(...childNodesDeep(child, type));
  }
  return output;
};

const frame = (title: string | undefined, lines: readonly string[], width: number, corner = "+"): string[] => {
  const inner = Math.max(1, width - 4);
  const label = title === undefined || title.length === 0 ? "" : ` ${truncateCells(title, Math.max(1, inner - 2))} `;
  const top = `${corner}${label}${"─".repeat(Math.max(0, inner + 2 - cellWidth(label)))}${corner}`;
  const source = lines.length === 0 ? [""] : lines;
  const body = source.flatMap((line) => wrapCells(line, inner)).map((line) => `│ ${padCells(line, inner)} │`);
  return [top, ...body, `${corner}${"─".repeat(inner + 2)}${corner}`];
};

const formatChildren = (node: TreeNode, width: number): string[] =>
  node.children.flatMap((child) => typeof child === "string" ? wrapCells(sanitizeText(child), width) : formatNode(child, width));

const listLines = (node: TreeNode, ordered: boolean, width: number): string[] =>
  childNodes(node, "li").flatMap((item, index) => {
    const marker = ordered ? `${index + 1}. ` : "• ";
    return formatChildren(item, Math.max(1, width - cellWidth(marker))).map(
      (line, lineIndex) => `${lineIndex === 0 ? marker : " ".repeat(cellWidth(marker))}${line}`,
    );
  });

const formatTable = (node: TreeNode, width: number): string[] => {
  const rows = childNodesDeep(node, "tr").map((row) =>
    childNodes(row).filter((cell) => cell.type === "th" || cell.type === "td").map((cell) => textOf(cell).trim()),
  );
  if (rows.length === 0) return [];
  const columns = Math.max(...rows.map((row) => row.length), 1);
  if (width < columns * 4 + 1) {
    return rows.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) =>
      wrapCells(`${rowIndex + 1}.${columnIndex + 1} ${value}`, width),
    ));
  }
  const cell = Math.max(3, Math.floor((width - columns - 1) / columns));
  const rule = `+${Array.from({ length: columns }, () => "-".repeat(cell)).join("+")}+`;
  return [rule, ...rows.flatMap((row) => [
    `|${Array.from({ length: columns }, (_, index) => padCells(row[index] ?? "", cell)).join("|")}|`,
    rule,
  ])];
};

const scanNumbers = (value: unknown, output: number[]): void => {
  if (typeof value === "number" && Number.isFinite(value)) output.push(value);
  else if (typeof value === "string") {
    for (const match of value.matchAll(/-?\d+(?:\.\d+)?/gu)) output.push(Number(match[0]));
  } else if (Array.isArray(value)) {
    for (const item of value) scanNumbers(item, output);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) scanNumbers(item, output);
  }
};

const numericValues = (node: TreeNode): number[] => {
  const values: number[] = [];
  for (const [key, value] of Object.entries(node.props)) if (!/^on[A-Z]/u.test(key)) scanNumbers(value, values);
  scanNumbers(textOf(node), values);
  return values.slice(0, 256);
};

const meter = (node: TreeNode, width: number): string[] => {
  const raw = node.props.value ?? textOf(node).trim().split(/\s/u)[0];
  const parsed = typeof raw === "string" && raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw ?? 0);
  const ratio = Math.min(1, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
  const label = `${Math.round(ratio * 100)}%`;
  const cells = Math.max(1, width - cellWidth(label) - 3);
  const filled = Math.round(cells * ratio);
  const caption = propText(node, "caption");
  return [`[${"=".repeat(filled)}${"-".repeat(cells - filled)}] ${label}`, ...(caption === undefined ? [] : [caption])];
};

const chartLines = (node: TreeNode, width: number): string[] => {
  if (node.type === "GraphMeter") return meter(node, width);
  const values = numericValues(node);
  if (values.length === 0) return formatChildren(node, width);
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  const barWidth = Math.max(1, width - 12);
  return values.slice(0, 24).map((value, index) =>
    `${String(index + 1).padStart(2, "0")} ${"█".repeat(Math.round((Math.abs(value) / max) * barWidth))} ${value}`,
  );
};

const entriesFromProps = (node: TreeNode): string[] => {
  for (const key of ["items", "rows", "events", "tasks", "stages", "stats", "data", "values"]) {
    const value = node.props[key];
    if (!Array.isArray(value)) continue;
    return value.slice(0, 256).map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return sanitizeText(String(entry));
      return Object.entries(entry).map(([name, item]) => `${name}: ${sanitizeText(String(item))}`).join("  ");
    });
  }
  return [];
};

const semanticBody = (node: TreeNode, width: number): string[] => {
  const fromProps = entriesFromProps(node);
  if (fromProps.length > 0) return fromProps.flatMap((line) => wrapCells(line, width));
  const children = formatChildren(node, width);
  if (helpers.has(node.type) && children.every((line) => line.length === 0)) {
    const summary = Object.entries(node.props)
      .filter(([name]) => !/^on[A-Z]/u.test(name))
      .slice(0, 256)
      .map(([name, value]) => `${name}: ${sanitizeText(String(value))}`)
      .join("  ");
    return summary.length === 0 ? [] : wrapCells(truncateCells(summary, width * 256), width);
  }
  if (node.type === "Steps") return children.map((line, index) => `${String(index + 1).padStart(2, "0")} ${line}`);
  if (node.type === "Quote") {
    const by = propText(node, "by");
    const source = propText(node, "source");
    return [...children.map((line) => `│ ${line}`), ...(by === undefined ? [] : [`- ${by}${source === undefined ? "" : `, ${source}`}`])];
  }
  if (node.type === "Terminal") {
    const prompt = propText(node, "prompt") ?? "$";
    return children.map((line) => line.startsWith(prompt) ? line : `${prompt} ${line}`);
  }
  if (node.type === "Keys") return children.map((line) => line.replace(/\s*:\s*/u, "  →  "));
  return children;
};

const formatDetails = (node: TreeNode, width: number): string[] => {
  const summary = childNodes(node, "summary")[0];
  const label = summary === undefined ? "Details" : textOf(summary).trim();
  if (node.props.open !== true) return [`▶ ${label}`];
  const body = childNodes(node).filter((child) => child !== summary).flatMap((child) => formatNode(child, width - 2));
  return [`▼ ${label}`, ...body.map((line) => `  ${line}`)];
};

const formatHeading = (node: TreeNode, width: number): string[] => {
  switch (node.type) {
    case "h1": return wrapCells(textOf(node).toUpperCase(), width);
    case "h2": return [...wrapCells(textOf(node), width), "─".repeat(Math.min(width, cellWidth(textOf(node))))];
    case "h3": case "h4": case "h5": case "h6": return wrapCells(textOf(node), width);
    default: return [];
  }
};

const formatStructuredIntrinsic = (node: TreeNode, width: number): string[] => {
  switch (node.type) {
    case "ul": return listLines(node, false, width);
    case "ol": return listLines(node, true, width);
    case "blockquote": return formatChildren(node, width - 2).map((line) => `│ ${line}`);
    case "pre": case "code": return formatChildren(node, width - 2).map((line) => `  ${line}`);
    case "a": {
      const label = textOf(node);
      const href = propText(node, "href");
      return wrapCells(href === undefined || href === label ? label : `${label} (${href})`, width);
    }
    case "hr": return ["─".repeat(width)];
    case "table": return formatTable(node, width);
    case "details": return formatDetails(node, width);
    case "Footnotes": return formatChildren(node, width).map((line, index) => `[${index + 1}] ${line}`);
    case "Canvas.Slot": return [];
    default: return formatChildren(node, width);
  }
};

const formatIntrinsic = (node: TreeNode, width: number): string[] => {
  if (/^h[1-6]$/u.test(node.type)) return formatHeading(node, width);
  if (inlineIntrinsics.has(node.type)) return wrapCells(textOf(node), width);
  return formatStructuredIntrinsic(node, width);
};

const formatNodeUnbounded = (node: TreeNode, width: number): string[] => {
  const safeWidth = Math.min(MAX_RENDER_WIDTH, Math.max(1, Math.floor(width)));
  if (helpers.has(node.type)) return semanticBody(node, safeWidth);
  if (charts.has(node.type)) {
    return frame(propText(node, "title") ?? node.type, chartLines(node, safeWidth - 4), safeWidth, propText(node, "corner"));
  }
  if (graphs.has(node.type)) {
    return frame(propText(node, "title") ?? node.type.replace(/^Graph/u, ""), semanticBody(node, safeWidth - 4), safeWidth, propText(node, "corner"));
  }
  if (node.type === "Graph") return frame(propText(node, "title"), formatChildren(node, safeWidth - 4), safeWidth, propText(node, "corner"));
  if (node.type === "Callout") return frame(propText(node, "title") ?? propText(node, "type") ?? "Note", formatChildren(node, safeWidth - 4), safeWidth, "!");
  if (["Quote", "Terminal", "Steps", "Changelog", "Annotate", "Decision", "Chat", "Env", "Endpoint", "Keys", "Faq"].includes(node.type)) {
    return frame(propText(node, "title") ?? node.type, semanticBody(node, safeWidth - 4), safeWidth);
  }
  return formatIntrinsic(node, safeWidth);
};

export const formatNode = (node: TreeNode, width: number): string[] => {
  const safeWidth = Math.min(MAX_RENDER_WIDTH, Math.max(1, Math.floor(width)));
  return formatNodeUnbounded(node, safeWidth).flatMap((line) => wrapCells(line, safeWidth));
};
