import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, repoFixture, sample, shellGit, gitNetworkShim, temp } from './helpers.mjs';
import { capture, readCapturedFile, publishSnapshot, checkoutSnapshot, repositoryInfo, validateLinks } from '../skills/offload/scripts/lib/git.mjs';
import { Core } from '../skills/offload/scripts/lib/core.mjs';
import { Store } from '../skills/offload/scripts/lib/store.mjs';
import { inspectClaude, claudeEnvironment } from '../skills/offload/scripts/lib/claude-auth.mjs';
import { runtimeStatus, requireRuntime } from '../skills/offload/scripts/lib/runtime.mjs';

function skillLinks(f) {
  fs.mkdirSync(path.join(f.repo, '.agents/skills/shared'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.agents/skills/shared/SKILL.md'), '# Shared skill\n');
  fs.mkdirSync(path.join(f.repo, '.claude/skills'), { recursive: true });
  for (let i=0;i<18;i++) fs.symlinkSync('../../.agents/skills/shared', path.join(f.repo, `.claude/skills/skill-${i}`));
  for (const dir of ['backend/.claude/skills','backend/.agents/skills']) {
    fs.mkdirSync(path.join(f.repo, dir), { recursive: true });
    for (let i=0;i<2;i++) fs.symlinkSync('../../../.agents/skills/shared', path.join(f.repo, dir, `skill-${i}`));
  }
  shellGit(f.repo, 'add', '.');
}

test('22 tracked skill symlinks are preserved, not dereferenced or removed', () => {
  const f=repoFixture();
  try {
    skillLinks(f); const before=shellGit(f.repo,'write-tree'), m=capture(f.repo);
    assert.equal(m.files.filter(x=>x.mode==='120000').length,22);
    assert.equal(m.files.find(x=>x.path==='.claude/skills/skill-0').linkTarget,'../../.agents/skills/shared');
    assert.equal(m.files.some(x=>x.path==='.claude/skills/skill-0/SKILL.md'),false);
    assert.equal(shellGit(f.repo,'write-tree'),before);
    assert.ok(m.files.every(x=>!('data' in x)));
  } finally { f.cleanup(); }
});

test('60 MiB repository with 22 links survives capture, durable metadata and a Git snapshot round trip', () => {
  const f=repoFixture(), restore=gitNetworkShim(f), store=new Store(path.join(f.base,'state'));
  try {
    skillLinks(f);
    for(let i=0;i<6;i++)fs.writeFileSync(path.join(f.repo,`asset-${i}.bin`),Buffer.alloc(10*1024*1024,i));
    shellGit(f.repo,'add','.');
    const index=shellGit(f.repo,'write-tree'),head=shellGit(f.repo,'rev-parse','HEAD');
    const m=capture(f.repo),job={id:'ofl_33333333-3333-3333-3333-333333333333'};
    assert.ok(m.totalBytes>57*1024*1024);
    assert.ok(Buffer.byteLength(JSON.stringify(m))<100_000);
    store.artifact(job.id,'manifest.json',m);
    const saved=store.read(job.id,'manifest.json');
    const snapshot=publishSnapshot(store,job,saved,{allowSnapshotPush:true});
    const tree=shellGit(f.bare,'ls-tree','-r',snapshot.commit);
    assert.equal(tree.split('\n').filter(x=>x.startsWith('120000 ')).length,22);
    assert.equal(shellGit(f.bare,'show',`${snapshot.commit}:.claude/skills/skill-0`),'../../.agents/skills/shared');
    assert.equal(+shellGit(f.bare,'cat-file','-s',`${snapshot.commit}:asset-5.bin`),10*1024*1024);
    const clone=checkoutSnapshot(store,saved,snapshot);
    assert.equal(fs.readlinkSync(path.join(clone,'.claude/skills/skill-0')),'../../.agents/skills/shared');
    fs.rmSync(clone,{recursive:true});
    assert.equal(shellGit(f.repo,'write-tree'),index);
    assert.equal(shellGit(f.repo,'rev-parse','HEAD'),head);
  } finally { store.close();restore();f.cleanup(); }
});

for(const [name,target,expected] of [
  ['absolute','/etc/passwd','UNSAFE_SYMLINK'],
  ['escaping','../outside','UNSAFE_SYMLINK'],
  ['credential','.env','UNSAFE_SYMLINK'],
  ['Git metadata','.git/config','UNSAFE_SYMLINK'],
  ['dangling','missing','UNRESOLVED_SYMLINK'],
  ['control character','index.js\n','UNSAFE_SYMLINK'],
])test(`${name} links still block without reading target data`,()=>{
  const f=repoFixture();
  try { fs.symlinkSync(target,path.join(f.repo,'alias'));shellGit(f.repo,'add','alias');assert.throws(()=>capture(f.repo),{code:expected}); }
  finally { f.cleanup(); }
});

test('relative file links and chained directory links resolve inside the exported tree',()=>{
  const f=repoFixture();
  try {
    skillLinks(f);fs.symlinkSync('.claude/skills/skill-0',path.join(f.repo,'alias'));
    fs.symlinkSync('index.js',path.join(f.repo,'index-alias'));
    const m=capture(f.repo);assert.equal(m.files.filter(x=>x.mode==='120000').length,24);
  } finally { f.cleanup(); }
});

test('symlink cycles and recursive ancestor directory links are rejected',()=>{
  assert.throws(()=>validateLinks([{path:'a',mode:'120000',linkTarget:'b'},{path:'b',mode:'120000',linkTarget:'a'}]),{code:'UNSAFE_SYMLINK'});
  assert.throws(()=>validateLinks([{path:'dir/file',mode:'100644'},{path:'dir/back',mode:'120000',linkTarget:'..'}]),{code:'UNSAFE_SYMLINK'});
});

test('an ignored local target is not silently copied into the snapshot',()=>{
  const f=repoFixture();
  try {fs.writeFileSync(path.join(f.repo,'.gitignore'),'ignored/\n');fs.mkdirSync(path.join(f.repo,'ignored'));fs.writeFileSync(path.join(f.repo,'ignored/file'),'not exportable');fs.symlinkSync('ignored',path.join(f.repo,'alias'));assert.throws(()=>capture(f.repo),{code:'UNRESOLVED_SYMLINK'});}
  finally {f.cleanup();}
});

test('metadata-only capture verifies a file again before use',()=>{
  const f=repoFixture();
  try {const m=capture(f.repo),file=m.files.find(x=>x.path==='index.js');fs.writeFileSync(path.join(f.repo,'index.js'),'changed');assert.throws(()=>readCapturedFile(m,file),{code:'SOURCE_CHANGED'});}
  finally {f.cleanup();}
});

test('legacy inline captured bytes can still be read after upgrade',()=>{
  const f=repoFixture();
  try {const m=capture(f.repo),file=m.files.find(x=>x.path==='index.js');const data=readCapturedFile(m,file);assert.deepEqual(readCapturedFile(m,{...file,data:data.toString('base64')}),data);}
  finally {f.cleanup();}
});

test('setup identity inspection does not depend on exportability',()=>{
  const f=repoFixture();
  try {fs.symlinkSync('/etc/passwd',path.join(f.repo,'bad'));shellGit(f.repo,'add','bad');assert.equal(repositoryInfo(f.repo).repository,'example/fixture');assert.throws(()=>capture(f.repo),{code:'UNSAFE_SYMLINK'});}
  finally {f.cleanup();}
});

test('Plan is durable before any Git inspection, even in a non-Git directory',async()=>{
  const folder=temp(),c=new Core(path.join(folder,'state'));fs.mkdirSync(path.join(folder,'not-a-repo'));
  try {const j=await c.savePlan({plan:sample(),repo:path.join(folder,'not-a-repo'),target:'claude'});assert.equal(j.state,'PLAN_READY');assert.ok(fs.existsSync(j.planPath));assert.equal(fs.existsSync(c.store.file(j.id,'manifest.json')),false);const r=await c.prepareSaved(j.id);assert.ok(r.error);assert.ok(fs.existsSync(j.planPath));}
  finally {c.close();fs.rmSync(folder,{recursive:true});}
});

test('blocked capture retains the Plan and can re-prepare the same job after the blocker is resolved',async()=>{
  const f=repoFixture(),c=new Core(path.join(f.base,'state'));
  try {fs.symlinkSync('/etc/passwd',path.join(f.repo,'bad'));const j=await c.prepare({plan:sample(),repo:f.repo,target:'claude'});assert.equal(j.state,'UNSAFE_SYMLINK');const before=fs.readFileSync(j.planPath,'utf8');fs.unlinkSync(path.join(f.repo,'bad'));const r=await c.prepareSaved(j.id);assert.equal(r.id,j.id);assert.equal(r.state,'NEEDS_SETUP');assert.equal(fs.readFileSync(j.planPath,'utf8'),before);}
  finally {c.close();f.cleanup();}
});

test('a malformed trusted config cannot discard the Plan',async()=>{
  const f=repoFixture(),c=new Core(path.join(f.base,'state'));
  try {fs.writeFileSync(path.join(c.store.root,'config.json'),'{',{mode:0o600});const r=await c.savePlan({plan:sample(),repo:f.repo,target:'claude'});assert.equal(r.state,'INVALID_JSON');assert.ok(fs.existsSync(r.planPath));}
  finally {c.close();f.cleanup();}
});

test('save-plan is safe on the recovery runtime and never requires a successful inspect',()=>{
  const f=repoFixture();
  try {fs.symlinkSync('/etc/passwd',path.join(f.repo,'bad'));const r=spawnSync(process.execPath,[path.join(root,'skills/offload/scripts/offload.mjs'),'save-plan','--plan',path.join(root,'skills/offload/examples/work-plan.example.json'),'--repo',f.repo,'--target','claude'],{encoding:'utf8',env:{...process.env,OFFLOAD_HOME:path.join(f.base,'state')}});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).state,'PLAN_READY');}
  finally {f.cleanup();}
});

