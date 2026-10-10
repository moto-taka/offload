# Plan authoring contract

The WorkPlan schema (version 2.0) is the authority for shape. Read it rather than guessing required fields. The sample is fictional.

## Priority and grounding

1. Latest explicit user correction and scope.
2. Earlier still-valid user decisions.
3. Observed tool results/current code.
4. Clearly labeled hypotheses. Assistant suggestions are not user approvals.

Requirements refer to evidence IDs. Tasks refer to requirements, acceptance criteria, dependencies and evidence. Every requirement needs a task and acceptance criterion. Task dependencies must be acyclic; the first action must name an existing task. Mark source coverage `full_visible`, `compacted`, or `partial` exactly as the schema allows; limitations are required for incomplete history. A `tool_verified` fact needs observed tool/file/commit evidence, not only a user statement.

Preserve rejected options in decisions (and why briefly, not hidden reasoning), constraints, outstanding questions and verified completed work. Do not report a test as passed without its result. Avoid introducing new features, purchases, provider choices, account IDs, authorization booleans or URLs as trusted parameters.

## Environment recipe

Derive source_commit from `inspect`, then read relevant source refs. Keep install, start, health and tests separate. Use argv arrays, relative cwd, pinned/runtime requirements already specified in the project, and the project's lockfile. Do not guess a missing runtime as "latest". Commands are reviewed proposals; the runtime never runs them locally.

Only public dependency hosts are in scope. Tailscale, VPN, SSH bridges and private-network setup are not part of this release. Credentials must be provisioned through the provider's own secret UI; recipes requiring secrets pause with `NEEDS_SECRET_SETUP` until supported setup is performed. Secret values cannot be embedded in a script, snapshot or Plan.

If automatic inference cannot handle a stack, author an explicit recipe. Unresolved requirements must be resolved before writes. Do not change package manifests/lockfiles merely to make environment preparation succeed; that is a user-approved work task.

## Payload and input limits

WorkPlan: 48,000 UTF-8 bytes; recipe: 32,000; rendered dispatch: 100,000. Files: up to 100 MiB each and 100,000 entries. No aggregate repository-size cap; manifests store hashes/metadata, not embedded file contents. Required constraints cannot be silently dropped to meet a limit. LFS, submodules, credential files, unsafe/outside/dangling links and case-colliding paths stop preparation. Repository-internal relative symlinks are preserved as Git mode 120000 without dereferencing. Save the Plan before running inspection.

Evidence locators must describe actual visible messages/tool outputs or repo-relative files; do not include unreachable local absolute paths in the cloud Plan. Required images/binaries need an explicitly supported transport; this version does not silently convert a visual requirement into an inaccurate summary.
