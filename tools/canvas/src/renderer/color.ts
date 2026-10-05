export type TerminalColor = "cyan" | "green" | "yellow" | "red";

export interface StyledSegment {
  readonly text: string;
  readonly color: TerminalColor | undefined;
  readonly bold: boolean | undefined;
  readonly dimColor: boolean | undefined;
}

const segment = (
  text: string,
  style: { readonly color?: TerminalColor; readonly bold?: boolean; readonly dimColor?: boolean } = {},
): StyledSegment => ({
  text,
  color: style.color,
  bold: style.bold,
  dimColor: style.dimColor,
});

const semanticStyle = (value: string): { readonly color: TerminalColor; readonly bold: true } | undefined => {
  const normalized = value.toLowerCase();
  if (/^(passed|pass|success|successful|complete|completed|healthy|ready)$/u.test(normalized)) {
    return { color: "green", bold: true };
  }
  if (/^(waiting|pending|running|verifying|warning|paused)$/u.test(normalized)) {
    return { color: "yellow", bold: true };
  }
  if (/^(failed|failure|error|blocked|denied|disconnected)$/u.test(normalized)) {
    return { color: "red", bold: true };
  }
  return undefined;
};

const FRAME_TITLE = /^(\s*[+!╔┌]\s*)([^─-]+?)(\s+[─-]{2,}.*)$/u;
const TOKENS = /(?:[=█▓■▰▱]+)|(?:\b\d+(?:\.\d+)?%?)|(?:\b[A-Za-z][A-Za-z0-9_-]*:)|(?:\b(?:passed|pass|success|successful|complete|completed|healthy|ready|waiting|pending|running|verifying|warning|paused|failed|failure|error|blocked|denied|disconnected)\b)/giu;

const styledToken = (value: string): StyledSegment => {
  const semantic = semanticStyle(value);
  if (semantic !== undefined) return segment(value, semantic);
  if (/^[=█▓■▰▱]+$/u.test(value)) return segment(value, { color: "cyan" });
  if (/^\d+(?:\.\d+)?%?$/u.test(value)) return segment(value, { color: "cyan", bold: value.endsWith("%") });
  if (value.endsWith(":")) return segment(value, { dimColor: true });
  return segment(value);
};

export const colorizeTerminalLine = (line: string): StyledSegment[] => {
  const frame = line.match(FRAME_TITLE);
  if (frame !== null) {
    return [
      segment(frame[1] ?? "", { dimColor: true }),
      segment((frame[2] ?? "").trim(), { color: "cyan", bold: true }),
      segment(frame[3] ?? "", { dimColor: true }),
    ];
  }

  const output: StyledSegment[] = [];
  let cursor = 0;
  for (const match of line.matchAll(TOKENS)) {
    const index = match.index ?? cursor;
    if (index > cursor) output.push(segment(line.slice(cursor, index)));
    output.push(styledToken(match[0]));
    cursor = index + match[0].length;
  }
  if (cursor < line.length) output.push(segment(line.slice(cursor)));
  return output.length === 0 ? [segment(line)] : output;
};