for(const version of ['22.16.0','24.18.0','27.0.0'])test(`runtime diagnostic rejects ${version} for execution`,()=>{
  assert.equal(runtimeStatus(version).supported,false);assert.throws(()=>requireRuntime(version),{code:'NODE_VERSION_UNSUPPORTED'});
});
test('runtime diagnostic accepts Node 26 without changing the app runtime',()=>{assert.equal(runtimeStatus('26.0.0').supported,true);assert.equal(runtimeStatus('26.9.1').supported,true);});

function authRunner(auth) {return (_binary,args)=>args[0]==='--version'?'2.1.224 (Claude Code)':JSON.stringify(auth);}
for(const method of ['claude.ai','oauth'])test(`Claude auth accepts ${method} subscription status`,()=>{
  const r=inspectClaude({cliPath:process.execPath,expectedPrincipal:'person@example.invalid'},temp(),authRunner({loggedIn:true,authMethod:method,apiProvider:'firstParty',email:'person@example.invalid'}));assert.equal(r.principal,'person@example.invalid');
});
for(const [label,auth,code] of [
  ['signed out',{loggedIn:false},'NEEDS_AUTH'],
  ['API key',{loggedIn:true,authMethod:'api_key',email:'person@example.invalid'},'UNSUPPORTED_AUTH'],
  ['third party',{loggedIn:true,authMethod:'claude.ai',apiProvider:'bedrock',email:'person@example.invalid'},'UNSUPPORTED_AUTH'],
  ['another account',{loggedIn:true,authMethod:'claude.ai',email:'other@example.invalid'},'ACCOUNT_MISMATCH'],
])test(`Claude auth diagnoses ${label}`,()=>{assert.throws(()=>inspectClaude({cliPath:process.execPath,expectedPrincipal:'person@example.invalid'},'/tmp',authRunner(auth)),{code});});

test('Claude environment keeps the normal login location but excludes API and nested-session overrides',()=>{
  const keys=['ANTHROPIC_API_KEY','CLAUDECODE','CLAUDE_CODE_SIMPLE','CLAUDE_CONFIG_DIR'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {process.env.ANTHROPIC_API_KEY='fixture';process.env.CLAUDECODE='1';process.env.CLAUDE_CODE_SIMPLE='1';process.env.CLAUDE_CONFIG_DIR='/tmp/claude-account';const e=claudeEnvironment();assert.equal(e.ANTHROPIC_API_KEY,undefined);assert.equal(e.CLAUDECODE,undefined);assert.equal(e.CLAUDE_CODE_SIMPLE,undefined);assert.equal(e.CLAUDE_CONFIG_DIR,'/tmp/claude-account');}
  finally {for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
});
