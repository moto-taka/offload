---
name: offload
description: Summarize the current coding conversation into a grounded execution Plan and send it to one provider-managed cloud (new Codex Cloud, Claude Code Cloud, Cursor Cloud, or Devin), preparing and reusing an approved development environment. Use only when the user explicitly requests offload; do not use for local delegation or Devin's native handoff.
disable-model-invocation: true
license: MIT
compatibility: Requires Node.js 26.x (>=26.0.0 <27.0.0) and Git. Provider login/API access is configured separately. New Codex needs a connected host browser tool. Pi and OpenCode can install optional slash-command shims.
metadata:
  version: 0.1.3
  repository: https://github.com/moto-taka/offload
---

# Offload

Run this workflow in the **current conversation**. This skill contains its complete dependency-free runtime in `scripts/`; do not fetch another implementation, install a model router, or start a second local coding agent.

## Non-negotiable boundaries

- Cloud destinations are `codex`, `claude`, `cursor`, `devin`. Pi/OpenCode are sources, not destinations.
- Never implement/use `--local`, rename this to `/handoff`, override Devin's native `/handoff`, or silently use Legacy, another account, another cloud, a self-hosted runner, Remote Control, a separately billed model API, Tailscale, or VPN.
- Use the current host's model and visible conversation to author the Plan. No hidden reasoning, unrelated conversations, full chat dumps, credentials, cookies, or other clients' data.
- Latest user corrections override earlier suggestions. An assistant proposal is not an approved requirement. Keep the requested scope (research-only stays research-only).
- Never run `trust`, answer its prompt, edit the trusted permission configuration, or manufacture UI proof on behalf of the user. The user can approve once in their terminal or explicitly maintain a scoped automatic policy.
- A JSON schema is not evidence that a test ran. Only actual cloud receipt IDs/URLs mean accepted; only observed tests support completion.

## Resolve the installed runtime

Use the absolute directory containing **this SKILL.md**, not the user's repository and not a guessed global path. Define:

```sh
OFFLOAD="<absolute installed skill directory>/scripts/offload.mjs"
node "$OFFLOAD" doctor
```

All commands below are executable `node` calls to that exact installed script. Quote every path/argument; never insert user text as shell code. Node may print an experimental SQLite warning on stderr; JSON results are on stdout. Runtime state belongs outside the project (the doctor command shows its path).

## 1. Interpret the explicit request

Accept `/offload [codex|claude|cursor|devin] [additional instruction]`, `--preview`, `setup`, `status`, `resume`. `--` separates literal added instructions. Use `node "$OFFLOAD" parse "<arguments>"` when parsing is uncertain.

An omitted target defaults to the host's cloud for Codex/Claude/Cursor. Pi/OpenCode use configured defaults. Do not infer the target from the selected model. If unavailable, ask only for the missing destination.

For `setup`, read [setup.md](references/setup.md). For `status` or `resume`, call the corresponding runtime command with the saved job ID; do not regenerate or resubmit the job.

## 2. Save the conversation Plan FIRST

Read [plan-authoring.md](references/plan-authoring.md) and `schemas/work-plan.schema.json`. Author a WorkPlan from THIS conversation and save it to a private file outside the repository. The examples are fictional fixtures, never the user's task. Do not run `inspect`, require login, or build a clean worktree before saving the Plan.

```sh
node "$OFFLOAD" save-plan --plan "<plan.json>" --repo "<project>" \
  --host "<actual host>" --target "<cloud>" --request-id "<current user message id>"
```

Keep the returned job ID and `planPath`, even if runtime, Git, auth, or setup blocks later steps. A new explicit request uses a new request ID. Do not claim no Plan exists merely because inspection failed. This local-only recovery command can save a Plan on Node 22.16+/24; Cloud execution remains Node 26 only.

## 3. Inspect and prepare the SAME saved job

Read `doctor.runtime`. If `supported` is false, preserve the Plan and use an installed Node 26 executable for Offload. With nvm, use `nvm exec 26 node "$OFFLOAD" ...`. If 26 is missing, ask the user to install it (`nvm install 26`). Do not change the app's `.nvmrc`, package engines, dependencies, or default runtime merely to run Offload. Do not pretend Node 24 is supported for dispatch.

