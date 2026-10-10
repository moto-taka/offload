# Initial setup and permissions

Requires Node.js 26.x (>=26.0.0 <27.0.0), Git, and access to the destination's provider-managed cloud. `skills add` installs the skill files, not provider accounts, browser permissions or subscriptions. No npm publish is needed for GitHub-source skills installation.

Save the current WorkPlan first with `save-plan`. Setup uses Git identity only, not the full exporter; links and repository size cannot prevent authentication setup. On a host using Node 24, use `nvm exec 26 node "<skill>/scripts/offload.mjs" ...` for Offload after installing 26 with approval. Do not change the application's runtime.

## Human setup

Find the script next to the installed SKILL.md:

```sh
node "<skill>/scripts/offload.mjs" setup cursor --repo "/absolute/project"
```

In an actual terminal it asks for non-secret account identifiers and explicit permissions. In a headless agent shell it writes a **disabled** template only. Keys go into the configured environment variable (e.g. CURSOR_API_KEY / DEVIN_API_KEY), never into config.json, a Plan, source control or the chat. `doctor` prints the state directory; config.json must be mode 0600.

The user may edit this trusted file directly. Bindings select an exact repository, provider and execution flavor. Do not keep two enabled bindings for the same repository/provider. Pi/OpenCode defaults can be set in `defaults` (for example `{ "pi": "cursor", "opencode": "claude" }`).

All adapters start disabled, and live verification is **not** claimed. The API/CLI adapters require `allowExperimental: true` until the user has verified the contract with their account. This prevents an untested integration from masquerading as a guaranteed production connection.

## Per-job approval

```sh
node "<skill>/scripts/offload.mjs" review "ofl_<uuid>"
node "<skill>/scripts/offload.mjs" trust "ofl_<uuid>"
node "<skill>/scripts/offload.mjs" resume "ofl_<uuid>"
```

Read the full source file list, untracked files, environment commands, account and provider flags. The human types APPROVE. Agents must not fabricate this step. The approval fingerprint binds Plan, recipe, file manifest and the entire provider binding; changing any invalidates the approval.

For remembered approval, the user may run `trust <job-id> --remember` in an actual terminal, review the scope and type APPROVE. This sets a policy for the exact binding and reviewed recipe, not all repositories. Agents must not answer the prompt themselves. Alternatively, for a user's intentionally unattended workflow, set `autoApprove: true` and add only reviewed environment fingerprints to `approvedRecipeHashes` in the trusted config. This still requires exact provider/repository binding, snapshot-push permission and no newly untracked files. Config changes are user-controlled, not made by the skill.

## Provider-specific prerequisites

### New Codex Cloud

Open https://chatgpt.com/settings/codex-cloud through the calling host and run **Cloud Environment Onboarding: Setup** with the target repository: `Cloud Environment Onboarding: Setup を使って、https://github.com/<owner>/<repo> のクラウド環境をセットアップしてください。未認証の場合は、ログインを求めてください。`

Offload delegates environment creation/configuration to this ChatGPT workflow; it does not duplicate the Create/Install/Publish sequence. If authentication is missing, ask the user to log in on the official page, then resume the same saved job. Do not ask for passwords, cookies or tokens in chat. An environment ID is obtained from the actual Setup result, not required as interactive setup input. Existing verified environments can be reused.

`setup codex` returns the `onboarding` URL/skill/prompt for the host to execute; the Node CLI cannot itself execute a ChatGPT UI skill. `allowEnvironmentCreate` and the reviewed account/repository scope still apply. Task dispatch and its `allowPromptGitGate` check are unchanged. See codex-ui.md. No old CLI, Legacy, API-billing or local fallback is present.

### Claude Code Cloud

Run the read-only diagnostic first:

```sh
node "<skill>/scripts/offload.mjs" auth claude --repo "/absolute/project"
```

It runs the official `claude --version` and `claude auth status`. Missing login returns `NEEDS_AUTH` with `claude auth login` (or `/login`). It accepts subscription authentication reported as `claude.ai` or `oauth`, not an API-key/third-party provider, and reports the account without reading tokens.

In a real terminal `setup claude` discovers the CLI and pre-fills the observed email; the user confirms permissions rather than manually editing boolean fields. Keep `claudeCloudVerified` for a confirmed Anthropic-managed Cloud environment and `allowExperimental` as an honest opt-in to the not-live-tested adapter. CLI login alone does not prove GitHub access, managed Cloud availability or budget approval. A custom environment ID is optional; default must be verified. Known self-hosted `ccpool_` IDs are refused.

CLI >=2.1.224 remains required for this dispatch interface. `allowSnapshotBundle` authorizes fallback only inside a new depth-1 checkout of the reviewed tree. API credentials and alternate-provider environment variables are not forwarded. **Do not use `--bare`: it skips OAuth/keychain login and conflicts with subscription dispatch.** Instead the launcher disables normal setting sources, hooks, MCP and slash skills individually while retaining the official login location. No local coding session or alternate paid API is started.

See [troubleshooting.md](troubleshooting.md) for a complete save/prepare/setup/trust/resume sequence and the remaining real-provider verification limits.

### Cursor

Set a **user** API key; `expectedPrincipal` must match `/v1/me` user ID or email. This release deliberately does not enable service-account execution. A dedicated personal, single-repository `environmentName` is required. The API creates its reviewed environment.json and inspects builds; existing externally modified configurations stop for review. `allowEnvironmentCreate` permits creating/updating only an owned, previously-recorded compatible environment.

The explicit named cloud environment is selected at launch. `env` and `repos` are never sent together. Because that mode lacks a native startingRef override, `allowPromptGitGate` must be approved: the first cloud action fetches the dedicated approved ref into a new worktree and verifies its commit before editing. Environment build success is shown as LAUNCHABLE, not proof that the runtime has already passed every health/test gate.

### Devin

The environment API uses v3beta1 and currently requires a service-user credential with the necessary snapshot/blueprint permissions. Session API uses v3. Configure `organizationId` and optionally `createAsUserId` when the service user is authorized to start work as that user; otherwise the credential principal is the execution principal. The returned organization/user is checked where available.

Approve `allowSharedEnvironment` only after reviewing all repositories and secrets exposed by the organization's composed snapshot. `approvedRepositories` must contain the actual repository set. This version creates a missing repo Blueprint and explicitly requests one build; it **does not overwrite/adopt existing or externally changed shared Blueprints automatically**. Such changes pause for manual review. `partial` or unknown public build statuses are not guessed successful; the public API's successful build is still only LAUNCHABLE and the cloud instruction verifies its repository/commit/dependencies.

### Billing

Existing subscriptions are not transferable credits. Provider API keys select the destination's own billing/principal. Environment setup and execution can consume usage. Configure hard limits in the provider dashboard. Offload does not buy credits, switch billing accounts, or claim that prompt budget text enforces a hard cap.

## Recovery

`status` performs only the supported read. `resume` continues the same job. Cursor can reconcile a lost task-create response via its saved client-supplied agent ID. Other uncertain writes intentionally pause and require actual remote inspection; deleting local operation records to "fix" an error is unsafe. No process continues local monitoring once the invoking host exits.
