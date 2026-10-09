import { slug } from './safety.mjs';

export const CODEX_SETTINGS_URL = 'https://chatgpt.com/settings/codex-cloud';
export const CODEX_SETUP_SKILL = 'Cloud Environment Onboarding: Setup';

// A host-executed ChatGPT instruction, not a shell command or a private API.
// Environment provisioning is owned by ChatGPT's Setup workflow, not Offload.
export function codexOnboarding(repository) {
  const repo = slug(repository);
  return {
    url: CODEX_SETTINGS_URL,
    skill: CODEX_SETUP_SKILL,
    prompt: `${CODEX_SETUP_SKILL} を使って、https://github.com/${repo} のクラウド環境をセットアップしてください。未認証の場合は、ログインを求めてください。`,
  };
}

export function renderCodexOnboarding(repository) {
  const request = codexOnboarding(repository);
  return `${request.url} から、次の指示を実行してください。\n\n${request.prompt}\n`;
}
