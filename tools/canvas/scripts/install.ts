import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { validateRuntimeBundle, type VerifiedRuntimeBundle } from "../src/runner/runtime-bundle.ts";

const MANAGED_START = "<!-- herdr-canvas:start -->";
const MANAGED_END = "<!-- herdr-canvas:end -->";
const INSTALL_MANIFEST = ".herdr-canvas-install.json";
const PI_ADAPTER_VERSION = "2.27.0";
const PI_ADAPTER = `npm:pi-mcp-adapter@${PI_ADAPTER_VERSION}`;
const SKILL_FILES = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/state.md",
  "layouts/planning.mdx",
  "layouts/delivery.mdx",
  "layouts/debug.mdx",
  "layouts/labelled-bars.mdx",
  "references/charts.md",
  "fixtures/chart-correctness.json",
  "integrations/copilot/activation.md",
] as const;
const APP_ENTRIES = [
  "src",
  "scripts",
  "docs",
  "runtime",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "README.md",
  "DESIGN.md",
  "THIRD_PARTY_NOTICES.md",
] as const;

type InstallScope = "user" | "project";
export type InstallHost = "copilot" | "claude" | "codex" | "pi";
const ALL_HOSTS: readonly InstallHost[] = ["copilot", "claude", "codex", "pi"];

export interface InstallOptions {
  readonly scope: InstallScope;
  readonly hosts?: readonly InstallHost[];
  readonly directory?: string;
  readonly copilotHome?: string;
  readonly sourceRoot?: string;
  readonly skillSourceRoot?: string;
  readonly runtimeSource?: string;
  readonly managedClaudeHome?: string;
  readonly dryRun: boolean;
  readonly replaceExistingMcp?: boolean;
}

export interface InstallResult {
  readonly changed: string[];
  readonly unchanged: string[];
  readonly backups: string[];
  readonly nextSteps: string[];
}

interface InstallDependencies {
  readonly validateRuntime: (path: string) => Promise<VerifiedRuntimeBundle | void>;
  readonly prepareDependencies: (bunPath: string, applicationDirectory: string) => void;
  readonly prepareRuntime: (sourceRoot: string, runtimeDirectory: string) => void;
  readonly ensurePiAdapter: () => void;
}

interface InstallPaths {
  readonly applicationDirectory: string;
  readonly launcher: string;
  readonly skillDirectories: Readonly<Record<InstallHost, string | undefined>>;
  readonly claudeProfileSkillDirectory: string | undefined;
  readonly copilotInstructions: string | undefined;
  readonly copilotMcpConfig: string | undefined;
  readonly claudeMcpConfig: string | undefined;
  readonly claudeProfileMcpConfig: string | undefined;
  readonly codexMcpConfig: string | undefined;
  readonly piMcpConfig: string | undefined;
}

const fail = (message: string): never => {
  throw new Error(message);
};

const readJsonObject = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail(`${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

const assertNoSymlinkSegments = (path: string): void => {
  for (const candidate of [path, dirname(path)]) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        fail(`Refusing symlink target: ${candidate}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
};

const ensureParent = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
};

const backupPath = (path: string): string => {
  if (basename(path) === "herdr-canvas" && basename(dirname(path)) === "skills") {
    return join(dirname(dirname(path)), "backups/herdr-canvas-skill");
  }
  return `${path}.bak-herdr-canvas`;
};

const migrateLegacySkillBackup = (
  skillDirectory: string,
  backups: string[],
): void => {
  const legacy = `${skillDirectory}.bak-herdr-canvas`;
  if (!existsSync(legacy)) return;
  const target = backupPath(skillDirectory);
  if (existsSync(target)) {
    fail(`Both legacy and current skill backups exist: ${legacy} and ${target}`);
  }
  ensureParent(target);
  renameSync(legacy, target);
  backups.push(target);
};

const backupExisting = (path: string, backups: string[]): void => {
  if (!existsSync(path)) return;
  const backup = backupPath(path);
  if (existsSync(backup)) return;
  ensureParent(backup);
  cpSync(path, backup, { recursive: true, preserveTimestamps: true });
  backups.push(backup);
};

