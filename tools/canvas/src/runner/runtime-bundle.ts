import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { SandboxUnavailable } from "./errors.ts";
import {
  PINNED_NONO_SOURCE_REVISION,
  PINNED_NONO_VERSION,
  validateNonoArtifact,
  type NonoArtifactManifest,
} from "./nono-pin.ts";

export const PINNED_BUN_VERSION = "1.4.2";
export const RUNTIME_MANIFEST_FILENAME = "runtime-manifest.json";

export interface RuntimeFilePin {
  readonly path: string;
  readonly sha256: string;
}

export interface RuntimeBundleManifest {
  readonly formatVersion: 1;
  readonly bun: RuntimeFilePin & { readonly version: string };
  readonly nono: RuntimeFilePin & NonoArtifactManifest;
  readonly worker: RuntimeFilePin;
}

export interface VerifiedRuntimeBundle {
  readonly root: string;
  readonly bunBinary: string;
  readonly nonoBinary: string;
  readonly workerEntrypoint: string;
}

export interface RuntimeVersionResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type RuntimeVersionCommand = (
  tool: "bun" | "nono",
  binaryPath: string,
  cwd: string,
) => RuntimeVersionResult;

export interface RuntimeBundleOptions {
  readonly runVersionCommand?: RuntimeVersionCommand;
}

const MAX_MANIFEST_BYTES = 16 * 1024;
const PINNED_MANIFEST_HASH = /^[a-f0-9]{64}$/u;
const PINNED_REVISION = /^[a-f0-9]{40}$/u;

const unavailable = (): never => {
  throw new SandboxUnavailable("runtime_bundle_invalid");
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");

const readRuntimeManifest = (root: string): RuntimeBundleManifest => {
  const manifestPath = join(root, RUNTIME_MANIFEST_FILENAME);
  try {
    const stats = lstatSync(manifestPath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_MANIFEST_BYTES) {
      return unavailable();
    }
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    return parseRuntimeManifest(parsed);
  } catch (error) {
    if (error instanceof SandboxUnavailable) throw error;
    return unavailable();
  }
};

const parseRuntimeManifest = (value: unknown): RuntimeBundleManifest => {
  const manifest = asRecord(value);
  if (
    manifest === undefined ||
    !hasExactKeys(manifest, ["formatVersion", "bun", "nono", "worker"]) ||
    manifest.formatVersion !== 1
  ) {
    return unavailable();
  }
  const bun = parseRuntimeFile(manifest.bun, ["path", "sha256", "version"]);
  const nonoRecord = asRecord(manifest.nono);
  const nonoFile = parseRuntimeFile(manifest.nono, [
    "path",
    "sha256",
    "sourceRevision",
    "version",
  ]);
  const worker = parseRuntimeFile(manifest.worker, ["path", "sha256"]);
  if (
    bun === undefined ||
    nonoFile === undefined ||
    nonoRecord === undefined ||
    worker === undefined ||
    typeof bun.version !== "string" ||
    typeof nonoRecord.sourceRevision !== "string" ||
    typeof nonoRecord.version !== "string"
  ) {
    return unavailable();
  }

  if (
    bun.version !== PINNED_BUN_VERSION ||
    nonoRecord.sourceRevision !== PINNED_NONO_SOURCE_REVISION ||
    nonoRecord.version !== PINNED_NONO_VERSION ||
    !PINNED_REVISION.test(nonoRecord.sourceRevision)
  ) {
    return unavailable();
  }
  return {
    formatVersion: 1,
    bun: { ...bun, version: bun.version },
    nono: {
      ...nonoFile,
      sourceRevision: nonoRecord.sourceRevision,
      version: nonoRecord.version,
    },
    worker,
  };
};

const parseRuntimeFile = (
  value: unknown,
  keys: readonly string[],
): (RuntimeFilePin & Record<string, unknown>) | undefined => {
  const record = asRecord(value);
  if (
    record === undefined ||
    !hasExactKeys(record, keys) ||
    typeof record.path !== "string" ||
    !validRelativePath(record.path) ||
    typeof record.sha256 !== "string" ||
    !PINNED_MANIFEST_HASH.test(record.sha256)
  ) {
    return undefined;
  }
  return record as RuntimeFilePin & Record<string, unknown>;
};

const validRelativePath = (path: string): boolean => {
  if (path.length === 0 || isAbsolute(path) || /[\\\u0000-\u001f\u007f]/u.test(path)) {
    return false;
  }
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const resolveRegularFile = (root: string, relativePath: string): string => {
  let cursor = root;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    cursor = join(cursor, segments[index]!);
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink()) return unavailable();
    if (index < segments.length - 1 && !stats.isDirectory()) return unavailable();
    if (index === segments.length - 1 && (!stats.isFile() || (stats.mode & 0o222) !== 0)) return unavailable();
  }
  return cursor;
};

