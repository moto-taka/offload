---
name: offload
description: Summarize the current coding conversation into a grounded execution Plan and send it to one provider-managed cloud (new Codex Cloud, Claude Code Cloud, Cursor Cloud, or Devin), preparing and reusing an approved development environment. Use only when the user explicitly requests offload; do not use for local delegation or Devin's native handoff.
disable-model-invocation: true
license: MIT
compatibility: Requires Node.js 26.x (>=26.0.0 <27.0.0) and Git. Provider login/API access is configured separately. New Codex needs a connected host browser tool. Pi and OpenCode can install optional slash-command shims.
metadata:
  version: 0.1.2
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

## 2. Fix the source boundary and inspect

Finish any in-flight write operation before capturing. Use the **current visible branch** of the conversation; never join unrelated branches. If compacted/partial, preserve the limitation.

```sh
node "$OFFLOAD" inspect --repo "<absolute project path>"
```

This is a static read, not `npm install` or local implementation. It returns the real Git HEAD, exported-file metadata, and a proposed recipe for a single-lockfile Node project. Review actual `AGENTS.md`, CI, manifests, lockfiles, and runtime files when needed. For another stack, author the explicit recipe from those files.

## 3. Author the Plan and recipe

Read [plan-authoring.md](references/plan-authoring.md), `schemas/work-plan.schema.json`, and `schemas/environment-recipe.schema.json`. The files under `examples/` are **fictional schema fixtures**, never the user's requirements. Do not submit them unchanged.

Write a WorkPlan and, when necessary, an EnvironmentRecipe to private files **outside the repository**. Prefer an OS temporary directory with mode 0700 and files mode 0600. Keep paths in shell variables; do not embed hidden material in prompts or process arguments.

- Plan: objective, in/out scope, latest requirements, adopted/rejected decisions, evidence-backed current state, ordered tasks, acceptance criteria, constraints, questions, first action.
- Recipe: captured source_commit, runtimes, locked install, starts, health checks, tests, source refs, public package hosts, unresolved requirements. Secret **names** only, never values.
- Make one normal authoring pass and at most one schema-repair pass. Do not repeatedly summarize the same conversation.

```sh
node "$OFFLOAD" validate --plan "<plan.json>" --recipe "<recipe.json>"
node "$OFFLOAD" prepare --plan "<plan.json>" --recipe "<recipe.json>" \
  --repo "<project>" --host "<actual source host>" --target "<cloud>" \
  --request-id "<stable explicit user request identifier>"
```

Omit `--recipe` only when the inspected automatic Node recipe is correct. Omit `--target` only when the default is known. Add `--preview` to prepare for preview requests; preview never creates environments, builds, refs, or tasks. Save and return the job ID even if preparation pauses.

## 4. Send, not just summarize

Normal requests continue to:

```sh
node "$OFFLOAD" submit "<job-id>"
```

If approved, the Core ensures an environment, publishes only the reviewed snapshot to a dedicated ref, sends the Plan, and saves the receipt. The original worktree/index/branch are not edited. **Do not manually run install/test scripts or implement the requested work locally while awaiting cloud dispatch.**

For `ENVIRONMENT_BUILDING`, keep the saved job and use `resume` after the build is ready while this session is active. Do not claim the host will continue monitoring after it closes. For `NEEDS_APPROVAL` or `NEEDS_SETUP`, show the exact missing requirement and the setup guide; do not invent approval. New untracked files always require a fresh human review even under a remembered recipe policy.

For **new Codex environment setup**, open `https://chatgpt.com/settings/codex-cloud` through the connected host and execute the generated instruction using **Cloud Environment Onboarding: Setup**. Offload does not separately navigate environment creation, install dependencies, or click Publish; Setup owns that flow. If signed out, ask the user to log in and resume the same saved job. Follow [codex-ui.md](references/codex-ui.md) to record the result and then send the WorkPlan. On `NEEDS_AUTH`, handle login rather than starting another Setup. On `NEEDS_UI_DRIVER`, use an actually connected host browser/computer tool or report that it is missing. Do not fall back to the old CLI.

For ambiguous submission/write results, inspect/reconcile the saved operation. Never re-click or create another task as a retry. The runtime may intentionally require manual review rather than guess.

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
