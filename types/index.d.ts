export type Provider = 'codex' | 'claude' | 'cursor' | 'devin';
export type Host = 'pi' | 'opencode' | 'codex' | 'claude' | 'claude-code' | 'cursor' | 'unknown';
export type EnvironmentState = 'BUILDING' | 'FAILED' | 'READY' | 'LAUNCHABLE';
export interface Receipt { provider: Provider; id: string; url: string | null; runId?: string; acceptedAt: string; resultVerdict: 'UNVERIFIED'; source?: 'host-browser-observation'; }
export interface JobSummary { id: string; state: string; provider: Provider | null; repository?: string; planHash: string; recipeHash?: string; manifestHash?: string; approvalHash?: string; dispatchHash?: string; accountLabel?: string; bindingId?: string; preview: boolean; receipt?: Receipt; error?: {code:string;message:string;details?:unknown}; }
export interface PrepareInput { plan: unknown; recipe?: unknown; repo?: string; host?: Host; target?: Provider; requestId?: string; preview?: boolean; }
export interface CoreContract { prepare(input: PrepareInput): Promise<JobSummary>; submit(id:string):Promise<JobSummary>; status(id?:string):Promise<JobSummary|JobSummary[]>; close():void; }
/** Runtime input validation uses the bundled JSON Schema; these declarations do not bypass it. */