const sha256File = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const defaultVersionCommand: RuntimeVersionCommand = (tool, binaryPath, cwd) => {
  try {
    const result = Bun.spawnSync({
      cmd: [binaryPath, "--version"],
      cwd,
      env: {},
      stdout: "pipe",
      stderr: "ignore",
    });
    return {
      exitCode: result.exitCode ?? -1,
      stdout: result.stdout?.toString() ?? "",
    };
  } catch {
    return { exitCode: 127, stdout: `${tool} could not start` };
  }
};

const assertVersion = (
  runVersionCommand: RuntimeVersionCommand,
  tool: "bun" | "nono",
  path: string,
  root: string,
  expectedOutput: string,
): string => {
  let result: RuntimeVersionResult;
  try {
    result = runVersionCommand(tool, path, root);
  } catch {
    throw new SandboxUnavailable(tool === "bun" ? "bun_version_mismatch" : "nono_version_mismatch");
  }
  if (result.exitCode !== 0 || result.stdout.trim() !== expectedOutput) {
    throw new SandboxUnavailable(tool === "bun" ? "bun_version_mismatch" : "nono_version_mismatch");
  }
  return result.stdout;
};

export const validateRuntimeBundle = async (
  runtimeDirectory: string,
  options: RuntimeBundleOptions = {},
): Promise<VerifiedRuntimeBundle> => {
  if (!isAbsolute(runtimeDirectory) || /[\u0000-\u001f\u007f]/u.test(runtimeDirectory)) {
    return unavailable();
  }
  let root: string;
  try {
    const stats = lstatSync(runtimeDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o022) !== 0) return unavailable();
    root = realpathSync(runtimeDirectory);
  } catch {
    return unavailable();
  }

  const manifest = readRuntimeManifest(root);
  let bunBinary: string;
  let nonoBinary: string;
  let workerEntrypoint: string;
  try {
    bunBinary = resolveRegularFile(root, manifest.bun.path);
    nonoBinary = resolveRegularFile(root, manifest.nono.path);
    workerEntrypoint = resolveRegularFile(root, manifest.worker.path);
  } catch {
    return unavailable();
  }

  const [bunHash, nonoHash, workerHash] = await Promise.all([
    sha256File(bunBinary),
    sha256File(nonoBinary),
    sha256File(workerEntrypoint),
  ]).catch(() => unavailable());
  if (
    bunHash !== manifest.bun.sha256 ||
    nonoHash !== manifest.nono.sha256 ||
    workerHash !== manifest.worker.sha256
  ) {
    return unavailable();
  }

  const runVersionCommand = options.runVersionCommand ?? defaultVersionCommand;
  assertVersion(runVersionCommand, "bun", bunBinary, root, PINNED_BUN_VERSION);
  const nonoVersionOutput = assertVersion(
    runVersionCommand,
    "nono",
    nonoBinary,
    root,
    `nono ${PINNED_NONO_VERSION}`,
  );
  validateNonoArtifact(manifest.nono, nonoHash, nonoVersionOutput);

  return { root, bunBinary, nonoBinary, workerEntrypoint };
};
