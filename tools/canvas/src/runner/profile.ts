import { isAbsolute } from "node:path";

import template from "../../runtime/canvas-nono-profile.template.json" with { type: "json" };

import { SandboxUnavailable } from "./errors.ts";

export interface SandboxProfileInput {
  readonly runtimeBundle: string;
  readonly profileDirectory: string;
  readonly scratchDirectory: string;
  readonly bunBinary: string;
}

export interface CanvasSandboxProfile {
  readonly meta: { readonly name: "default" };
  readonly groups: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  readonly workdir: { readonly access: "none" };
  readonly filesystem: {
    readonly read: readonly string[];
    readonly deny: readonly string[];
  };
  readonly network: { readonly block: true };
  readonly environment: {
    readonly allow_vars: readonly string[];
    readonly set_vars: Readonly<Record<"HOME" | "TMPDIR", string>>;
  };
  readonly security: {
    readonly signal_mode: "isolated";
    readonly process_info_mode: "isolated";
    readonly ipc_mode: "shared_memory_only";
    readonly capability_elevation: false;
  };
  readonly unsafe_macos_seatbelt_rules: readonly string[];
}

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

type MutableCanvasSandboxProfile = Mutable<CanvasSandboxProfile>;

const hasControlCharacter = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);

const assertSafeAbsolutePath = (value: string): void => {
  if (!isAbsolute(value) || hasControlCharacter(value)) {
    throw new SandboxUnavailable("runtime_bundle_invalid");
  }
};

const seatbeltString = (value: string): string => JSON.stringify(value);

const assertTemplateSlot = (actual: unknown, expected: string): void => {
  if (actual !== expected) throw new SandboxUnavailable("runtime_bundle_invalid");
};

export const buildSandboxProfile = (input: SandboxProfileInput): CanvasSandboxProfile => {
  for (const value of [
    input.runtimeBundle,
    input.profileDirectory,
    input.scratchDirectory,
    input.bunBinary,
  ]) {
    assertSafeAbsolutePath(value);
  }

  const profile = JSON.parse(JSON.stringify(template)) as MutableCanvasSandboxProfile;

  assertTemplateSlot(profile.meta.name, "default");
  assertTemplateSlot(profile.filesystem.read[0], "__CANVAS_RUNTIME_BUNDLE__");
  assertTemplateSlot(profile.filesystem.read[1], "__CANVAS_SCRATCH_DIRECTORY__");
  assertTemplateSlot(profile.filesystem.deny[0], "__CANVAS_PROFILE_DIRECTORY__");
  assertTemplateSlot(profile.environment.set_vars.HOME, "__CANVAS_SCRATCH_DIRECTORY__");
  assertTemplateSlot(profile.environment.set_vars.TMPDIR, "__CANVAS_SCRATCH_DIRECTORY__");
  assertTemplateSlot(profile.unsafe_macos_seatbelt_rules[2], "__CANVAS_ALLOW_BUN_EXEC__");

  profile.filesystem.read[0] = input.runtimeBundle;
  profile.filesystem.read[1] = input.scratchDirectory;
  profile.filesystem.deny[0] = input.profileDirectory;
  profile.environment.set_vars.HOME = input.scratchDirectory;
  profile.environment.set_vars.TMPDIR = input.scratchDirectory;
  profile.unsafe_macos_seatbelt_rules[2] =
    `(allow process-exec* (literal ${seatbeltString(input.bunBinary)}))`;

  return profile;
};
