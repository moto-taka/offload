# Primary sources

Consulted 2026-10-09. These support vendor interfaces, not a claim that this project's live integrations have passed. Beta APIs and account availability may differ. Recheck actual schemas on first setup.

- Agent Skills CLI and GitHub-source installation: https://github.com/vercel-labs/skills
- skills.sh CLI: https://skills.sh/docs/cli
- New Codex Cloud environments: https://learn.chatgpt.com/docs/environments/cloud-environments
- Claude CLI (auth status, bare mode): https://code.claude.com/docs/en/cli-reference
- Claude web/cloud dispatch: https://code.claude.com/docs/en/claude-code-on-the-web
- Claude environment/ref scripted dispatch: https://code.claude.com/docs/en/self-hosted-environments-testing (syntax only; self-hosted execution is excluded)
- Cursor Cloud Agents API: https://cursor.com/docs/cloud-agent/api/endpoints
- Cursor environment API on official production documentation: https://prod.cursor.com/docs/cloud-agent/api/endpoints
- Devin sessions v3: https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions
- Devin Blueprint creation: https://docs.devin.ai/api-reference/v3/snapshot-setup/post-organizations-blueprints
- Devin explicit build: https://docs.devin.ai/api-reference/v3/snapshot-setup/post-organizations-builds
- Devin Blueprint schema: https://docs.devin.ai/onboard-devin/environment/blueprint-reference
- Pi extension API: https://pi.dev/docs/latest/extensions
- OpenCode commands: https://opencode.ai/docs/commands/

The public Devin build response is opaque (build status, not per-repo/platform introspection). This version does not assume a rich `partial` result has been observed. Cursor environment docs and canonical pages can expose different sections; 404/403/schema mismatch is not treated as absence or permission to use a different billing service.
