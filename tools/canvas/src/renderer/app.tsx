import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CallbackHandle, TreeNode } from "../protocol/tree.ts";
import { sanitizeText } from "../security/sanitize.ts";
import { truncateCells, wrapCells } from "./cells.ts";
import { colorizeTerminalLine } from "./color.ts";
import { formatNode } from "./format.ts";
import {
  canvasTerminalWidth,
  clippedWrappedLines,
  contentViewportHeight,
  decisionCardHeight,
  decisionOptionText,
  documentViewportWidth,
  focusSummary,
  statusPresentation,
  trustedHeaderRows,
  wrappedTextRows,
} from "./presentation.ts";

export interface DecisionCard {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly onChoose: (requestId: string, value: string) => void;
}

export interface CanvasAppProps {
  readonly tree?: TreeNode;
  readonly status: "connected" | "disconnected" | "diagnostic";
  readonly diagnostic?: string;
  readonly decision?: DecisionCard;
  readonly onEvent?: (handle: CallbackHandle) => void;
}

type InteractiveNode =
  | { readonly kind: "callback"; readonly handle: CallbackHandle; readonly label: string }
  | { readonly kind: "details"; readonly path: string; readonly label: string };

const isCallbackHandle = (value: unknown): value is CallbackHandle =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "$type" in value &&
  value.$type === "callback";

const textOf = (node: TreeNode | string): string =>
  typeof node === "string" ? sanitizeText(node) : node.children.map(textOf).join("");

const collectInteractiveNodes = (root: TreeNode | undefined): InteractiveNode[] => {
  if (root === undefined) return [];
  const found: InteractiveNode[] = [];
  const visit = (node: TreeNode, path: string): void => {
    if (node.type === "details") {
      const summary = node.children.find((child): child is TreeNode => typeof child !== "string" && child.type === "summary");
      found.push({ kind: "details", path, label: summary === undefined ? "Details" : textOf(summary).trim() });
    }
    for (const [name, value] of Object.entries(node.props)) {
      if (/^on[A-Z]/u.test(name) && isCallbackHandle(value)) {
        found.push({ kind: "callback", handle: value, label: textOf(node).trim() || node.type });
        break;
      }
    }
    node.children.forEach((child, index) => {
      if (typeof child !== "string") visit(child, `${path}.${index}`);
    });
  };
  visit(root, "0");
  return found;
};

const applyExpandedDetails = (node: TreeNode, expanded: ReadonlySet<string>, path = "0"): TreeNode => ({
  ...node,
  props: node.type === "details" && expanded.has(path) ? { ...node.props, open: true } : node.props,
  children: node.children.map((child, index) =>
    typeof child === "string" ? child : applyExpandedDetails(child, expanded, `${path}.${index}`),
  ),
});

interface DecisionLine {
  readonly text: string;
  readonly optionIndex?: number;
}

const decisionLines = (decision: DecisionCard, selected: number, width: number): DecisionLine[] => {
  const innerWidth = Math.max(1, width - 4);
  return [
    ...wrapCells(sanitizeText(decision.prompt), innerWidth).map((text) => ({ text })),
    ...decision.options.flatMap((option, optionIndex) =>
      wrapCells(decisionOptionText(option, optionIndex, selected), innerWidth)
        .map((text) => ({ text, optionIndex })),
    ),
  ];
};

const keepSelectedDecisionVisible = (
  lines: readonly DecisionLine[],
  selected: number,
  current: number,
  capacity: number,
): number => {
  if (capacity <= 0) return 0;
  const first = lines.findIndex((line) => line.optionIndex === selected);
  if (first < 0) return Math.min(current, Math.max(0, lines.length - capacity));
  let last = first;
  while (last + 1 < lines.length && lines[last + 1]?.optionIndex === selected) last += 1;
  if (first < current) return first;
  if (last >= current + capacity) return Math.max(0, last - capacity + 1);
  return Math.min(current, Math.max(0, lines.length - capacity));
};

