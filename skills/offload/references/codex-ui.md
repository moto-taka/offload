# New Codex Cloud: host-browser execution protocol

This is an executable skill workflow using the **calling agent's connected browser tool**, not a built-in browser binary. The CLI implements durable intents/observations, validates identities and receipts, and refuses duplicate clicks. It cannot independently attest that a host tool observation is truthful. Never substitute an invented tool reference or a static screenshot from another account.

If the host has no browser/computer tool, return NEEDS_UI_DRIVER and the saved job ID. No CLI/Legacy/API fallback. Use official chatgpt.com pages only. Authentication/consent and additional access require the user's actual action.

## Environment

1. Call `node "<skill>/scripts/offload.mjs" ui-begin "<job-id>" environment` **before** creating, modifying or publishing anything. It returns the expected account/repository/recipe hash, nonce and setup-instruction path.
2. If `reconcileOnly: true`, inspect for the previous operation. **Do not create or Publish again.** If unable to determine outcome, leave it unknown and report the blocker.
3. Inspect the official UI and account. Select Work in > Cloud. Find the exact personal environment for the approved repository/recipe, or create one only if the reviewed binding allows it. Confirm this is new Codex Cloud, not Legacy.
4. For a new environment, select the repo, submit the saved `environment-setup.md`, let Codex prepare tools/dependencies, inspect actual readiness results, and Publish once. Stop at login, secret requirements, a shared environment, unexpected additional repo/access, failed readiness or contradictory UI.
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
