import { sanitizeText } from "../security/sanitize.ts";
import { truncateCells, wrapCells } from "./cells.ts";

type StatusColor = "green" | "yellow" | "red";
export type CanvasStatus = "connected" | "disconnected" | "diagnostic";

export interface ViewportChrome {
  readonly headerRows?: number;
  readonly hasDiagnostic: boolean;
  readonly diagnosticRows?: number;
  readonly hasDecision?: boolean;
  readonly decisionRows?: number;
  readonly hasControls: boolean;
  readonly footerRows?: number;
}

export const canvasTerminalWidth = (columns: number): number =>
  Math.max(8, Math.floor(columns));

export const trustedHeaderRows = (width: number): number => width < 32 ? 4 : 3;

export const documentViewportWidth = (columns: number): number =>
  Math.max(8, Math.floor(columns) - 2);

export const decisionCardHeight = (
  prompt: string,
  options: readonly string[],
  width: number,
  maximumRows = Number.POSITIVE_INFINITY,
): number => {
  const innerWidth = Math.max(1, Math.floor(width) - 4);
  const promptRows = wrapCells(sanitizeText(prompt), innerWidth).length;
  const optionRows = options.reduce(
    (total, option, index) => total + wrapCells(decisionOptionText(option, index, 0), innerWidth).length,
    0,
  );
  const helpRows = wrapCells("←/→ choose  Enter confirm", innerWidth).length;
  return Math.min(Math.max(0, Math.floor(maximumRows)), 3 + promptRows + optionRows + helpRows);
};

export const wrappedTextRows = (value: string, width: number): number =>
  wrapCells(sanitizeText(value), Math.max(1, Math.floor(width))).length;

export const clippedWrappedLines = (value: string, width: number, maximumRows: number): string[] => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeRows = Math.max(0, Math.floor(maximumRows));
  if (safeRows === 0) return [];
  const lines = wrapCells(sanitizeText(value), safeWidth);
  if (lines.length <= safeRows) return lines;
  const visible = lines.slice(0, safeRows);
  visible[safeRows - 1] = `${truncateCells(visible[safeRows - 1] ?? "", Math.max(0, safeWidth - 1))}…`;
  return visible;
};

export const contentViewportHeight = (rows: number, chrome: ViewportChrome): number => {
  const headerRows = chrome.headerRows ?? 3;
  const diagnosticRows = chrome.diagnosticRows ?? (chrome.hasDiagnostic ? 1 : 0);
  const decisionRows = chrome.decisionRows ?? (chrome.hasDecision ? 4 : 0);
  const footerRows = chrome.footerRows ?? (decisionRows > 0 ? 0 : 1 + (chrome.hasControls ? 1 : 0));
  return Math.max(0, Math.floor(rows) - headerRows - diagnosticRows - decisionRows - footerRows);
};

export const statusPresentation = (
  status: CanvasStatus,
): { readonly symbol: string; readonly label: string; readonly color: StatusColor } => {
  if (status === "connected") return { symbol: "●", label: "CONNECTED", color: "green" };
  if (status === "diagnostic") return { symbol: "▲", label: "DIAGNOSTIC", color: "yellow" };
  return { symbol: "×", label: "DISCONNECTED", color: "red" };
};

export const decisionOptionText = (
  option: string,
  index: number,
  selected: number,
): string => `${index === selected ? "▶" : " "} ${index + 1}  ${sanitizeText(option)}`;

export const focusSummary = (labels: readonly string[], focused: number): string | undefined => {
  if (labels.length === 0) return undefined;
  const safeIndex = Math.min(Math.max(0, focused), labels.length - 1);
  return `FOCUS ${safeIndex + 1}/${labels.length}  ${sanitizeText(labels[safeIndex] ?? "")}`;
};
