export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type HerdrExecutor = (args: readonly string[]) => Promise<CommandResult>;

interface Pane {
  readonly pane_id: string;
  readonly tab_id?: string;
  readonly cwd?: string;
  readonly focused?: boolean;
}

export class HerdrCanvasOwner {
  readonly #execute: HerdrExecutor;
  readonly #cwd: string;
  readonly #parentPaneId: string | undefined;
  #ownedPaneId: string | undefined;
  #ownedTabId: string | undefined;

  constructor(execute: HerdrExecutor, cwd: string, parentPaneId?: string) {
    this.#execute = execute;
    this.#cwd = cwd;
    this.#parentPaneId = parentPaneId;
  }

  async open(rendererCommand: readonly string[]): Promise<string> {
    const panes = await this.#listPanes();
    if (this.#ownedPaneId !== undefined) {
      const owned = panes.find((pane) => pane.pane_id === this.#ownedPaneId);
      if (
        owned !== undefined &&
        owned.cwd === this.#cwd &&
        (this.#ownedTabId === undefined || owned.tab_id === this.#ownedTabId)
      ) {
        return owned.pane_id;
      }
      this.#ownedPaneId = undefined;
      this.#ownedTabId = undefined;
    }

    const inheritedParent = this.#parentPaneId === undefined
      ? undefined
      : panes.find((pane) => pane.pane_id === this.#parentPaneId && pane.cwd === this.#cwd);
    const parent = inheritedParent ?? panes.find((pane) => pane.focused && pane.cwd === this.#cwd);
    if (parent === undefined) {
      throw new Error("Cannot identify the focused Herdr pane for this canvas");
    }
    const split = await this.#run([
      "pane",
      "split",
      parent.pane_id,
      "--direction",
      "right",
      "--ratio",
      "0.60",
      "--no-focus",
      "--cwd",
      this.#cwd,
    ]);
    const parsed = JSON.parse(split.stdout) as { result?: { pane?: Pane } };
    const paneId = parsed.result?.pane?.pane_id;
    if (typeof paneId !== "string") {
      throw new Error("Herdr did not return the created pane id");
    }
    this.#ownedPaneId = paneId;
    this.#ownedTabId = parent.tab_id;
    try {
      await this.#run(["pane", "run", paneId, rendererCommand.map(shellQuote).join(" ")]);
    } catch (error) {
      await this.#execute(["pane", "close", paneId]).catch(() => undefined);
      this.#ownedPaneId = undefined;
      this.#ownedTabId = undefined;
      throw error;
    }
    return paneId;
  }

  async close(): Promise<void> {
    if (this.#ownedPaneId === undefined) {
      return;
    }
    const panes = await this.#listPanes();
    const owned = panes.find(
      (pane) =>
        pane.pane_id === this.#ownedPaneId &&
        pane.cwd === this.#cwd &&
        (this.#ownedTabId === undefined || pane.tab_id === this.#ownedTabId),
    );
    if (owned !== undefined) {
      await this.#run(["pane", "close", owned.pane_id]);
    }
    this.#ownedPaneId = undefined;
    this.#ownedTabId = undefined;
  }

  async #listPanes(): Promise<readonly Pane[]> {
    const result = await this.#run(["pane", "list"]);
    const parsed = JSON.parse(result.stdout) as { result?: { panes?: readonly Pane[] } };
    if (!Array.isArray(parsed.result?.panes)) {
      throw new Error("Herdr returned an invalid pane list");
    }
    return parsed.result.panes;
  }

  async #run(args: readonly string[]): Promise<CommandResult> {
    const result = await this.#execute(args);
    if (result.exitCode !== 0) {
      throw new Error(`Herdr command failed with exit code ${result.exitCode}`);
    }
    return result;
  }
}

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
};
