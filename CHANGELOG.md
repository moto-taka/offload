# Changelog

## 0.1.2 — 2026-10-10

- Delegate new Codex environment setup to ChatGPT Settings → **Cloud Environment Onboarding: Setup** with a repository-specific prompt. Remove the duplicated Create/Install/Publish instructions and manual environment-ID question.
- Return the host-executable onboarding request from setup and environment intent. Preserve the Plan and ask for login on `NEEDS_AUTH`; retry only an observed unsent Setup and reconcile an already-started one.
- Keep task dispatch, account/repository checks, readiness observations, Node.js 26 and the other providers unchanged. Real ChatGPT Setup execution remains unverified.

## 0.1.1 — 2026-10-09

- Target Node.js 26.x (`>=26.0.0 <27.0.0`) in package metadata, standalone skill requirements, and CLI help.
- Add `.nvmrc` and `.node-version` selecting Node.js 26.
- Test Node.js 26.0.0 and the latest 26.x in GitHub Actions; run the skills.sh installation check on 26.x.
- Update setup documentation and example environment recipes, and add regression checks for the runtime configuration.
- Node.js 26 is Current as of this date; its scheduled LTS transition is 2026-10-28. This release targets the 26 line before and after that transition, not the moving `lts/*` alias.

## 0.1.0

- Initial cloud-only Offload implementation and self-contained skill packaging.
- Provider adapters are contract-tested, not live-account E2E verified.
