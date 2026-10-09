import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
export const root=path.resolve(import.meta.dirname,'..');
export const sample=()=>JSON.parse(fs.readFileSync(path.join(root,'skills/offload/examples/work-plan.example.json'),'utf8'));
export const recipeSample=()=>JSON.parse(fs.readFileSync(path.join(root,'skills/offload/examples/environment-recipe.example.json'),'utf8'));
export function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'offload-test-'));}
export function shellGit(dir,...args){const r=spawnSync('/usr/bin/git',['-c','core.hooksPath=/dev/null',...args],{cwd:dir,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
export function repoFixture(){
  const base=temp(),repo=path.join(base,'repo'),bare=path.join(base,'remote.git');fs.mkdirSync(repo);shellGit(base,'init','--bare',bare);shellGit(repo,'init','-b','main');
  fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',engines:{node:'26'},scripts:{test:'node --test'}}));
  fs.writeFileSync(path.join(repo,'package-lock.json'),JSON.stringify({name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0'}}}));
  fs.writeFileSync(path.join(repo,'index.js'),'export const value = 1;\n');
  shellGit(repo,'add','.');shellGit(repo,'commit','-m','initial');shellGit(repo,'push',bare,'main');shellGit(bare,'symbolic-ref','HEAD','refs/heads/main');shellGit(repo,'remote','add','origin','https://github.com/example/fixture.git');
  return{base,repo,bare,cleanup:()=>fs.rmSync(base,{recursive:true,force:true})};
}
export function gitNetworkShim(fixture){
  const bin=path.join(fixture.base,'bin');fs.mkdirSync(bin);
  const file=path.join(bin,'git');const code=`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');let args=process.argv.slice(2);args=args.map(a=>a==='https://github.com/example/fixture.git'?${JSON.stringify(fixture.bare)}:a); if(args.includes('fetch') && args.includes('origin')) {const o=spawnSync('/usr/bin/git',['remote','get-url','origin'],{encoding:'utf8'});if(o.stdout.trim()==='https://github.com/example/fixture.git')args=args.map(a=>a==='origin'?${JSON.stringify(fixture.bare)}:a);}const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);\n`;
  fs.writeFileSync(file,code,{mode:0o755});const old=process.env.PATH;process.env.PATH=bin+path.delimiter+old;return()=>{process.env.PATH=old;};
}
export function jsonResponse(value,status=200){return new Response(status===204?null:JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}
