# New Codex Cloud: ChatGPT Setup and task dispatch

This is an executable skill workflow using the **calling agent's connected browser tool**, not a built-in browser binary. The CLI implements durable intents/observations, validates identities and receipts, and refuses duplicate clicks. It cannot independently attest that a host tool observation is truthful. Never substitute an invented tool reference or a static screenshot from another account.

If the host has no browser/computer tool, return NEEDS_UI_DRIVER and the saved job ID. No CLI/Legacy/API fallback. Use official chatgpt.com pages only. Authentication/consent and additional access require the user's actual action.

## Environment: delegate to ChatGPT Setup

1. Call `node "<skill>/scripts/offload.mjs" ui-begin "<job-id>" environment` **before** creating, modifying or publishing anything. It returns the expected account/repository/recipe hash, nonce and setup-instruction path.
2. If `reconcileOnly: true`, inspect for the previous operation. **Do not create or Publish again.** If unable to determine outcome, leave it unknown and report the blocker.
3. Open **https://chatgpt.com/settings/codex-cloud** using the connected host. Execute the `onboarding.prompt` returned by `ui-begin` (also saved in `environment-setup.md`):

   > Cloud Environment Onboarding: Setup を使って、https://github.com/\<owner\>/\<repo\> のクラウド環境をセットアップしてください。未認証の場合は、ログインを求めてください。

   This delegates provisioning to **Cloud Environment Onboarding: Setup** in ChatGPT. Do not reproduce the Create environment / install / Publish sequence yourself, pass a private API request, or run another local coding CLI. Pass the approved repository; do not silently change the account or scope. An already matching environment can be reused instead of creating a duplicate.
4. If signed out, **ask the user to log in on the official page**. Keep the job and Plan. Do not request credentials in chat or pretend that Setup ran. If the named Setup workflow is unavailable, preserve the job and report the unavailable workflow instead of inventing its result or using Legacy. When Setup finishes, use its actual result to identify the intended account/repository/environment and its readiness; the remaining observation check is not a second provisioning workflow.
5. Record an observation JSON outside the project. Values below are field descriptions, not real identifiers:

```json
{
  "nonce": "<nonce from ui-begin>",
  "account": "<exact configured account label verified in UI>",
  "repository": "owner/repo",
  "flavor": "codex_new_ui",
  "recipeHash": "<saved fingerprint>",
  "environmentId": "<observed environment identifier>",
  "url": "<actual official URL>",
  "published": true,
  "personal": true,
  "validation": "passed",
  "evidenceRefs": ["<actual host browser observation reference>"]
}
```

6. `node "<skill>/scripts/offload.mjs" ui-record "<job-id>" environment --evidence "<observations.json>"`. If an identifier or state cannot be observed, do not make it up to pass validation. Save the blocker.

Reusing an already published environment is allowed after inspecting the same account, repo, recipe and current readiness; do not recreate it for each job.

## Login and resume

Record a login blocker through the same environment observation command. A signed-out page cannot prove an account or environment ID, so those success fields are not required here:

```json
{
  "nonce": "<nonce from ui-begin>",
  "status": "NEEDS_AUTH",
  "url": "https://chatgpt.com/settings/codex-cloud",
  "setupStarted": false,
  "evidenceRefs": ["<actual host observation of the login screen>"]
}
```

Use `setupStarted: false` **only when login blocked the flow before the Setup instruction was sent**. After login, call `ui-begin` again for the same job; this permits that unsent attempt to start with a new nonce. The saved Plan, account/repository binding and approvals remain in place. Re-check the intended account after login. Do not ask the user to supply an environment ID manually.

If Setup was already started, use `setupStarted: true`; omit it if unknown. After login, resume the existing Setup interaction or inspect its result. `ui-begin` returns `reconcileOnly: true` and must not launch another Setup. `resume`/`submit` retains `NEEDS_AUTH` until the host handles this step. Successful Setup is recorded with the normal environment evidence above, then task dispatch continues below. Authentication alone is never a successful environment or task receipt.

## Task dispatch

1. Call `node "<skill>/scripts/offload.mjs" ui-begin "<job-id>" task`. This first creates the approved Git snapshot outside the original worktree and verifies its remote ref. It records the send intent and returns the `dispatch.md` path.
2. If `reconcileOnly: true`, inspect the existing chat/task for OFFLOAD_JOB and the Plan hash. Do not press Send again. If no definitive result can be established, keep the saved unknown operation.
3. Start a **new** task in the exact saved Cloud environment. Confirm provider/account/environment before pasting the complete dispatch artifact. Do not paste into the environment-setup chat or a local chat.
4. Select the approved ref if the UI offers it. Otherwise the reviewed prompt-based gate must be enabled; the supplied dispatch explicitly verifies/fetches that ref before source edits.
5. Send once. Observe actual task acceptance and its URL/identifier. Record a task observation with the common fields above plus:

```json
{
  "nonce": "<task-stage nonce>",
  "commit": "<saved snapshot commit>",
  "dispatchHash": "<hash from saved job review/status>",
  "taskId": "<observed accepted task ID>",
  "accepted": true,
  "url": "<observed official task URL>"
}
```

The task-stage observation also requires the saved environmentId, account, repository, recipeHash, flavor and evidenceRefs. `commit` here identifies the dispatched code contract; it does not claim the remote agent has already checked it.

6. `node "<skill>/scripts/offload.mjs" ui-record "<job-id>" task --evidence "<observations.json>"`. Return the saved receipt. Actual remote commit/health/test evidence is a later observation, not inferred from acceptance.

## UI changes

Use visible semantic elements and verify pre/postconditions, not fixed screen coordinates. A modal, navigation change, missing environment, ambiguous ID, or lost response is a stop/reconcile condition. Do not extract session cookies, replay private endpoints, or broaden permissions to work around the UI.
