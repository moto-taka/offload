import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='.git'||e.name==='node_modules'?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(root)){
 if(file.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1);}}
 if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'));
}
const skill=fs.readFileSync(path.join(root,'skills/offload/SKILL.md'),'utf8');if(!/^---\nname: offload\ndescription: .+/m.test(skill))throw Error('Invalid skill frontmatter');
console.log('All JavaScript parses, JSON files parse, and skill metadata is present.');
