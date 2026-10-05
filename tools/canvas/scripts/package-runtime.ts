import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { PINNED_NONO_SOURCE_REVISION, PINNED_NONO_VERSION } from "../src/runner/nono-pin.ts";
import { PINNED_BUN_VERSION, validateRuntimeBundle } from "../src/runner/runtime-bundle.ts";

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const digest = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const requireRegularFile = (path: string, label: string): string => {
  const inputStats = lstatSync(path);
  if (inputStats.isSymbolicLink()) fail(`${label} must not be a symlink.`);
  const resolved = realpathSync(path);
  const stats = lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular file.`);
  return resolved;
};

const outputArgument = process.argv[2] ?? "generated/runtime-darwin-arm64";
const outputDirectory = resolve(outputArgument);
const repositoryRoot = realpathSync(join(import.meta.dir, ".."));
const generatedRoot = join(repositoryRoot, "generated");
if (!outputDirectory.startsWith(`${generatedRoot}/`)) {
  fail("Runtime output must be a child directory of generated/.");
}
if (process.platform !== "darwin") fail("Runtime packaging currently supports macOS only.");
if (Bun.version !== PINNED_BUN_VERSION) fail(`Bun ${PINNED_BUN_VERSION} is required.`);

const bunSource = requireRegularFile(process.execPath, "Bun");
const configuredNono = process.env.CANVAS_NONO_BIN ?? Bun.which("nono");
let nonoSource: string;
if (configuredNono === null || configuredNono === undefined) {
  if (!existsSync(outputDirectory)) fail("Pinned Nono is not installed.");
  nonoSource = (await validateRuntimeBundle(outputDirectory)).nonoBinary;
} else {
  nonoSource = requireRegularFile(configuredNono, "Nono");
  const nonoArtifactPath = join(dirname(nonoSource), "nono-artifact.json");
  const nonoArtifact = JSON.parse(readFileSync(nonoArtifactPath, "utf8")) as {
    sourceRevision?: string;
    version?: string;
    sha256?: string;
  };
  if (
    nonoArtifact.sourceRevision !== PINNED_NONO_SOURCE_REVISION ||
    nonoArtifact.version !== PINNED_NONO_VERSION ||
    nonoArtifact.sha256 !== digest(nonoSource)
  ) {
    fail("Installed Nono does not match the reviewed artifact manifest.");
  }
}

const stagingDirectory = `${outputDirectory}.staging-${process.pid}`;
rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });

try {
  const bunPath = join(stagingDirectory, "bun");
  const nonoPath = join(stagingDirectory, "nono");
  const workerPath = join(stagingDirectory, "worker.js");
  copyFileSync(bunSource, bunPath);
  copyFileSync(nonoSource, nonoPath);
  chmodSync(bunPath, 0o555);
  chmodSync(nonoPath, 0o555);

  const build = Bun.spawnSync({
    cmd: [bunSource, "build", join(repositoryRoot, "src/worker/main.ts"), "--target", "bun", "--outfile", workerPath],
    cwd: repositoryRoot,
    env: {},
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) fail(build.stderr?.toString().trim() || "Worker bundle build failed.");
  chmodSync(workerPath, 0o444);

  const manifest = {
    formatVersion: 1,
    bun: { path: basename(bunPath), sha256: digest(bunPath), version: PINNED_BUN_VERSION },
    nono: {
      path: basename(nonoPath),
      sha256: digest(nonoPath),
      sourceRevision: PINNED_NONO_SOURCE_REVISION,
      version: PINNED_NONO_VERSION,
    },
    worker: { path: basename(workerPath), sha256: digest(workerPath) },
  } as const;
  writeFileSync(join(stagingDirectory, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
  chmodSync(stagingDirectory, 0o555);
  await validateRuntimeBundle(stagingDirectory);

  if (isAbsolute(outputDirectory)) {
    try { chmodSync(outputDirectory, 0o755); } catch {}
    rmSync(outputDirectory, { recursive: true, force: true });
  }
  renameSync(stagingDirectory, outputDirectory);
  process.stdout.write(`${outputDirectory}\n`);
} catch (error) {
  rmSync(stagingDirectory, { recursive: true, force: true });
  throw error;
}
