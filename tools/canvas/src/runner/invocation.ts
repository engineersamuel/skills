import { dirname, isAbsolute } from "node:path";

import { SandboxUnavailable } from "./errors.ts";

export interface NonoInvocationInput {
  readonly nonoBinary: string;
  readonly profilePath: string;
  readonly scratchDirectory: string;
  readonly bunBinary: string;
  readonly workerEntrypoint: string;
}

export interface NonoInvocation {
  readonly cmd: string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export const createNonoInvocation = (input: NonoInvocationInput): NonoInvocation => {
  const paths = [
    input.nonoBinary,
    input.profilePath,
    input.scratchDirectory,
    input.bunBinary,
    input.workerEntrypoint,
  ];
  if (paths.some((value) => !isAbsolute(value))) {
    throw new SandboxUnavailable("runtime_bundle_invalid");
  }

  return {
    cmd: [
      input.nonoBinary,
      "--silent",
      "wrap",
      "--profile",
      input.profilePath,
      "--block-net",
      "--write",
      input.scratchDirectory,
      "--workdir",
      input.scratchDirectory,
      "--",
      input.bunBinary,
      "--no-env-file",
      "--no-install",
      input.workerEntrypoint,
    ],
    cwd: input.scratchDirectory,
    env: {
      HOME: dirname(input.profilePath),
      TMPDIR: dirname(input.profilePath),
      XDG_STATE_HOME: dirname(input.profilePath),
    },
  };
};
