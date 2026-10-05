import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  installHerdrCanvas,
  type InstallOptions,
} from "../scripts/install.ts";

const repositoryRoot = join(import.meta.dir, "../../..");
const skillSourceRoot = join(repositoryRoot, "skills/herdr-canvas");

const fixture = (root: string): { sourceRoot: string; runtimeSource: string } => {
  const sourceRoot = join(root, "source");
  const runtimeSource = join(root, "runtime");
  for (const directory of [
    "src/broker",
    "scripts",
    "docs",
    "runtime",
  ]) {
    mkdirSync(join(sourceRoot, directory), { recursive: true });
  }
  mkdirSync(runtimeSource, { recursive: true });
  writeFileSync(join(sourceRoot, "src/broker/main.ts"), "console.log('broker')\n");
  writeFileSync(join(sourceRoot, "scripts/package-runtime.ts"), "");
  writeFileSync(join(sourceRoot, "docs/README.md"), "");
  writeFileSync(join(sourceRoot, "runtime/canvas-nono-profile.template.json"), "{}\n");
  writeFileSync(join(sourceRoot, "runtime/nono-source-pin.json"), "{}\n");
  writeFileSync(
    join(sourceRoot, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.2.3" })}\n`,
  );
  for (const file of [
    "bun.lock",
    "tsconfig.json",
    "README.md",
    "DESIGN.md",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    writeFileSync(join(sourceRoot, file), `${file}\n`);
  }
  for (const file of ["bun", "nono", "worker.js", "runtime-manifest.json"]) {
    writeFileSync(join(runtimeSource, file), file);
  }
  return { sourceRoot, runtimeSource };
};

const dependencies = {
  async validateRuntime(): Promise<void> {},
  prepareDependencies(_bunPath: string, applicationDirectory: string): void {
    mkdirSync(join(applicationDirectory, "node_modules"), { recursive: true });
  },
  prepareRuntime(): void {
    throw new Error("runtime preparation should not run in installer tests");
  },
  ensurePiAdapter(): void {},
};

const options = (
  directory: string,
  sourceRoot: string,
  runtimeSource: string,
  overrides: Partial<InstallOptions> = {},
): InstallOptions => ({
  scope: "user",
  directory,
  sourceRoot,
  skillSourceRoot,
  runtimeSource,
  dryRun: false,
  ...overrides,
});

describe("herdr-canvas installer", () => {
  test("installs versioned app, launcher, skill, activation, and MCP config", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-install-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const instructions = join(root, ".copilot/copilot-instructions.md");
    const mcp = join(root, ".copilot/mcp-config.json");
    mkdirSync(join(root, ".copilot"), { recursive: true });
    writeFileSync(instructions, "Keep my existing preference.\n");
    writeFileSync(
      mcp,
      `${JSON.stringify({ mcpServers: { unrelated: { command: "other" } }, theme: "dark" })}\n`,
    );

    const result = await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource),
      dependencies,
    );

    const app = join(root, ".local/share/herdr-canvas/1.2.3");
    expect(readFileSync(join(app, "src/broker/main.ts"), "utf8")).toContain("broker");
    expect(readFileSync(join(root, ".local/bin/herdr-canvas"), "utf8")).toContain(app);
    expect(readFileSync(instructions, "utf8")).toStartWith("Keep my existing preference.");
    expect(readFileSync(instructions, "utf8")).toContain("<!-- herdr-canvas:start -->");
    expect(readFileSync(instructions, "utf8")).toContain("`canvas on`");
    expect(readFileSync(instructions, "utf8")).toContain("Never open a canvas because");
    expect(
      readFileSync(
        join(root, ".copilot/skills/herdr-canvas/references/charts.md"),
        "utf8",
      ),
    ).toContain("# Chart correctness");
    expect(
      readFileSync(
        join(root, ".copilot/skills/herdr-canvas/layouts/labelled-bars.mdx"),
        "utf8",
      ),
    ).toContain("export function LabelledChart");
    expect(
      readFileSync(
        join(root, ".copilot/skills/herdr-canvas/fixtures/chart-correctness.json"),
        "utf8",
      ),
    ).toContain("Unresearched / zero");
    const config = JSON.parse(readFileSync(mcp, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.mcpServers.unrelated).toEqual({ command: "other" });
    expect(config.mcpServers["herdr-canvas"]).toEqual({
      command: join(root, ".local/bin/herdr-canvas"),
      args: [],
    });
    expect(result.backups).toContain(`${instructions}.bak-herdr-canvas`);
    expect(result.backups).toContain(`${mcp}.bak-herdr-canvas`);
  });

  test("is repeatable and keeps one managed activation block", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-repeat-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const installOptions = options(root, sourceRoot, runtimeSource, {
      replaceExistingMcp: true,
    });

    await installHerdrCanvas(installOptions, dependencies);
    const mcp = join(root, ".copilot/mcp-config.json");
    chmodSync(mcp, 0o644);
    const second = await installHerdrCanvas(installOptions, dependencies);

    const instructions = readFileSync(
      join(root, ".copilot/copilot-instructions.md"),
      "utf8",
    );
    expect(instructions.match(/<!-- herdr-canvas:start -->/g)).toHaveLength(1);
    expect(instructions.match(/<!-- herdr-canvas:end -->/g)).toHaveLength(1);
    expect(Bun.file(join(root, ".copilot/skills/herdr-canvas.bak-herdr-canvas")).size).toBe(0);
    expect(Bun.file(join(root, ".copilot/backups/herdr-canvas-skill/SKILL.md")).size).toBeGreaterThan(0);
    expect(statSync(mcp).mode & 0o777).toBe(0o600);
    expect(second.changed).toContain(mcp);
  });

  test("installs skills and MCP registration for every supported harness", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-hosts-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    mkdirSync(join(root, ".copilot"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    mkdirSync(join(root, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(root, ".claude.json"),
      `${JSON.stringify({ mcpServers: { unrelated: { command: "claude-other" } } })}\n`,
    );
    writeFileSync(
      join(root, ".codex/config.toml"),
      'model = "test"\n\n[mcp_servers.unrelated]\ncommand = "codex-other"\n',
    );
    writeFileSync(
      join(root, ".pi/agent/mcp.json"),
      `${JSON.stringify({ mcpServers: { unrelated: { command: "pi-other" } } })}\n`,
    );
    let piAdapterChecks = 0;

    await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource, {
        hosts: ["copilot", "claude", "codex", "pi"],
      }),
      {
        ...dependencies,
        ensurePiAdapter() {
          piAdapterChecks += 1;
        },
      },
    );

    for (const skill of [
      ".copilot/skills/herdr-canvas/SKILL.md",
      ".claude/skills/herdr-canvas/SKILL.md",
      ".agents/skills/herdr-canvas/SKILL.md",
      ".pi/agent/skills/herdr-canvas/SKILL.md",
    ]) {
      expect(readFileSync(join(root, skill), "utf8")).toContain("# Herdr Canvas");
    }
    const launcher = join(root, ".local/bin/herdr-canvas");
    const claude = JSON.parse(readFileSync(join(root, ".claude.json"), "utf8"));
    expect(claude.mcpServers.unrelated.command).toBe("claude-other");
    expect(claude.mcpServers["herdr-canvas"]).toEqual({
      command: launcher,
      args: [],
      type: "stdio",
      env: {},
    });
    const codex = readFileSync(join(root, ".codex/config.toml"), "utf8");
    expect(codex).toContain("[mcp_servers.unrelated]");
    expect(codex).toContain("[mcp_servers.herdr-canvas]");
    expect(codex).toContain(`command = ${JSON.stringify(launcher)}`);
    const pi = JSON.parse(readFileSync(join(root, ".pi/agent/mcp.json"), "utf8"));
    expect(pi.mcpServers.unrelated.command).toBe("pi-other");
    expect(pi.mcpServers["herdr-canvas"]).toEqual({
      command: launcher,
      args: [],
      directTools: true,
    });
    expect(piAdapterChecks).toBe(1);
  });

  test("preserves private modes and host-specific MCP fields", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-private-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const mcp = join(root, ".copilot/mcp-config.json");
    mkdirSync(join(root, ".copilot"), { recursive: true });
    writeFileSync(
      mcp,
      `${JSON.stringify({
        mcpServers: {
          "herdr-canvas": {
            command: "old",
            args: ["old"],
            timeout: 45,
            permissions: { trusted: true },
          },
        },
      })}\n`,
      { mode: 0o600 },
    );
    chmodSync(mcp, 0o600);

    await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource, {
        replaceExistingMcp: true,
      }),
      dependencies,
    );

    expect(statSync(mcp).mode & 0o777).toBe(0o600);
    const entry = JSON.parse(readFileSync(mcp, "utf8")).mcpServers["herdr-canvas"];
    expect(entry.command).toBe(join(root, ".local/bin/herdr-canvas"));
    expect(entry.args).toEqual([]);
    expect(entry.timeout).toBe(45);
    expect(entry.permissions).toEqual({ trusted: true });
  });

  test("re-reads host configuration after slow application staging", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-concurrent-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const mcp = join(root, ".copilot/mcp-config.json");
    mkdirSync(join(root, ".copilot"), { recursive: true });
    writeFileSync(mcp, `${JSON.stringify({ theme: "before" })}\n`, { mode: 0o600 });

    await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource),
      {
        ...dependencies,
        prepareDependencies(_bunPath, applicationDirectory) {
          mkdirSync(join(applicationDirectory, "node_modules"), { recursive: true });
          writeFileSync(
            mcp,
            `${JSON.stringify({ theme: "updated-during-staging" })}\n`,
            { mode: 0o600 },
          );
        },
      },
    );

    expect(JSON.parse(readFileSync(mcp, "utf8")).theme).toBe(
      "updated-during-staging",
    );
  });

  test("replaces quoted, inline, and dotted Codex MCP forms safely", async () => {
    const forms = [
      '[mcp_servers."herdr-canvas"]\ncommand = "old"\ntimeout_sec = 15\n',
      '[mcp_servers]\n"herdr-canvas" = { command = "old", timeout_sec = 15 }\n',
      'mcp_servers."herdr-canvas".command = "old"\nmcp_servers."herdr-canvas".timeout_sec = 15\n',
    ];
    for (const existing of forms) {
      const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-codex-${crypto.randomUUID()}`;
      const { sourceRoot, runtimeSource } = fixture(root);
      const config = join(root, ".codex/config.toml");
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(config, existing, { mode: 0o600 });

      await installHerdrCanvas(
        options(root, sourceRoot, runtimeSource, {
          hosts: ["codex"],
          replaceExistingMcp: true,
        }),
        dependencies,
      );

      const parsed = Bun.TOML.parse(readFileSync(config, "utf8")) as {
        mcp_servers: Record<string, { command: string; args: string[]; timeout_sec: number }>;
      };
      expect(parsed.mcp_servers["herdr-canvas"]).toEqual({
        command: join(root, ".local/bin/herdr-canvas"),
        args: [],
        timeout_sec: 15,
      });
    }
  });

  test("leaves Trellage skill ownership to cldx and removes installer-owned copies", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-cldx-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const managedHome = join(root, "managed-claude/home");
    const managedSkill = join(managedHome, "skills/herdr-canvas");
    mkdirSync(managedSkill, { recursive: true });
    writeFileSync(
      join(managedSkill, ".herdr-canvas-install.json"),
      `${JSON.stringify({ owner: "herdr-canvas", version: "old" })}\n`,
    );
    writeFileSync(join(managedSkill, "SKILL.md"), "old\n");

    await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource, {
        hosts: ["claude"],
        managedClaudeHome: managedHome,
      }),
      dependencies,
    );

    expect(existsSync(managedSkill)).toBe(false);
    const profile = JSON.parse(
      readFileSync(join(managedHome, ".claude.json"), "utf8"),
    );
    expect(profile.mcpServers["herdr-canvas"].command).toBe(
      join(root, ".local/bin/herdr-canvas"),
    );
  });

  test("cleans stale atomic skill staging directories", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-skill-stage-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const target = join(root, ".copilot/skills/herdr-canvas");
    const staging = `${target}.staging-${process.pid}`;
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "partial"), "partial\n");

    await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource),
      dependencies,
    );

    expect(existsSync(staging)).toBe(false);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain(
      "# Herdr Canvas",
    );
  });

  test("preflights Pi before creating backups", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-pi-preflight-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const piConfig = join(root, ".pi/agent/mcp.json");
    mkdirSync(join(root, ".pi/agent"), { recursive: true });
    writeFileSync(piConfig, "{}\n", { mode: 0o600 });

    await expect(
      installHerdrCanvas(
        options(root, sourceRoot, runtimeSource, { hosts: ["pi"] }),
        {
          ...dependencies,
          ensurePiAdapter() {
            throw new Error("Pi missing");
          },
        },
      ),
    ).rejects.toThrow("Pi missing");

    expect(existsSync(`${piConfig}.bak-herdr-canvas`)).toBe(false);
    expect(readFileSync(piConfig, "utf8")).toBe("{}\n");
  });

  test("dry run writes nothing and reports exact destinations", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-dry-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const result = await installHerdrCanvas(
      options(root, sourceRoot, runtimeSource, { dryRun: true }),
      dependencies,
    );
    expect(result.changed).toContain(join(root, ".local/bin/herdr-canvas"));
    expect(Bun.file(join(root, ".local/bin/herdr-canvas")).size).toBe(0);
  });

  test("requires explicit replacement for an existing MCP registration", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-mcp-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const mcp = join(root, ".copilot/mcp-config.json");
    mkdirSync(join(root, ".copilot"), { recursive: true });
    writeFileSync(
      mcp,
      `${JSON.stringify({ mcpServers: { "herdr-canvas": { command: "old" } } })}\n`,
    );
    await expect(
      installHerdrCanvas(options(root, sourceRoot, runtimeSource), dependencies),
    ).rejects.toThrow("--replace-existing-mcp");
    expect(JSON.parse(readFileSync(mcp, "utf8")).mcpServers["herdr-canvas"]).toEqual({
      command: "old",
    });
  });

  test("keeps the active application when dependency staging fails", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-stage-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const app = join(root, ".local/share/herdr-canvas/1.2.3");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "active.txt"), "known-good\n");

    await expect(
      installHerdrCanvas(
        options(root, sourceRoot, runtimeSource),
        {
          ...dependencies,
          prepareDependencies() {
            throw new Error("staging failed");
          },
        },
      ),
    ).rejects.toThrow("staging failed");

    expect(readFileSync(join(app, "active.txt"), "utf8")).toBe("known-good\n");
    expect(existsSync(`${app}.staging-${process.pid}`)).toBe(false);
  });

  test("refuses unrelated skill directories and symlink targets before writes", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/canvas-collision-${crypto.randomUUID()}`;
    const { sourceRoot, runtimeSource } = fixture(root);
    const skill = join(root, ".copilot/skills/herdr-canvas");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "unrelated");
    await expect(
      installHerdrCanvas(options(root, sourceRoot, runtimeSource), dependencies),
    ).rejects.toThrow("unrelated skill");

    const symlinkRoot = `${process.env.TMPDIR ?? "/tmp"}/canvas-link-${crypto.randomUUID()}`;
    const nextFixture = fixture(symlinkRoot);
    mkdirSync(join(symlinkRoot, ".local"), { recursive: true });
    symlinkSync(
      join(symlinkRoot, "target"),
      join(symlinkRoot, ".local/bin"),
    );
    await expect(
      installHerdrCanvas(
        options(symlinkRoot, nextFixture.sourceRoot, nextFixture.runtimeSource),
        dependencies,
      ),
    ).rejects.toThrow("symlink");
  });
});
