# Changelog

## 0.1.1 — 2026-10-09

- Target Node.js 26.x (`>=26.0.0 <27.0.0`) in package metadata, standalone skill requirements, and CLI help.
- Add `.nvmrc` and `.node-version` selecting Node.js 26.
- Test Node.js 26.0.0 and the latest 26.x in GitHub Actions; run the skills.sh installation check on 26.x.
- Update setup documentation and example environment recipes, and add regression checks for the runtime configuration.
- Node.js 26 is Current as of this date; its scheduled LTS transition is 2026-10-28. This release targets the 26 line before and after that transition, not the moving `lts/*` alias.

## 0.1.0

- Initial cloud-only Offload implementation and self-contained skill packaging.
- Provider adapters are contract-tested, not live-account E2E verified.