const atomicWrite = (path: string, content: string, mode = 0o644): void => {
  ensureParent(path);
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  const effectiveMode = existsSync(path) ? lstatSync(path).mode & mode : mode;
  try {
    writeFileSync(temporary, content, { mode: effectiveMode });
    renameSync(temporary, path);
    chmodSync(path, effectiveMode);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
};

const sameText = (path: string, content: string): boolean =>
  existsSync(path) && readFileSync(path, "utf8") === content;

const constrainMode = (path: string, mode: number): boolean => {
  const current = lstatSync(path).mode & 0o777;
  const constrained = current & mode;
  if (current === constrained) return false;
  chmodSync(path, constrained);
  return true;
};

const managedInstructions = (activation: string): string =>
  `${MANAGED_START}\n${activation.trim()}\n${MANAGED_END}`;

const mergeInstructions = (existing: string, activation: string): string => {
  const block = managedInstructions(activation);
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    return fail("Copilot instructions contain an incomplete herdr-canvas managed block.");
  }
  if (start !== -1) {
    const suffixStart = end + MANAGED_END.length;
    return `${existing.slice(0, start)}${block}${existing.slice(suffixStart)}`;
  }
  if (existing.length === 0) return `${block}\n`;
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block}\n`;
};

const resolveSources = (options: InstallOptions) => {
  const sourceRoot = resolve(options.sourceRoot ?? join(import.meta.dir, ".."));
  const repositoryRoot = resolve(sourceRoot, "../..");
  const skillSourceRoot = resolve(
    options.skillSourceRoot ?? join(repositoryRoot, "skills/herdr-canvas"),
  );
  const packageJson = readJsonObject(join(sourceRoot, "package.json"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    return fail("Canvas package.json must contain a version.");
  }
  return { sourceRoot, skillSourceRoot, version: packageJson.version };
};

const selectedPath = (
  hosts: ReadonlySet<InstallHost>,
  host: InstallHost,
  path: string,
): string | undefined => hosts.has(host) ? path : undefined;

const resolveUserPaths = (
  base: string,
  copilotHome: string,
  managedClaudeHome: string | undefined,
  hosts: ReadonlySet<InstallHost>,
  version: string,
): InstallPaths => ({
  applicationDirectory: join(base, ".local/share/herdr-canvas", version),
  launcher: join(base, ".local/bin/herdr-canvas"),
  skillDirectories: {
    copilot: selectedPath(hosts, "copilot", join(copilotHome, "skills/herdr-canvas")),
    claude: selectedPath(hosts, "claude", join(base, ".claude/skills/herdr-canvas")),
    codex: selectedPath(hosts, "codex", join(base, ".agents/skills/herdr-canvas")),
    pi: selectedPath(hosts, "pi", join(base, ".pi/agent/skills/herdr-canvas")),
  },
  claudeProfileSkillDirectory: managedClaudeHome === undefined
    ? undefined
    : selectedPath(
        hosts,
        "claude",
        join(managedClaudeHome, "skills/herdr-canvas"),
      ),
  copilotInstructions: selectedPath(
    hosts,
    "copilot",
    join(copilotHome, "copilot-instructions.md"),
  ),
  copilotMcpConfig: selectedPath(hosts, "copilot", join(copilotHome, "mcp-config.json")),
  claudeMcpConfig: selectedPath(hosts, "claude", join(base, ".claude.json")),
  claudeProfileMcpConfig: managedClaudeHome === undefined
    ? undefined
    : selectedPath(hosts, "claude", join(managedClaudeHome, ".claude.json")),
  codexMcpConfig: selectedPath(hosts, "codex", join(base, ".codex/config.toml")),
  piMcpConfig: selectedPath(hosts, "pi", join(base, ".pi/agent/mcp.json")),
});

const resolvePaths = (
  options: InstallOptions,
  version: string,
): InstallPaths => {
  const base = resolve(options.directory ?? homedir());
  const hosts = new Set<InstallHost>(options.hosts ?? ["copilot"]);
  if (options.scope === "project") {
    if ([...hosts].some((host) => host !== "copilot")) {
      fail("Project scope currently supports only the Copilot host.");
    }
    return {
      applicationDirectory: join(base, ".herdr-canvas/app", version),
      launcher: join(base, ".herdr-canvas/bin/herdr-canvas"),
      skillDirectories: {
        copilot: join(base, ".github/skills/herdr-canvas"),
        claude: undefined,
        codex: undefined,
        pi: undefined,
      },
      claudeProfileSkillDirectory: undefined,
      copilotInstructions: join(base, ".github/copilot-instructions.md"),
      copilotMcpConfig: undefined,
      claudeMcpConfig: undefined,
      claudeProfileMcpConfig: undefined,
      codexMcpConfig: undefined,
      piMcpConfig: undefined,
    };
  }
  const copilotHome = resolve(
    options.copilotHome ??
      (options.directory === undefined
        ? process.env.COPILOT_HOME ?? join(base, ".copilot")
        : join(base, ".copilot")),
  );
  const cldxProfileRoot = join(
    base,
    ".local/share/trellage/profiles/claude/default",
  );
  const managedClaudeHome = options.managedClaudeHome ??
    (options.directory === undefined &&
        existsSync(join(cldxProfileRoot, ".managed-by-trellage-claude-profiles"))
      ? join(cldxProfileRoot, "home")
      : undefined);
  return resolveUserPaths(
    base,
    copilotHome,
    managedClaudeHome,
    hosts,
    version,
  );
};

const validateSources = (sourceRoot: string, skillSourceRoot: string): void => {
  for (const entry of APP_ENTRIES) {
    if (!existsSync(join(sourceRoot, entry))) fail(`Missing application source: ${entry}`);
  }
  for (const file of SKILL_FILES) {
    if (!existsSync(join(skillSourceRoot, file))) fail(`Missing skill resource: ${file}`);
  }
};

const prepareRuntimeSource = async (
  options: InstallOptions,
  sourceRoot: string,
  dependencies: InstallDependencies,
): Promise<string> => {
  const runtimeDirectory = resolve(
    options.runtimeSource ?? join(sourceRoot, "generated/runtime-darwin-arm64"),
  );
  if (!existsSync(runtimeDirectory)) {
    if (options.dryRun) return runtimeDirectory;
    dependencies.prepareRuntime(sourceRoot, runtimeDirectory);
  }
  if (!options.dryRun) await dependencies.validateRuntime(runtimeDirectory);
  return runtimeDirectory;
};

const skillOwnedByInstaller = (skillDirectory: string): boolean => {
  const manifestPath = join(skillDirectory, INSTALL_MANIFEST);
  if (!existsSync(manifestPath)) return false;
  const manifest = readJsonObject(manifestPath);
  return manifest.owner === "herdr-canvas";
};

const skillMatchesSource = (skillDirectory: string, skillSourceRoot: string): boolean =>
  SKILL_FILES.every((file) => {
    const installed = join(skillDirectory, file);
    const source = join(skillSourceRoot, file);
    return existsSync(installed) &&
      readFileSync(installed, "utf8") === readFileSync(source, "utf8");
  });

const hasMcpServer = (path: string, name: string): boolean => {
  if (!existsSync(path)) return false;
  const config = readJsonObject(path);
  const servers = config.mcpServers;
  return typeof servers === "object" &&
    servers !== null &&
    !Array.isArray(servers) &&
    (servers as Record<string, unknown>)[name] !== undefined;
};

const codexMcpServers = (content: string): Record<string, unknown> => {
  if (content.trim().length === 0) return {};
  const parsed: unknown = Bun.TOML.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("Codex config must contain a TOML object.");
  }
  const servers = (parsed as Record<string, unknown>).mcp_servers;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers)
    ? servers as Record<string, unknown>
    : {};
};

const codexHasMcpServer = (path: string): boolean =>
  existsSync(path) &&
  codexMcpServers(readFileSync(path, "utf8"))["herdr-canvas"] !== undefined;

const allSkillDirectories = (paths: InstallPaths): string[] => [
  ...Object.values(paths.skillDirectories),
].filter((path): path is string => path !== undefined);

const jsonMcpPaths = (paths: InstallPaths): string[] => [
  paths.copilotMcpConfig,
  paths.claudeMcpConfig,
  paths.claudeProfileMcpConfig,
  paths.piMcpConfig,
].filter((path): path is string => path !== undefined);

const preflight = (
  paths: InstallPaths,
  sourceRoot: string,
  skillSourceRoot: string,
  replaceExistingMcp: boolean,
): void => {
  validateSources(sourceRoot, skillSourceRoot);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    fail("Herdr Canvas currently supports Darwin ARM64 only.");
  }
  for (const path of [
    paths.applicationDirectory,
    paths.launcher,
    ...allSkillDirectories(paths),
    ...[
      paths.copilotInstructions,
      paths.copilotMcpConfig,
      paths.claudeMcpConfig,
      paths.claudeProfileMcpConfig,
      paths.codexMcpConfig,
      paths.piMcpConfig,
    ].filter((path): path is string => path !== undefined),
  ]) {
    assertNoSymlinkSegments(path);
  }
  for (const skillDirectory of allSkillDirectories(paths)) {
    if (
      existsSync(skillDirectory) &&
      !skillOwnedByInstaller(skillDirectory) &&
      !skillMatchesSource(skillDirectory, skillSourceRoot)
    ) {
      fail(`Refusing unrelated skill directory: ${skillDirectory}`);
    }
  }
  const occupied = jsonMcpPaths(paths)
    .some((path) => hasMcpServer(path, "herdr-canvas")) ||
    (paths.codexMcpConfig !== undefined && codexHasMcpServer(paths.codexMcpConfig));
  if (occupied && !replaceExistingMcp) {
    fail("An existing herdr-canvas MCP registration requires --replace-existing-mcp.");
  }
};

const installApplication = (
  sourceRoot: string,
  runtimeSource: string,
  target: string,
  prepareDependencies: InstallDependencies["prepareDependencies"],
): void => {
  const staging = `${target}.staging-${process.pid}`;
  const displaced = `${target}.previous-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  rmSync(displaced, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o755 });
  try {
    for (const entry of APP_ENTRIES) {
      cpSync(join(sourceRoot, entry), join(staging, entry), {
        recursive: true,
        preserveTimestamps: true,
      });
    }
    cpSync(runtimeSource, join(staging, "runtime"), {
      recursive: true,
      preserveTimestamps: true,
    });
    prepareDependencies(join(staging, "runtime/bun"), staging);
    ensureParent(target);
    if (existsSync(target)) renameSync(target, displaced);
    renameSync(staging, target);
    rmSync(displaced, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(displaced)) renameSync(displaced, target);
    throw error;
  }
};