const DecisionView = ({
  decision,
  selected,
  width,
  height,
  offset,
}: {
  decision: DecisionCard;
  selected: number;
  width: number;
  height: number;
  offset: number;
}) => {
  const lines = decisionLines(decision, selected, width);
  const capacity = Math.max(0, height - 4);
  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1} height={height}>
      <Text bold color="cyan">ACTION REQUIRED</Text>
      <Box flexDirection="column" height={capacity}>
        {lines.slice(offset, offset + capacity).map((line, index) => (
          <Text
            key={`${offset + index}:${line.text}`}
            inverse={line.optionIndex === selected}
            bold={line.optionIndex === selected}
          >
            {line.text}
          </Text>
        ))}
      </Box>
      <Text dimColor>{truncateCells("↑/↓ inspect  ←/→ choose  Enter confirm", Math.max(1, width - 4))}</Text>
    </Box>
  );
};

const handleDecisionInput = (
  key: { readonly leftArrow: boolean; readonly rightArrow: boolean; readonly return: boolean },
  decision: DecisionCard,
  selected: { current: number },
  setSelected: React.Dispatch<React.SetStateAction<number>>,
): void => {
  if (key.leftArrow) {
    selected.current = Math.max(0, selected.current - 1);
    setSelected(selected.current);
  }
  if (key.rightArrow) {
    selected.current = Math.min(decision.options.length - 1, selected.current + 1);
    setSelected(selected.current);
  }
  if (!key.return) return;
  const option = decision.options[selected.current];
  if (option !== undefined) decision.onChoose(decision.id, option);
};

