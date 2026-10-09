import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sample,recipeSample,temp,repoFixture,gitNetworkShim,shellGit,root} from './helpers.mjs';
import {validatePlan,validateRecipe,recipeHash,cursorEnvironment,devinBlueprint,assertSchema} from '../skills/offload/scripts/lib/plan.mjs';
import {parseOffload,newBinding,validateConfig,saveConfig,resolveTarget} from '../skills/offload/scripts/lib/config.mjs';
import {digest,scanSecrets,repository,relativePath,officialUrl,saveJson} from '../skills/offload/scripts/lib/safety.mjs';
import {Store} from '../skills/offload/scripts/lib/store.mjs';
import {Core} from '../skills/offload/scripts/lib/core.mjs';
import {capture,verifyCapture,inspectRecipe,publishSnapshot,checkoutSnapshot} from '../skills/offload/scripts/lib/git.mjs';
import {parseCLI,installHost} from '../skills/offload/scripts/offload.mjs';

const throwsCode=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('valid WorkPlan and environment recipe',()=>{validatePlan(sample());validateRecipe(recipeSample());});
for(const [name,mutate,code] of [
 ['duplicate IDs',p=>p.evidence.push({...p.evidence[0]}),'DUPLICATE_ID'],
 ['missing evidence',p=>p.requirements[0].evidence_refs=['E404'],'BROKEN_REFERENCE'],
 ['cycle',p=>p.tasks[0].depends_on=['T3'],'CYCLIC_PLAN'],
 ['unsupported success claim',p=>p.current_state[0].verification='tool_verified','UNSUPPORTED_CLAIM'],
 ['partial coverage missing limits',p=>p.coverage.limitations=[],'MISSING_COVERAGE'],
 ['invalid next action',p=>p.next_action.task_id='T404','BROKEN_REFERENCE'],
 ['unapproved extra field',p=>p.authorized=true,'INVALID_DOCUMENT'],
 ['path traversal',p=>p.tasks[0].file_hints=['../private.txt'],'UNSAFE_PATH'],
 ['uncovered requirement',p=>p.requirements.push({id:'R3',text:'new',evidence_refs:['E1']}),'UNCOVERED_REQUIREMENT'],
 ['oversized plan',p=>p.objective='x'.repeat(50000),'PLAN_TOO_LARGE'],
])test(`plan rejects ${name}`,()=>{const p=sample();mutate(p);throwsCode(()=>validatePlan(p),code);});
test('schema validator rejects unsupported keywords rather than ignoring them',()=>throwsCode(()=>assertSchema({}, {oneOf:[]}),'SCHEMA_UNSUPPORTED'));
for(const target of ['codex','claude','cursor','devin'])test(`offload target ${target}`,()=>assert.equal(parseOffload(`/offload ${target}`).target,target));
for(const command of ['/offload --local','/offload codex --local','/offload --unknown'])test(`rejects ${command}`,()=>throwsCode(()=>parseOffload(command),'INVALID_OPTION'));
test('Pi is not a destination',()=>throwsCode(()=>parseOffload('/offload pi'),'INVALID_TARGET'));
test('cannot dispatch to two clouds',()=>throwsCode(()=>parseOffload('/offload codex cursor'),'MULTIPLE_TARGETS'));
test('free text after separator is not parsed as flags',()=>assert.equal(parseOffload('/offload claude -- investigate --local').instruction,'investigate --local'));
test('preview parsed',()=>assert.equal(parseOffload('/offload --preview').preview,true));
test('source tool not model chooses implicit target',()=>{assert.equal(resolveTarget('cursor',null,{defaults:{}}),'cursor');throwsCode(()=>resolveTarget('pi',null,{defaults:{}}),'NEEDS_TARGET');assert.equal(resolveTarget('pi',null,{defaults:{pi:'claude'}}),'claude');});
test('setup/status command shapes',()=>{assert.equal(parseOffload('setup claude').action,'setup');assert.equal(parseOffload('status').jobId,null);throwsCode(()=>parseOffload('status x y'),'INVALID_COMMAND');});
test('CLI refuses duplicate/unknown flags',()=>{throwsCode(()=>parseCLI(['prepare','--local']),'INVALID_OPTION');throwsCode(()=>parseCLI(['prepare','--plan','x','--plan','y']),'INVALID_OPTION');});
for(const input of ['git@github.com:Example/Fixture.git','https://github.com/Example/Fixture','ssh://git@github.com/Example/Fixture.git'])test(`canonical remote ${input}`,()=>assert.equal(repository(input),'example/fixture'));
for(const input of ['https://user:secret@github.com/example/repo','https://github.com.evil.test/a/b','file:///tmp/repo','https://github.com/a/b/../c'])test(`rejects remote ${input}`,()=>throwsCode(()=>repository(input),'REPOSITORY_UNSUPPORTED'));
for(const input of ['../secret','/absolute','x/../y','x\\y','.git/config','x\u0000z'])test(`safe path ${JSON.stringify(input)}`,()=>throwsCode(()=>relativePath(input),'UNSAFE_PATH'));
test('credentials are detected without value in error',()=>{const secret='gh'+'p_'+'a'.repeat(30);try{scanSecrets(secret,'fixture');assert.fail();}catch(e){assert.equal(e.code,'SECRET_DETECTED');assert.ok(!JSON.stringify(e).includes(secret));}});
test('malicious receipt host rejected',()=>throwsCode(()=>officialUrl('https://cursor.com.evil.test/agents/1','cursor'),'INVALID_RECEIPT'));
test('receipt with credentials rejected',()=>throwsCode(()=>officialUrl('https://user:pass@cursor.com/agents/1','cursor'),'INVALID_RECEIPT'));
test('config forbids arbitrary URLs and execution flavors',()=>{const b=newBinding('codex','example/fixture');b.baseUrl='https://evil.test';throwsCode(()=>validateConfig({version:1,defaults:{},bindings:[b]}),'BAD_CONFIG');delete b.baseUrl;b.flavor='legacy';throwsCode(()=>validateConfig({version:1,defaults:{},bindings:[b]}),'BAD_CONFIG');});
test('config preserves disabled defaults',()=>assert.equal(validateConfig({version:1,defaults:{},bindings:[newBinding('cursor','example/fixture')]}).bindings[0].enabled,false));
test('recipe excludes VPN/private services',()=>{const r=recipeSample();r.public_network_requirements=[{hostname:'127.0.0.1',purpose:'bad'}];throwsCode(()=>validateRecipe(r),'PRIVATE_NETWORK_OUT_OF_SCOPE');});
test('environment renderer uses documented YAML and separates starts',()=>{const r=recipeSample();const c=cursorEnvironment(r);assert.match(c.install,/frozen-lockfile/);assert.equal(c.start,undefined);const y=devinBlueprint(r);assert.match(y,/^maintenance: \|/);assert.match(y,/contents: \|/);assert.ok(!y.includes('version: 1'));});
test('environment fingerprint ignores code-only changes, includes locks',()=>{const r=recipeSample(),files=r.source_refs.map(p=>({path:p,hash:digest(p)}));const h=recipeHash(r,files);r.source_commit='b'.repeat(40);assert.equal(recipeHash(r,files),h);files[0].hash=digest('changed');assert.notEqual(recipeHash(r,files),h);});
test('store write intent is durable and refuses uncertain retries',async()=>{const dir=temp();let s=new Store(dir);s.startOperation('write',{x:1});s.close();s=new Store(dir);throwsCode(()=>s.startOperation('write',{x:1}),'SUBMISSION_UNKNOWN');throwsCode(()=>s.startOperation('write',{x:2}),'OPERATION_CHANGED');s.finishOperation('write',{id:'remote'});assert.deepEqual(s.startOperation('write',{x:1}).result,{id:'remote'});s.close();fs.rmSync(dir,{recursive:true});});
test('definitive rejection permits same-operation retry',async()=>{const dir=temp(),s=new Store(dir);let calls=0;await assert.rejects(()=>s.once('w',{},async()=>{calls++;const e=Error();e.definitelyNotAccepted=true;throw e;}));await s.once('w',{},async()=>{calls++;return{id:'ok'};});assert.equal(calls,2);s.close();fs.rmSync(dir,{recursive:true});});
test('concurrent live lease cannot be stolen',async()=>{const dir=temp(),s=new Store(dir),other=new Store(dir);await s.locked('x',async()=>{await assert.rejects(()=>other.locked('x',async()=>{}),e=>e.code==='BUSY');});s.close();other.close();fs.rmSync(dir,{recursive:true});});
test('Git capture includes dirty/untracked and detects change',()=>{const f=repoFixture();try{fs.writeFileSync(path.join(f.repo,'new.js'),'export {};');const m=capture(f.repo);assert.ok(m.files.some(x=>x.path==='new.js'&&x.untracked));assert.ok(inspectRecipe(m).recipe);fs.appendFileSync(path.join(f.repo,'index.js'),'// edit');throwsCode(()=>verifyCapture(m),'SOURCE_CHANGED');}finally{f.cleanup();}});
for(const [name,create,code] of [
 ['tracked secret',f=>{fs.writeFileSync(path.join(f.repo,'.env'),'X=example');shellGit(f.repo,'add','.env');},'SECRET_FILE'],
 ['untracked private key',f=>fs.writeFileSync(path.join(f.repo,'id_rsa'),'placeholder'),'SECRET_FILE'],
 ['symlink',f=>{fs.symlinkSync('/etc/passwd',path.join(f.repo,'link'));shellGit(f.repo,'add','link');},'UNSUPPORTED_FILE'],
 ['untracked secret content',f=>fs.writeFileSync(path.join(f.repo,'test.js'),'const x="'+'gh'+'p_'+'b'.repeat(30)+'";'),'SECRET_DETECTED'],
])test(`Git blocks ${name}`,()=>{const f=repoFixture();try{create(f);throwsCode(()=>capture(f.repo),code);}finally{f.cleanup();}});
test('snapshot publishes exact tree without modifying original staging/branch',()=>{const f=repoFixture(),restore=gitNetworkShim(f),s=new Store(path.join(f.base,'state'));try{fs.writeFileSync(path.join(f.repo,'index.js'),'staged\n');shellGit(f.repo,'add','index.js');fs.writeFileSync(path.join(f.repo,'index.js'),'working\n');fs.writeFileSync(path.join(f.repo,'new.txt'),'new');const before=shellGit(f.repo,'status','--porcelain=v1'),index=shellGit(f.repo,'write-tree'),head=shellGit(f.repo,'rev-parse','HEAD'),m=capture(f.repo),job={id:'ofl_11111111-1111-1111-1111-111111111111'};const snap=publishSnapshot(s,job,m,{allowSnapshotPush:true});assert.equal(shellGit(f.bare,'show',snap.commit+':index.js'),'working');assert.equal(shellGit(f.bare,'show',snap.commit+':new.txt'),'new');assert.equal(shellGit(f.repo,'status','--porcelain=v1'),before);assert.equal(shellGit(f.repo,'write-tree'),index);assert.equal(shellGit(f.repo,'rev-parse','HEAD'),head);job.snapshot=snap;assert.deepEqual(publishSnapshot(s,job,m,{allowSnapshotPush:true}),snap);const checkout=checkoutSnapshot(s,m,snap);assert.equal(shellGit(checkout,'rev-parse','HEAD'),snap.commit);fs.rmSync(checkout,{recursive:true});}finally{s.close();restore();f.cleanup();}});
test('prepare preview makes no remote writes and cannot submit',async()=>{const f=repoFixture(),c=new Core(path.join(f.base,'state'),{fetchFn:()=>assert.fail('network in preview')});try{const p=sample(),r=await c.prepare({plan:p,repo:f.repo,host:'pi',target:'cursor',preview:true});assert.equal(r.state,'PREVIEW_READY');const again=await c.prepare({plan:p,repo:f.repo,host:'pi',target:'cursor',preview:true});assert.equal(again.id,r.id);const b=newBinding('cursor','example/fixture');Object.assign(b,{enabled:true,accountLabel:'test'});saveConfig(c.store.root,{version:1,defaults:{},bindings:[b]});const out=await c.submit(r.id);assert.equal(out.state,'PREVIEW_ONLY');}finally{c.close();f.cleanup();}});
test('missing setup retains plan and can later resume same job',async()=>{const f=repoFixture(),c=new Core(path.join(f.base,'state'));try{const r=await c.prepare({plan:sample(),repo:f.repo,target:'codex'});assert.equal(r.state,'NEEDS_SETUP');assert.ok(fs.existsSync(c.store.file(r.id,'plan.json')));const b=newBinding('codex','example/fixture');Object.assign(b,{enabled:true,accountLabel:'test'});saveConfig(c.store.root,{version:1,defaults:{},bindings:[b]});const next=await c.submit(r.id);assert.equal(next.id,r.id);assert.equal(next.state,'NEEDS_APPROVAL');}finally{c.close();f.cleanup();}});
test('stored artifact tampering prevents submission',async()=>{const f=repoFixture(),c=new Core(path.join(f.base,'state'));try{const r=await c.prepare({plan:sample(),repo:f.repo,target:'codex'});const p=sample();p.objective='tampered';c.store.artifact(r.id,'plan.json',p);assert.equal((await c.submit(r.id)).state,'ARTIFACT_CHANGED');}finally{c.close();f.cleanup();}});
test('headless trust is never auto-approved',()=>{const f=temp();try{const p=spawnSync(process.execPath,[path.join(root,'skills/offload/scripts/offload.mjs'),'trust','ofl_11111111-1111-1111-1111-111111111111'],{encoding:'utf8',env:{...process.env,OFFLOAD_HOME:f}});assert.equal(p.status,2);assert.match(p.stderr,/HUMAN_APPROVAL_REQUIRED/);}finally{fs.rmSync(f,{recursive:true});}});
test('host installer is explicit/idempotent and does not overwrite conflicts',()=>{const home=temp();try{let r=installHost('pi',{scope:'global',home});assert.ok(fs.existsSync(r.file));assert.equal(installHost('pi',{scope:'global',home}).unchanged,true);fs.writeFileSync(r.file,'custom');throwsCode(()=>installHost('pi',{scope:'global',home}),'INSTALL_CONFLICT');assert.equal(fs.readFileSync(r.file,'utf8'),'custom');}finally{fs.rmSync(home,{recursive:true});}});
test('Pi command queues current-agent planning, not another local agent',async()=>{let command,prompt;const pi={registerCommand:(name,c)=>{assert.equal(name,'offload');command=c;},sendUserMessage:(p,o)=>{prompt=p;assert.equal(o.deliverAs,'followUp');}};const ext=(await import('../skills/offload/scripts/hosts/pi.mjs')).default;ext(pi);await command.handler('claude',{ui:{notify(){}}});assert.match(prompt,/Source host: pi/);assert.match(prompt,/"target":"claude"/);assert.match(prompt,/this conversation/i);});
