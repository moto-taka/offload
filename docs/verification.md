# Verification — v0.1.1

Date: 2026-10-09

## Runtime target

Node.js 26.x (`>=26.0.0 <27.0.0`). `.nvmrc` and `.node-version` select `26`. The CI test matrix covers `26.0.0` and the latest `26`, and the skills CLI install job reads `.node-version`.

## Local regression checks

- Syntax, JSON, skill metadata, and 100 local tests passed.
- The local runtime was Node.js v22.16.0 with npm 10.9.2. These checks are separate from the Node.js 26 CI verification below.
- No real provider Cloud environment, account, or billed task was used by these tests.

## GitHub Actions: verified

Implementation commit: `cc18aabc7aacd1405abcf6cea4dcf9678378f0f5`.

Workflow: [verify, run 37935189501](https://github.com/moto-taka/offload/actions/runs/37935189501).

GitHub reported all three jobs completed successfully on 2026-10-09:

| Job | Verified result |
| --- | --- |
| `test (26.0.0)` | `npm run verify` passed on the minimum supported Node.js 26 release. |
| `test (26)` | `npm run verify` passed on the Node.js 26 version selected by setup-node. |
| `skills-install` | The real `skills` CLI installed the skill from the checked-out source; the copied runtime's `doctor` and example Plan/Recipe validation commands passed. |

The install job uses `npx --yes skills@latest add "$GITHUB_WORKSPACE" --skill offload --agent codex --copy --yes`. This verifies installation from the checkout, not a separate fetch using the GitHub shorthand and not indexing on the skills.sh website.

## Publication verification

All 35 source files, including their Git blob SHAs and modes, were compared with the tested source. The complete implementation tree was `b677e9fae6c7900f39d64b1ac43c7f16e295928f`. The implementation commit was pushed to `moto-taka/offload` main using a non-forced, expected-head update, and the resulting main ref was read back.

This document update records the completed CI run; it does not change the tested runtime or skill.

## Remaining verification

- Real-provider login, environment creation/reuse, task submission, and result collection have not been E2E-tested against a user's Cloud account.
- The new Codex adapter needs the calling host's connected browser tool; a browser implementation is not bundled.
- Direct installation using `npx skills add moto-taka/offload --skill offload` and skills.sh catalog indexing were not separately verified here. The supported GitHub-source layout and the actual CLI checkout-install test are present.

A source push or successful skill installation does not establish that provider Cloud execution has been verified. Adapters remain opt-in and must be configured for the intended account and repository.