const toggleDetails = (
  path: string,
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
): void => {
  setExpanded((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
};

const activateControl = (
  control: InteractiveNode | undefined,
  onEvent: CanvasAppProps["onEvent"],
  setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
): void => {
  if (control?.kind === "callback") onEvent?.(control.handle);
  if (control?.kind === "details") toggleDetails(control.path, setExpanded);
};

const DocumentLine = ({ line }: { readonly line: string }) => (
  <Text>
    {colorizeTerminalLine(line).map((part, index) => (
      <Text
        key={`${index}:${part.text}`}
        {...(part.color === undefined ? {} : { color: part.color })}
        {...(part.bold === undefined ? {} : { bold: part.bold })}
        {...(part.dimColor === undefined ? {} : { dimColor: part.dimColor })}
      >
        {part.text}
      </Text>
    ))}
  </Text>
);

const useTerminalSize = (stdout: NodeJS.WriteStream): { readonly columns: number; readonly rows: number } => {
  const [size, setSize] = useState(() => ({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 }));
  useEffect(() => {
    const resize = (): void => setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", resize);
    return () => { stdout.off("resize", resize); };
  }, [stdout]);
  return size;
};

interface CanvasLayout {
  readonly width: number;
  readonly documentWidth: number;
  readonly headerRows: number;
  readonly diagnosticRows: number;
  readonly diagnosticLines: readonly string[];
  readonly decisionRows: number;
  readonly documentRows: number;
  readonly footerText: string;
  readonly focusLines: readonly string[];
}

const calculateCanvasLayout = (
  terminalSize: { readonly columns: number; readonly rows: number },
  diagnostic: string | undefined,
  decision: DecisionCard | undefined,
  focus: string | undefined,
  paused: boolean,
  hasControls: boolean,
): CanvasLayout => {
  const width = canvasTerminalWidth(terminalSize.columns);
  const documentWidth = documentViewportWidth(width);
  const headerRows = trustedHeaderRows(width);
  const footerText = `Tab focus  Enter ${paused ? "unavailable" : "activate"}  ↑/↓ PgUp/PgDn scroll  p ${paused ? "resume" : "pause"}`;
  const baseFooterRows = decision === undefined ? wrappedTextRows(footerText, width) : 0;
  const reservedDecisionRows = decision === undefined ? 0 : Math.min(5, Math.max(0, terminalSize.rows - headerRows));
  const diagnosticBudget = Math.min(
    3,
    Math.max(0, terminalSize.rows - headerRows - baseFooterRows - reservedDecisionRows),
  );
  const diagnosticLines = diagnostic === undefined
    ? []
    : clippedWrappedLines(`ATTENTION  ${diagnostic}`, documentWidth, diagnosticBudget);
  const diagnosticRows = diagnosticLines.length;
  const focusBudget = decision !== undefined || focus === undefined
    ? 0
    : Math.min(1, Math.max(0, terminalSize.rows - headerRows - diagnosticRows - baseFooterRows));
  const focusLines = focus === undefined ? [] : clippedWrappedLines(focus, width, focusBudget);
  const footerRows = baseFooterRows + focusLines.length;
  const decisionRows = decision === undefined ? 0 : decisionCardHeight(
    decision.prompt,
    decision.options,
    width,
    Math.max(0, terminalSize.rows - headerRows - diagnosticRows),
  );
  const documentRows = contentViewportHeight(terminalSize.rows, {
    headerRows,
    hasDiagnostic: diagnostic !== undefined,
    diagnosticRows,
    decisionRows,
    hasControls,
    footerRows,
  });
  return {
    width,
    documentWidth,
    headerRows,
    diagnosticRows,
    diagnosticLines,
    decisionRows,
    documentRows,
    footerText,
    focusLines,
  };
};

interface InputContext {
  readonly decision: DecisionCard | undefined;
  readonly decisionLineCount: number;
  readonly decisionCapacity: number;
  readonly selectedRef: React.RefObject<number>;
  readonly setSelected: React.Dispatch<React.SetStateAction<number>>;
  readonly setDecisionOffset: React.Dispatch<React.SetStateAction<number>>;
  readonly paused: boolean;
  readonly setPaused: React.Dispatch<React.SetStateAction<boolean>>;
  readonly controls: readonly InteractiveNode[];
  readonly focusedControl: number;
  readonly setFocusedControl: React.Dispatch<React.SetStateAction<number>>;
  readonly onEvent: CanvasAppProps["onEvent"] | undefined;
  readonly setExpandedDetails: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  readonly maxOffset: number;
  readonly documentRows: number;
  readonly setOffset: React.Dispatch<React.SetStateAction<number>>;
}

const handleDecisionNavigation = (
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  context: InputContext,
): boolean => {
  if (context.decision === undefined) return false;
  if (key.upArrow) context.setDecisionOffset((value) => Math.max(0, value - 1));
  else if (key.downArrow) {
    const maximum = Math.max(0, context.decisionLineCount - context.decisionCapacity);
    context.setDecisionOffset((value) => Math.min(maximum, value + 1));
  } else handleDecisionInput(key, context.decision, context.selectedRef, context.setSelected);
  return true;
};

const handleDocumentNavigation = (
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  context: InputContext,
): void => {
  if (input === "p") context.setPaused((value) => !value);
  else if (key.tab && context.controls.length > 0) {
    context.setFocusedControl((value) => (value + 1) % context.controls.length);
  } else if (key.return && context.controls.length > 0 && !context.paused) {
    activateControl(context.controls[context.focusedControl], context.onEvent, context.setExpandedDetails);
  } else if (key.upArrow || input === "k") context.setOffset((value) => Math.max(0, value - 1));
  else if (key.downArrow || input === "j") context.setOffset((value) => Math.min(context.maxOffset, value + 1));
  else if (key.pageUp) context.setOffset((value) => Math.max(0, value - context.documentRows));
  else if (key.pageDown) context.setOffset((value) => Math.min(context.maxOffset, value + context.documentRows));
};

export const CanvasApp = ({ tree, status, diagnostic, decision, onEvent }: CanvasAppProps) => {
  const { stdout } = useStdout();
  const terminalSize = useTerminalSize(stdout);
  const [paused, setPaused] = useState(false);
  const [displayTree, setDisplayTree] = useState(tree);
  const [expandedDetails, setExpandedDetails] = useState<ReadonlySet<string>>(new Set());
  const activeTree = paused ? displayTree : tree;
  const renderedTree = useMemo(
    () => activeTree === undefined ? undefined : applyExpandedDetails(activeTree, expandedDetails),
    [activeTree, expandedDetails],
  );
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(0);
  const [decisionOffset, setDecisionOffset] = useState(0);
  const [focusedControl, setFocusedControl] = useState(0);
  const controls = useMemo(() => collectInteractiveNodes(activeTree), [activeTree]);
  const focus = focusSummary(controls.map((control) => control.label), focusedControl);
  const layout = calculateCanvasLayout(terminalSize, diagnostic, decision, focus, paused, controls.length > 0);
  const lines = useMemo(
    () => renderedTree === undefined ? [] : formatNode(renderedTree, layout.documentWidth),
    [layout.documentWidth, renderedTree],
  );
  const maxOffset = Math.max(0, lines.length - layout.documentRows);
  const statusView = statusPresentation(status);
  const decisionContent = useMemo(
    () => decision === undefined ? [] : decisionLines(decision, selected, layout.width),
    [decision, layout.width, selected],
  );
  const decisionCapacity = Math.max(0, layout.decisionRows - 4);

  useEffect(() => {
    if (!paused) setDisplayTree(tree);
  }, [paused, tree]);

  useEffect(() => {
    setOffset((value) => Math.min(value, maxOffset));
  }, [maxOffset]);

  useEffect(() => {
    setFocusedControl((value) => Math.min(value, Math.max(0, controls.length - 1)));
  }, [controls.length]);

  useEffect(() => {
    selectedRef.current = 0;
    setSelected(0);
    setDecisionOffset(0);
  }, [decision?.id]);

  useEffect(() => {
    if (decision === undefined) return;
    const currentLines = decisionLines(decision, selected, layout.width);
    setDecisionOffset((current) =>
      keepSelectedDecisionVisible(currentLines, selected, current, decisionCapacity));
  }, [decision?.id, decisionCapacity, layout.width, selected]);

  useInput((input, key) => {
    const context: InputContext = {
      decision,
      decisionLineCount: decisionContent.length,
      decisionCapacity,
      selectedRef,
      setSelected,
      setDecisionOffset,
      paused,
      setPaused,
      controls,
      focusedControl,
      setFocusedControl,
      onEvent,
      setExpandedDetails,
      maxOffset,
      documentRows: layout.documentRows,
      setOffset,
    };
    if (!handleDecisionNavigation(key, context)) handleDocumentNavigation(input, key, context);
  });

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        flexDirection={layout.headerRows === 4 ? "column" : "row"}
        justifyContent="space-between"
      >
        <Text bold color="cyan">HERDR / CANVAS</Text>
        <Text color={statusView.color} bold>{`${statusView.symbol} ${statusView.label}`}</Text>
      </Box>
      {layout.diagnosticLines.length === 0 ? null : (
        <Box paddingX={1}>
          <Box flexDirection="column">
            {layout.diagnosticLines.map((line, index) => <Text key={`${index}:${line}`} color="yellow">{line}</Text>)}
          </Box>
        </Box>
      )}
      <Box flexDirection="column" height={layout.documentRows} paddingX={1}>
        {layout.documentRows === 0 ? null : lines.length === 0 ? (
          <Text dimColor>{status === "connected" ? "Waiting for canvas content" : "Canvas content unavailable"}</Text>
        ) : lines.slice(offset, offset + layout.documentRows).map((line, index) => (
          <DocumentLine key={`${offset + index}:${line}`} line={line} />
        ))}
      </Box>
      {decision === undefined ? null : (
        <DecisionView
          decision={decision}
          selected={selected}
          width={layout.width}
          height={layout.decisionRows}
          offset={decisionOffset}
        />
      )}
      {decision !== undefined ? null : layout.focusLines.map((line, index) => (
        <Text key={`${index}:${line}`} color="cyan" bold>{line}</Text>
      ))}
      {decision === undefined ? (
        <Text dimColor>{layout.footerText}</Text>
      ) : null}
    </Box>
  );
};