const copySkill = (
  source: string,
  target: string,
  version: string,
): void => {
  const staging = `${target}.staging-${process.pid}`;
  const displaced = `${target}.previous-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  rmSync(displaced, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o755 });
  try {
    for (const file of SKILL_FILES) {
      const destination = join(staging, file);
      ensureParent(destination);
      cpSync(join(source, file), destination, { preserveTimestamps: true });
    }
    atomicWrite(
      join(staging, INSTALL_MANIFEST),
      `${JSON.stringify({ owner: "herdr-canvas", version }, null, 2)}\n`,
    );
    ensureParent(target);
    if (existsSync(target)) renameSync(target, displaced);
    renameSync(staging, target);
    rmSync(displaced, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(displaced)) renameSync(displaced, target);
    throw error;
  }
};

const launcherText = (applicationDirectory: string): string => `#!/bin/bash
set -euo pipefail
readonly app=${JSON.stringify(applicationDirectory)}
export CANVAS_RUNTIME_BUNDLE="$app/runtime"
exec "$app/runtime/bun" "$app/src/broker/main.ts" "$@"
`;

const jsonMcpConfigText = (
  path: string,
  launcher: string,
  extra: Readonly<Record<string, unknown>> = {},
): string => {
  const config = readJsonObject(path);
  const servers =
    typeof config.mcpServers === "object" &&
      config.mcpServers !== null &&
      !Array.isArray(config.mcpServers)
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};
  const current = servers["herdr-canvas"];
  const existing = typeof current === "object" &&
      current !== null &&
      !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  servers["herdr-canvas"] = { ...extra, ...existing, command: launcher, args: [] };
  return `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`;
};

const stripCodexCanvasConfig = (existing: string): string => {
  const lines = existing.split("\n");
  const retained: string[] = [];
  let skipping = false;
  let inMcpServers = false;
  const canvasKey = String.raw`(?:"herdr-canvas"|'herdr-canvas'|herdr-canvas)`;
  const canvasSection = new RegExp(
    String.raw`^\s*\[\s*(?:"mcp_servers"|'mcp_servers'|mcp_servers)\s*\.\s*${canvasKey}(?:\s*\..*)?\]\s*$`,
  );
  const mcpServersSection = /^\s*\[\s*(?:"mcp_servers"|'mcp_servers'|mcp_servers)\s*\]\s*$/;
  const canvasAssignment = new RegExp(String.raw`^\s*${canvasKey}(?:\s*\..*)?\s*=`);
  const rootCanvasAssignment = new RegExp(
    String.raw`^\s*(?:"mcp_servers"|'mcp_servers'|mcp_servers)\s*\.\s*${canvasKey}(?:\s*\..*)?\s*=`,
  );
  for (const line of lines) {
    if (canvasSection.test(line)) {
      skipping = true;
      inMcpServers = false;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      skipping = false;
      inMcpServers = mcpServersSection.test(line);
    }
    if (!skipping && (rootCanvasAssignment.test(line) ||
      (inMcpServers && canvasAssignment.test(line)))) {
      continue;
    }
    if (!skipping) retained.push(line);
  }
  return retained.join("\n").trimEnd();
};

const tomlValue = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${JSON.stringify(key)} = ${tomlValue(nested)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return fail("Unsupported value in the existing Codex MCP configuration.");
};

const codexMcpConfigText = (path: string, launcher: string): string => {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const current = codexMcpServers(existing)["herdr-canvas"];
  const preserved = typeof current === "object" &&
      current !== null &&
      !Array.isArray(current)
    ? Object.entries(current as Record<string, unknown>)
      .filter(([key]) => key !== "command" && key !== "args")
    : [];
  const prefix = stripCodexCanvasConfig(existing);
  if (codexMcpServers(prefix)["herdr-canvas"] !== undefined) {
    return fail("Unsupported existing Codex herdr-canvas TOML representation.");
  }
  const block = [
    "[mcp_servers.herdr-canvas]",
    `command = ${JSON.stringify(launcher)}`,
    "args = []",
    ...preserved.map(([key, value]) => `${JSON.stringify(key)} = ${tomlValue(value)}`),
  ].join("\n");
  const output = `${prefix.length === 0 ? "" : `${prefix}\n\n`}${block}\n`;
  if (codexMcpServers(output)["herdr-canvas"] === undefined) {
    return fail("Generated Codex MCP configuration is invalid.");
  }
  return output;
};

const defaultDependencies: InstallDependencies = {
  validateRuntime: validateRuntimeBundle,
  prepareDependencies(bunPath, applicationDirectory) {
    const result = Bun.spawnSync({
      cmd: [bunPath, "install", "--frozen-lockfile", "--production"],
      cwd: applicationDirectory,
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) fail("Dependency installation failed.");
  },
  prepareRuntime(sourceRoot, runtimeDirectory) {
    if (process.platform !== "darwin") {
      fail("Canvas runtime preparation currently supports macOS only.");
    }
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(sourceRoot, "scripts/package-runtime.ts"), runtimeDirectory],
      cwd: sourceRoot,
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) fail("Sandbox runtime preparation failed.");
  },
  ensurePiAdapter() {
    if (Bun.which("pi") === null) fail("Pi is required when the pi host is selected.");
    const piHome = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
    const packageJsonPath = join(
      piHome,
      "npm/node_modules/pi-mcp-adapter/package.json",
    );
    const installedVersion = existsSync(packageJsonPath)
      ? readJsonObject(packageJsonPath).version
      : undefined;
    if (installedVersion === PI_ADAPTER_VERSION) return;
    const installed = Bun.spawnSync({
      cmd: ["pi", "install", PI_ADAPTER],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (installed.exitCode !== 0) fail("Pi MCP adapter installation failed.");
    const updatedVersion = existsSync(packageJsonPath)
      ? readJsonObject(packageJsonPath).version
      : undefined;
    if (updatedVersion !== PI_ADAPTER_VERSION) {
      fail(`Pi MCP adapter ${PI_ADAPTER_VERSION} was not installed.`);
    }
  },
};

const installTargets = (paths: InstallPaths): string[] => [
  paths.applicationDirectory,
  paths.launcher,
  ...allSkillDirectories(paths),
  ...[
    paths.copilotInstructions,
    paths.copilotMcpConfig,
    paths.claudeMcpConfig,
    paths.claudeProfileMcpConfig,
    paths.codexMcpConfig,
    paths.piMcpConfig,
  ].filter((path): path is string => path !== undefined),
];

  type HostWrite = readonly [path: string, content: string, mode: number];

  const prepareHostWrites = (
    paths: InstallPaths,
    skillSourceRoot: string,
  ): HostWrite[] => {
    const writes: HostWrite[] = [];
    const add = (
      path: string | undefined,
      content: string | undefined,
      mode: number,
    ): void => {
      if (path !== undefined && content !== undefined) writes.push([path, content, mode]);
    };
    const activationSource = readFileSync(
      join(skillSourceRoot, "integrations/copilot/activation.md"),
      "utf8",
    );
    const existingInstructions = paths.copilotInstructions !== undefined &&
        existsSync(paths.copilotInstructions)
      ? readFileSync(paths.copilotInstructions, "utf8")
      : "";
    add(
      paths.copilotInstructions,
      paths.copilotInstructions === undefined
        ? undefined
        : mergeInstructions(existingInstructions, activationSource),
      0o644,
    );
    add(
      paths.copilotMcpConfig,
      paths.copilotMcpConfig === undefined
        ? undefined
        : jsonMcpConfigText(paths.copilotMcpConfig, paths.launcher),
      0o600,
    );
    add(
      paths.claudeMcpConfig,
      paths.claudeMcpConfig === undefined
        ? undefined
        : jsonMcpConfigText(paths.claudeMcpConfig, paths.launcher, {
            type: "stdio",
            env: {},
          }),
      0o600,
    );
    add(
      paths.claudeProfileMcpConfig,
      paths.claudeProfileMcpConfig === undefined
        ? undefined
        : jsonMcpConfigText(paths.claudeProfileMcpConfig, paths.launcher, {
            type: "stdio",
            env: {},
          }),
      0o600,
    );
    add(
      paths.codexMcpConfig,
      paths.codexMcpConfig === undefined
        ? undefined
        : codexMcpConfigText(paths.codexMcpConfig, paths.launcher),
      0o600,
    );
    add(
      paths.piMcpConfig,
      paths.piMcpConfig === undefined
        ? undefined
        : jsonMcpConfigText(paths.piMcpConfig, paths.launcher, {
            directTools: true,
          }),
      0o600,
    );
    return writes;
  };

  const writeHostFiles = (
    writes: readonly HostWrite[],
    changed: string[],
    unchanged: string[],
  ): void => {
    for (const [path, content, mode] of writes) {
      if (sameText(path, content)) {
        (constrainMode(path, mode) ? changed : unchanged).push(path);
        continue;
      }
      atomicWrite(path, content, mode);
      changed.push(path);
    }
  };

  const installHostFiles = (
  paths: InstallPaths,
  skillSourceRoot: string,
  version: string,
  changed: string[],
  unchanged: string[],
): void => {
  for (const skillDirectory of allSkillDirectories(paths)) {
    copySkill(skillSourceRoot, skillDirectory, version);
    changed.push(skillDirectory);
  }
  if (
    paths.claudeProfileSkillDirectory !== undefined &&
    existsSync(paths.claudeProfileSkillDirectory) &&
    skillOwnedByInstaller(paths.claudeProfileSkillDirectory)
  ) {
    rmSync(paths.claudeProfileSkillDirectory, { recursive: true, force: true });
    changed.push(paths.claudeProfileSkillDirectory);
  }
  writeHostFiles(prepareHostWrites(paths, skillSourceRoot), changed, unchanged);
};

export const installHerdrCanvas = async (
  options: InstallOptions,
  dependencies: InstallDependencies = defaultDependencies,
): Promise<InstallResult> => {
  const { sourceRoot, skillSourceRoot, version } = resolveSources(options);
  const paths = resolvePaths(options, version);
  preflight(
    paths,
    sourceRoot,
    skillSourceRoot,
    options.replaceExistingMcp === true,
  );
  const runtimeSource = await prepareRuntimeSource(options, sourceRoot, dependencies);
  const launcher = launcherText(paths.applicationDirectory);
  const targets = installTargets(paths);
  if (options.dryRun) {
    return {
      changed: targets,
      unchanged: [],
      backups: [],
      nextSteps: [
        "Run the installer without --dry-run.",
        "Start a fresh Copilot session after installation.",
      ],
    };
  }

  const backups: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  if (paths.piMcpConfig !== undefined) dependencies.ensurePiAdapter();
  for (const skillDirectory of allSkillDirectories(paths)) {
    migrateLegacySkillBackup(skillDirectory, backups);
  }
  for (const path of targets) backupExisting(path, backups);
  installApplication(
    sourceRoot,
    runtimeSource,
    paths.applicationDirectory,
    dependencies.prepareDependencies,
  );
  changed.push(paths.applicationDirectory);
  if (sameText(paths.launcher, launcher)) {
    (constrainMode(paths.launcher, 0o755) ? changed : unchanged).push(
      paths.launcher,
    );
  } else {
    atomicWrite(paths.launcher, launcher, 0o755);
    changed.push(paths.launcher);
  }
  installHostFiles(paths, skillSourceRoot, version, changed, unchanged);

  return {
    changed,
    unchanged,
    backups,
    nextSteps: [
      "Restart each selected harness so skills and MCP configuration reload.",
      "In Pi, run /reload or start a fresh session after MCP changes.",
      "Say `canvas on` in a new task to activate Herdr Canvas explicitly.",
    ],
  };
};

interface MutableCliOptions {
  scope: InstallScope;
  hosts: InstallHost[];
  directory?: string;
  copilotHome?: string;
  runtimeSource?: string;
  dryRun: boolean;
  replaceExistingMcp: boolean;
}

const nextArgument = (args: string[], index: number, option: string): string =>
  args[index + 1] ?? fail(`${option} requires a path.`);

const applyCliOption = (
  options: MutableCliOptions,
  args: string[],
  index: number,
): number => {
  const argument = args[index]!;
  if (argument === "--scope") {
    const value = nextArgument(args, index, argument);
    if (value !== "user" && value !== "project") fail("--scope must be user or project.");
    options.scope = value as InstallScope;
    return index + 1;
  }
  if (argument === "--directory") {
    options.directory = nextArgument(args, index, argument);
    return index + 1;
  }
  if (argument === "--hosts") {
    const requested = nextArgument(args, index, argument).split(",");
    const invalid = requested.filter(
      (host): host is string => !ALL_HOSTS.includes(host as InstallHost),
    );
    if (invalid.length > 0 || requested.length === 0) {
      fail(`--hosts must contain only: ${ALL_HOSTS.join(",")}`);
    }
    options.hosts = requested as InstallHost[];
    return index + 1;
  }
  if (argument === "--copilot-home") {
    options.copilotHome = nextArgument(args, index, argument);
    return index + 1;
  }
  if (argument === "--runtime-source") {
    options.runtimeSource = nextArgument(args, index, argument);
    return index + 1;
  }
  if (argument === "--dry-run") {
    options.dryRun = true;
    return index;
  }
  if (argument === "--replace-existing-mcp") {
    options.replaceExistingMcp = true;
    return index;
  }
  if (argument === "--help") {
    process.stdout.write(
      "Usage: bun scripts/install.ts [--scope user|project] [--directory PATH] " +
        "[--hosts copilot,claude,codex,pi] [--copilot-home PATH] " +
        "[--runtime-source PATH] [--dry-run] " +
        "[--replace-existing-mcp]\n",
    );
    process.exit(0);
  }
  return fail(`Unknown option: ${argument}`);
};

const parseCli = (args: string[]): InstallOptions => {
  const options: MutableCliOptions = {
    scope: "user",
    hosts: ["copilot"],
    dryRun: false,
    replaceExistingMcp: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    index = applyCliOption(options, args, index);
  }
  return options;
};

if (import.meta.main) {
  installHerdrCanvas(parseCli(process.argv.slice(2)))
    .then((result) => {
      for (const path of result.changed) process.stdout.write(`changed: ${path}\n`);
      for (const path of result.unchanged) process.stdout.write(`unchanged: ${path}\n`);
      for (const path of result.backups) process.stdout.write(`backup: ${path}\n`);
      for (const step of result.nextSteps) process.stdout.write(`next: ${step}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
