import { executable, run, requireThat, fail } from './safety.mjs';

export function claudeEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION)|^(?:ANTHROPIC_|CLAUDE_CODE_USE_|AWS_|GOOGLE_APPLICATION_CREDENTIALS)/i.test(key)) delete env[key];
  }
  // Nested Claude calls must only dispatch a cloud job, not inherit a local session.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SIMPLE;
  return env;
}

// Public, read-only CLI output only. Never read the CLI's credential files or keychain ourselves.
export function inspectClaude(binding = {}, root = process.cwd(), runFn = run) {
  const binary = executable(binding.cliPath || 'claude', root);
  const options = { env: claudeEnvironment() };
  const text = runFn(binary, ['--version'], options);
  const m = text.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  requireThat(m && (+m[1] > 2 || +m[1] === 2 && (+m[2] > 1 || +m[2] === 1 && +m[3] >= 224)),
    'CLI_VERSION_UNSUPPORTED', 'Update Claude Code to >=2.1.224 for the cloud dispatch interface.');
  let auth;
  try { auth = JSON.parse(runFn(binary, ['auth', 'status'], options)); }
  catch { fail('NEEDS_AUTH', 'Run claude auth login (or /login), then resume the saved offload job. No API key is required.'); }
  requireThat(auth.loggedIn === true, 'NEEDS_AUTH', 'Run claude auth login (or /login), then resume the saved job.');
  requireThat(['claude.ai', 'oauth'].includes(auth.authMethod) && (!auth.apiProvider || auth.apiProvider === 'firstParty'),
    'UNSUPPORTED_AUTH', 'Use the claude.ai subscription login, not an API key or third-party provider.');
  requireThat(typeof auth.email === 'string' && auth.email.length > 0 && auth.email.length <= 255,
    'AUTH_IDENTITY_UNAVAILABLE', 'The CLI did not return an account identity. Verify the login before enabling this binding.');
  if (binding.expectedPrincipal) requireThat(binding.expectedPrincipal === auth.email,
    'ACCOUNT_MISMATCH', 'The signed-in Claude account differs from the saved account.');
  return { binary, version: m[0], principal: auth.email, method: auth.authMethod };
}
