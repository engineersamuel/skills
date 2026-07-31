---
name: runwisp-job-authoring
description: Use when creating, changing, debugging, or validating RunWisp filesystem job packages, job.toml manifests, or runwisp-job doctor/run behavior.
---

# RunWisp Job Authoring

Use the current Jobkit contract. Build a self-contained package without inventing scheduler policy, deployment details, credentials, or integrations.

## Workflow

1. Read target repository instructions plus current Jobkit `README.md`, `docs/authoring.md`, relevant implementation/tests, and `examples/`. Use the public repository if a checkout is absent or stale.
2. Choose the closest current Jobkit example and target-project conventions. Leave unknown product or service behavior unimplemented pending its authoritative contract.
3. Make the package own dependencies, forwarded-argument validation, side effects, output, and exit codes. Declare actual runtime inputs.
4. Run proportionate package tests, then `runwisp-job doctor JOB_DIR` in the intended runtime environment before scheduling or normal invocation.
5. If the job provides a safe dry run, invoke it through `runwisp-job run JOB_DIR [ARG ...]` to verify forwarded arguments. Never run a side-effecting path without authorization.

## Manifest

Jobkit recognizes only seven fields; unknown fields are rejected. Check current authoritative documentation for required fields and defaults:

| Field | Purpose |
| --- | --- |
| `schema` | Supported manifest schema. |
| `id` | Nonempty diagnostic label, not a registry key. |
| `kind` | Current execution kind. |
| `cwd` | Working directory relative to the job directory. |
| `argv` | Nonempty executable and argument vector. |
| `required_env` | Names whose values must be present and nonblank. |
| `required_files` | Relative, readable regular files needed at runtime. |

`cwd` and every `required_files` entry must be relative and resolve inside the job directory. The working directory must exist and be accessible; required files must be readable regular files. Absolute paths, parent traversal, and symlink escapes are invalid. Put only environment variable names in the manifest. Never place secret values in manifests, examples, logs, tests, or generated public files.

Preserve shell-free `argv`: Jobkit appends forwarded arguments unchanged and performs no shell parsing. Choose an explicit shell only when the job genuinely requires one; that job then owns quoting and safety.

## Evidence boundaries

`doctor` is passive. It checks the manifest, confined paths, nonblank environment values, files, and executable without running the job or printing environment values. A pass does not prove runtime behavior, forwarded arguments, external-service success, or safe side effects.

On `run`, Jobkit changes to `cwd` and replaces itself with the job process. Stdout, stderr, exit status, and signals then come directly from the job.

Jobkit does not discover jobs, install dependencies, store secrets, configure schedules, or provide a sandbox. For schedule, retry, notification, secret injection, deployment path, or service-account work, inspect the actual scheduler configuration, version, runtime environment, and authoritative schema separately. Do not invent scheduler syntax or private deployment details.

## Common mistakes

- Omitting a lockfile, prompt, or config that the command reads.
- Embedding a shell command as one `argv` string.
- Guessing an API, credential meaning, schedule, path, or notification target.
