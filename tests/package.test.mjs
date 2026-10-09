import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,temp,repoFixture,sample,gitNetworkShim,jsonResponse} from './helpers.mjs';
import {Core} from '../skills/offload/scripts/lib/core.mjs';
import {newBinding,saveConfig} from '../skills/offload/scripts/lib/config.mjs';
import {cursorEnvironment} from '../skills/offload/scripts/lib/plan.mjs';

test('skill metadata and self-contained resources are present',()=>{const s=fs.readFileSync(path.join(root,'skills/offload/SKILL.md'),'utf8');assert.match(s,/^---\nname: offload\n/);assert.match(s,/disable-model-invocation: true/);assert.match(s,/description:/);for(const m of s.matchAll(/\]\(([^)]+\.md)\)/g))assert.ok(fs.existsSync(path.join(root,'skills/offload',m[1])));});
test('copied skill runs without the repository or node_modules',()=>{const dir=temp();try{const copy=path.join(dir,'installed-offload');fs.cpSync(path.join(root,'skills/offload'),copy,{recursive:true});for(const args of [['doctor'],['validate','--plan',path.join(copy,'examples/work-plan.example.json'),'--recipe',path.join(copy,'examples/environment-recipe.example.json')]]){const r=spawnSync(process.execPath,[path.join(copy,'scripts/offload.mjs'),...args],{cwd:dir,encoding:'utf8',env:{...process.env,OFFLOAD_HOME:path.join(dir,'state')}});assert.equal(r.status,0,r.stderr);assert.doesNotThrow(()=>JSON.parse(r.stdout));}}finally{fs.rmSync(dir,{recursive:true});}});
test('Core fixture E2E prepares environment, exact snapshot, receipt and original-run result',async()=>{const f=repoFixture(),restore=gitNetworkShim(f);let environment,posts=0;const b=newBinding('cursor','example/fixture');Object.assign(b,{enabled:true,accountLabel:'fixture',expectedPrincipal:'person@example.invalid',credentialEnv:'T',allowExperimental:true,allowSnapshotPush:true,allowEnvironmentCreate:true,allowPromptGitGate:true});
 const c=new Core(path.join(f.base,'state'),{env:{T:'fixture'},fetchFn:async(url,init)=>{const endpoint=new URL(url).pathname;const data=init.body?JSON.parse(init.body):null;if(init.method==='POST')posts++;
 if(endpoint==='/v1/me')return jsonResponse({userId:1,userEmail:'person@example.invalid'});
 if(endpoint==='/v1/environments'&&init.method==='GET')return jsonResponse({items:environment?[environment]:[]});
 if(endpoint==='/v1/environments'&&init.method==='POST'){environment={...data,id:'env-e2e',updatedAt:'2026-10-09T00:00:00Z',versionId:'v1'};return jsonResponse(environment,201);}
 if(endpoint==='/v1/environments/env-e2e')return jsonResponse(environment);
 if(endpoint.endsWith('/builds'))return jsonResponse({items:[{id:'build-e2e',environmentId:'env-e2e',createdAt:'2026-10-09T00:01:00Z',status:'SUCCEEDED'}]});
 if(endpoint==='/v1/agents'&&init.method==='POST')return jsonResponse({agent:{id:data.agentId,env:data.env,url:'https://cursor.com/agents/'+data.agentId},run:{id:'run-e2e',agentId:data.agentId}});
 if(endpoint.includes('/runs/')){const id=endpoint.split('/')[3];return jsonResponse({id:'run-e2e',agentId:id,status:'FINISHED',result:'Fixture-only test result, not a real cloud execution.'});}throw Error(endpoint);
 }});
 try{saveConfig(c.store.root,{version:1,defaults:{pi:'cursor'},bindings:[b]});const prepared=await c.prepare({plan:sample(),repo:f.repo,host:'pi'});assert.equal(prepared.state,'NEEDS_APPROVAL');assert.equal(posts,0);c.approve(prepared.id,c.review(prepared.id).approvalHash);const sent=await c.submit(prepared.id);assert.equal(sent.state,'SUBMITTED',JSON.stringify(sent));assert.equal(sent.receipt.runId,'run-e2e');assert.equal(posts,2);assert.equal((await c.submit(prepared.id)).receipt.id,sent.receipt.id);assert.equal(posts,2);const status=await c.status(prepared.id);assert.equal(status.observation.remoteState,'FINISHED');assert.equal(status.observation.resultVerdict,'UNVERIFIED');}finally{c.close();restore();f.cleanup();}
});
test('receipt survives crash between operation completion and job save',async()=>{const f=repoFixture(),c=new Core(path.join(f.base,'state'));try{const p=await c.prepare({plan:sample(),repo:f.repo,target:'cursor'});const receipt={id:'agent-recovered',provider:'cursor',url:'https://cursor.com/agents/agent-recovered'};c.store.startOperation(p.id+':task',{prompt:'fixture'});c.store.finishOperation(p.id+':task',receipt);fs.appendFileSync(path.join(f.repo,'index.js'),'// changed after acceptance');const r=await c.submit(p.id);assert.equal(r.state,'SUBMITTED');assert.equal(r.receipt.id,receipt.id);}finally{c.close();f.cleanup();}});

test('symlink-installed runtime executes its main entrypoint',()=>{const dir=temp();try{fs.symlinkSync(path.join(root,'skills/offload'),path.join(dir,'skill'),'dir');const r=spawnSync(process.execPath,[path.join(dir,'skill/scripts/offload.mjs'),'doctor'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).liveVerified,false);}finally{fs.rmSync(dir,{recursive:true});}});


test('package support is explicitly bounded to Node.js 26',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.engines.node, '>=26.0.0 <27.0.0');
  assert.equal(pkg.version, '0.1.2');
});
test('Node version manager files both select the 26 release line',()=>{
  for(const file of ['.nvmrc','.node-version'])
    assert.equal(fs.readFileSync(path.join(root,file),'utf8').trim(),'26');
});
test('CI covers the Node 26 floor and newest patch, and installs the skill on Node 26',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
  assert.match(workflow,/node: \['26\.0\.0', '26'\]/);
  assert.match(workflow,/node-version-file: '\.node-version'/);
  assert.doesNotMatch(workflow,/22\.16\.0|node: \['24'/);
});
test('standalone skill and CLI describe the same Node requirement',()=>{
  const metadata=fs.readFileSync(path.join(root,'skills/offload/SKILL.md'),'utf8');
  assert.match(metadata,/Node\.js 26\.x/);
  const result=spawnSync(process.execPath,[path.join(root,'skills/offload/scripts/offload.mjs'),'help'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const help=JSON.parse(result.stdout);
  assert.equal(help.node,'>=26.0.0 <27.0.0');
  assert.equal(help.version,'0.1.2');
});