Finish in-flight writes. Inspect the original intended worktree; do not switch to develop/main or manufacture a clean worktree just to pass export checks. Existing staged and unstaged changes are part of the reviewed snapshot.

```sh
node "$OFFLOAD" inspect --repo "<project>"
```

This performs static reads only. Internal relative symlinks (including `.claude/skills` aliases) are kept as Git links, not followed into other files. Do not delete links to bypass an error. There is no total 20 MiB limit. Files are hashed individually and reread at send time; metadata, not base64 repository contents, is saved.

Review AGENTS.md, CI, manifests and lockfiles. For a non-Node or monorepo stack, author an explicit EnvironmentRecipe using `schemas/environment-recipe.schema.json`. A proposed Lerd/systemd/Podman setup must first be checked for compatibility INSIDE the cloud, not installed on the local machine. Keep limitations in the Plan.

```sh
node "$OFFLOAD" prepare --job-id "<saved-job-id>" --recipe "<recipe.json>"
```

Omit `--recipe` only when automatic detection is correct. `save-plan --preview` creates a preview-only job; it never grants permission to submit. Do not replace an already captured source with a newer branch/HEAD. On a changed source, create a new explicit request and preserve the old Plan.

## 4. Send, not just summarize

Normal requests continue to:

```sh
node "$OFFLOAD" submit "<job-id>"
```

If approved, the Core ensures an environment, publishes only the reviewed snapshot to a dedicated ref, sends the Plan, and saves the receipt. The original worktree/index/branch are not edited. **Do not manually run install/test scripts or implement the requested work locally while awaiting cloud dispatch.**

For `ENVIRONMENT_BUILDING`, keep the saved job and use `resume` after the build is ready while this session is active. Do not claim the host will continue monitoring after it closes. For `NEEDS_SETUP` on Claude, run the read-only `auth claude --repo "<project>"` diagnostic first. `setup claude` discovers the account and CLI path; the user confirms permissions in their terminal. For `NEEDS_AUTH`, ask for `claude auth login` or `/login`. For `NEEDS_APPROVAL`, give the exact `trust "<job-id>"` command; `trust "<job-id>" --remember` lets the user approve the same account/repository/recipe for future tracked-only requests. Do not set flags or answer trust for them. New untracked files always require a fresh human review even under a remembered recipe policy.

For **new Codex environment setup**, open `https://chatgpt.com/settings/codex-cloud` through the connected host and execute the generated instruction using **Cloud Environment Onboarding: Setup**. Offload does not separately navigate environment creation, install dependencies, or click Publish; Setup owns that flow. If signed out, ask the user to log in and resume the same saved job. Follow [codex-ui.md](references/codex-ui.md) to record the result and then send the WorkPlan. On `NEEDS_AUTH`, handle login rather than starting another Setup. On `NEEDS_UI_DRIVER`, use an actually connected host browser/computer tool or report that it is missing. Do not fall back to the old CLI.

For ambiguous submission/write results, inspect/reconcile the saved operation. Never re-click or create another task as a retry. The runtime may intentionally require manual review rather than guess.

See [troubleshooting.md](references/troubleshooting.md) for runtime, snapshot and Claude setup recovery.

## 5. Return verifiable results

Return the job ID, destination/account, environment preparation state, exact code commit/ref, and **observed** receipt URL/ID. Distinguish build acceptance, task acceptance, execution, and tested completion. `status` reads the original Cursor run/Devin session when supported; Claude/Codex may require the official UI. Do not promote a provider's final message into verified acceptance automatically.

Stop continuing the same implementation locally after acceptance. Do not merge, deploy, purchase, broaden access, create secrets, or recursively offload.

## Optional native entrypoints

The installed skill itself works with the host's native skill invocation. Codex commonly uses `$offload`; Pi can use `/skill:offload`. To add `/offload` to Pi or OpenCode, the user explicitly runs:

```sh
node "$OFFLOAD" install-host pi --scope global
node "$OFFLOAD" install-host opencode --scope global
```

These create thin loaders to this installed skill and refuse conflicting files. Reload the host after installing. Removing/moving this skill may require removing/updating the loader. No automatic installation or configuration overwrite is performed.
