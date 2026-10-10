# v0.1.3 — Real-repository recovery

Fixes the reported Claude `/offload` failure without deleting skill links, discarding the Plan, downgrading the requested Node 26 target or bypassing login/approval.

- Save the WorkPlan before Git capture. Resume the same saved job after setup; keep Plan paths on errors.
- Preserve repository-internal symlinks as Git 120000 entries. Block external/dangling/cyclic/credential targets.
- Remove the aggregate 20 MiB limit and base64 repository payloads; store metadata and recheck individual files before publication. A synthetic 60 MiB/22-link Git round-trip covers the report.
- Report Node version compatibility in doctor, enforce Node 26 for export/dispatch, and retain local-only Plan recovery commands on the older available runtime.
- Discover Claude identity using official read-only CLI output; accept claude.ai auth, return login-specific errors, and prefill setup. Keep user approval. Add user-only `trust --remember` for an exact repository/recipe policy.
- Remove `--bare` from subscription dispatch. Keep local settings/hooks/MCP isolation without disabling OAuth/keychain login.
- Preserve the v0.1.2 ChatGPT Cloud Environment Onboarding: Setup workflow and the other Cloud adapters.

## Verification scope

Local tests are run on the available Node.js 22.16 runtime for regression checking; the committed CI matrix checks Node.js 26.0.0 and the current 26 line. Check the GitHub Actions run for the actual commit, rather than reusing a previous version's CI status. Live provider Cloud execution and the user's Lerd conversion remain unverified.

See `skills/offload/references/troubleshooting.md` for executable recovery steps.
