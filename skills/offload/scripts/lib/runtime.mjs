import { requireThat } from './safety.mjs';
export function runtimeStatus(version = process.versions.node) {
  const supported = /^26\./.test(version);
  return { version, required: '>=26.0.0 <27.0.0', supported,
    ...(!supported ? { instruction: 'Use Node.js 26 for Offload only (for example: nvm install 26; nvm exec 26 node <offload-script> <command>). Do not change the application repository runtime or discard its Plan.' } : {}) };
}
export function requireRuntime(version = process.versions.node) {
  const status = runtimeStatus(version);
  requireThat(status.supported, 'NODE_VERSION_UNSUPPORTED', status.instruction, status);
}
