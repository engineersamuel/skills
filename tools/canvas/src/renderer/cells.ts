import stringWidth from "string-width";

const graphemes = (value: string): string[] => {
  const Segmenter = Intl.Segmenter;
  if (Segmenter === undefined) return Array.from(value);
  return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((part) => part.segment);
};

export const cellWidth = (value: string): number => stringWidth(value);

export const truncateCells = (value: string, width: number): string => {
  if (width <= 0) return "";
  let output = "";
  for (const grapheme of graphemes(value)) {
    if (cellWidth(output + grapheme) > width) break;
    output += grapheme;
  }
  return output;
};

export const padCells = (value: string, width: number): string => {
  const clipped = truncateCells(value, width);
  return clipped + " ".repeat(Math.max(0, width - cellWidth(clipped)));
};

const isWhitespace = (value: string | undefined): boolean => /^\s+$/u.test(value ?? "");

const findWrapBoundary = (
  units: readonly string[],
  start: number,
  limit: number,
): { readonly end: number; readonly lastWhitespace: number } => {
  let end = start;
  let width = 0;
  let lastWhitespace = -1;
  while (end < units.length) {
    const nextWidth = cellWidth(units[end] ?? "");
    if (end > start && width + nextWidth > limit) break;
    width += nextWidth;
    if (isWhitespace(units[end])) lastWhitespace = end;
    end += 1;
    if (width >= limit) break;
  }
  return { end, lastWhitespace };
};

const skipWhitespace = (units: readonly string[], start: number): number => {
  let index = start;
  while (index < units.length && isWhitespace(units[index])) index += 1;
  return index;
};

const wrapSourceLine = (sourceLine: string, limit: number): string[] => {
  const units = graphemes(sourceLine);
  const lines: string[] = [];
  let start = 0;
  while (start < units.length) {
    const { end, lastWhitespace } = findWrapBoundary(units, start, limit);
    if (end >= units.length) {
      lines.push(units.slice(start).join("").trimEnd());
      break;
    }
    const breakAt = lastWhitespace > start ? lastWhitespace : end;
    lines.push(units.slice(start, breakAt).join("").trimEnd());
    start = skipWhitespace(units, lastWhitespace > start ? lastWhitespace + 1 : end);
  }
  return lines;
};

export const wrapCells = (value: string, width: number): string[] => {
  const limit = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  for (const sourceLine of value.split("\n")) {
    if (sourceLine.length === 0) {
      lines.push("");
      continue;
    }
    lines.push(...wrapSourceLine(sourceLine, limit));
  }
  return lines;
};
