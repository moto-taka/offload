# Offload recovery — v0.1.3

## Save first

The current agent authors the Plan before Git or auth checks. Run `save-plan --plan <private-file> --repo <repo> --host claude --target claude --request-id <user-message-id>`, keep the returned ID, then `prepare --job-id <id> [--recipe <file>]`. `submit`/`resume` can continue a saved job after missing setup is resolved. No login, worktree scan or environment creation is needed to retain the Plan.

## Node.js 26 is Offload's runtime, not necessarily the project's runtime

Run `doctor` and check `runtime.supported`. Execute Offload with an installed Node 26 binary. With nvm, `nvm install 26` (only if needed), then `nvm exec 26 node <installed-skill>/scripts/offload.mjs <command>`. This does not require changing the application's Node 24 engines or `.nvmrc`. Save/validate/doctor/setup are recovery commands; export and dispatch reject unsupported execution runtimes.

## Skill symlinks and large repositories

Do not remove `.claude/skills` aliases or replace the user's branch with a clean main/develop. Relative symlinks within the exported tree are stored as link text with Git mode 120000. Absolute/outside links, credentials, Git metadata, cycles and missing targets still stop export with a specific path. Targets excluded by Git ignore rules are not silently included.

The 20 MiB aggregate and 5 MiB per-file restrictions are removed. The remaining implementation safety bounds are 100 MiB per file and 100,000 entries; these are Offload limits, not a claim about every provider. Content is read one file at a time, hashed, scanned for secrets and rechecked before publication. Durable manifests are metadata-only. Changing source files after preparation requires a new job; old inline saved manifests remain readable.

## Claude: diagnose before configuration

`auth claude --repo <repo>` invokes only the official `claude --version` and `claude auth status`. It does not create a task, extract a token, approve anything, or edit the account. If signed out, run `claude auth login` or `/login` and resume. Authentication method `claude.ai` is accepted in addition to the older OAuth-shaped fixture, while API-key and third-party auth are rejected.

Run `setup claude --repo <repo>` in a real terminal once. The CLI discovers the executable and signed-in email; the user confirms the intended account, managed Cloud/default environment, snapshot/bundle permissions and opt-in. No need to edit `expectedPrincipal` by hand. A configured account mismatch is never silently rebound. Existing `claudeCloudVerified` is an explicit environment-selection confirmation, not proof manufactured by an agent. Self-hosted `ccpool_` targets remain rejected.

`trust <job-id>` approves only the reviewed job. `trust <job-id> --remember` explicitly remembers this binding and environment recipe for future tracked-only jobs; new untracked files still require fresh approval. These are user actions, not commands an agent should approve for itself. `autoApprove` does not authorize new accounts, secrets, deployment or merge.

Claude Cloud dispatch does not use `--bare`: the official docs say bare mode skips OAuth/keychain credentials. Instead the dispatcher disables local hooks/settings discovery/MCP/slash commands with individual flags while retaining the normal subscription-login location. API key/provider overrides and the nested local-session marker are removed from the child's environment. Managed policy and account checks are not bypassed.

## Scope of the fix

Reproduction tests use a synthetic 60 MiB repository with 22 skill links, a local bare Git remote and mocked provider responses. They are not tests against the user's actual repository, Claude account, Cloud quota, systemd/Podman capabilities, or Lerd setup. Any cloud prerequisite failure should be returned as evidence, not reported as a completed verification.

Official references (checked 2026-10-10):
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/headless#start-faster-with-bare-mode
- https://code.claude.com/docs/en/claude-code-on-the-web
