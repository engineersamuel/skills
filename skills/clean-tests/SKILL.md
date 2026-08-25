---
name: clean-tests
description: Use when a user asks to clean, prune, simplify, or remove low-value tests; eliminate redundant typecheck, provider-shape, UI/UX, snapshot, feature-existence, or command-registration tests; or refocus a suite on stable behavioral contracts.
---

# Clean Tests

Remove tests that create maintenance cost without protecting a stable,
repository-owned runtime contract. This is an implementation skill: edit the
test suite unless the user explicitly asks for an audit only.

## Core rule

Test contracts, not feature presence. A test earns its place only when all of
these are true:

- A failure identifies a meaningful regression in behavior owned by the
  repository.
- A compiler, type checker, schema checker, or lint rule cannot fully prove the
  same property.
- The oracle does not copy a volatile external-provider or presentation shape.

A repository-owned contract is a stable input, output, state transition, error,
side effect, or interoperability guarantee that the repository promises to its
callers or users. The existence of a file, export, component, route, feature,
registration, or SDK call is not by itself a behavioral contract.

Do not optimize for test count or coverage percentage. Optimize for failure
signal and stable contracts.

## Workflow

### Inspect before deleting

1. Read the repository instructions and discover its existing test, type-check,
   lint, and build commands from configuration and CI.
2. Inventory the tests in scope with their fixtures, mocks, snapshots, and
   production code. Inspect public callers and relevant regression history when
   the purpose is unclear.
3. Name the exact repository-owned contract protected by each test. If no such
   contract can be stated, classify the test for removal.
4. Judge tests by their assertions and failure signal, not only by filenames,
   test titles, grep matches, or test framework.

### Apply the retention bar

| Test category | Default action | Retain only when |
| --- | --- | --- |
| Feature or symbol exists | Remove | The test exercises a concrete runtime contract beyond presence |
| Route, component, slash command, or handler registers | Remove | Registration itself has stable repository-owned behavior beyond framework wiring |
| Property already proved by types, compilation, schemas, or lint | Remove | Runtime behavior remains that static analysis cannot prove |
| Mock or fixture copies an external provider's raw API shape | Remove | A narrow adapter test exercises nontrivial local transformation through official typed boundaries |
| Snapshot, exact copy, markup, CSS, layout, or render-presence assertion | Remove aggressively | It protects a stable critical interaction, accessibility behavior, or state transition |
| Mock call order or private implementation detail | Remove | The sequence is itself an externally observable contract |
| Input, output, state, error, or side-effect behavior | Keep | The contract is stable, meaningful, and owned by the repository |
| Known regression for a meaningful failure mode | Keep | The test still reproduces the failure through a public or stable boundary |

Do not replace a deleted test with an equivalent shallow assertion. Do not
retain a test because it is easy to understand, cheap to run, or increases
coverage.

### Handle external providers

Do not simulate an external provider and call that compatibility proof. Hand-
written provider payloads, mocked SDK response shapes, raw request-body
snapshots, endpoint argument lists, and copied event schemas can stay green
after the real provider changes.

For adapters such as Discord:

- Remove tests that assert Discord's raw interaction, gateway event, command
  registration, or request shape.
- Keep tests for behavior owned by the repository, such as normalization into
  an internal model, dispatch, authorization, deduplication, error mapping, and
  lifecycle transitions.
- When a nontrivial adapter transformation must receive provider data, prefer
  official SDK types or builders. Keep the input minimal and assert the
  repository's normalized result, not the provider shape.
- If the repository has no owned behavior at that boundary, remove the unit
  test. Do not invent a fake provider contract or add a live network test to
  replace it.

State provider compatibility as unverified unless an existing real integration
check proves it.

### Cull UI and command tests

Remove UI and UX tests heavily when they assert exact text, snapshots, DOM
shape, styling, layout, element presence, or trivial event wiring. Keep only
critical user interactions, accessibility behavior, and stable state
transitions whose failures would be meaningful and are not proved elsewhere.

Remove tests whose only claim is that a slash command, route, menu item, or
handler registers. Keep parsing, authorization, dispatch, error, and side-
effect contracts when those behaviors contain repository-owned logic.

### Edit the suite

Delete complete test cases or files when all their assertions fail the
retention bar. Then remove newly unused:

- Fixtures and provider payload samples
- Mocks, stubs, factories, and test helpers
- Snapshots and test-only assets
- Imports, setup hooks, configuration, and dependencies

Do not delete production behavior to make the reduced suite pass. Preserve
unrelated worktree changes and follow the repository's normal formatting and
dependency-management tools.

### Verify

Run the smallest relevant tests while editing, then run every applicable
existing type-check, lint, build, and test command for the changed scope.
Compare failures with the baseline when one exists. Do not add shallow tests
only to restore a test count or coverage threshold.

Report:

- Test categories and support files removed
- The repository-owned contracts intentionally retained
- Exact validation commands and outcomes
- Any boundary that remains unverified or any failure that requires user action

## Completion gate

Finish only when:

- Every remaining test in the reviewed scope has a specific, meaningful
  repository-owned contract.
- Existence, static-analysis, provider-shape, registration, and volatile
  presentation tests in scope are removed.
- Orphaned fixtures, mocks, snapshots, helpers, and dependencies are removed.
- Applicable checks pass, or pre-existing and blocked failures are identified
  exactly.
- The diff contains no unrelated production change or replacement shallow test.
