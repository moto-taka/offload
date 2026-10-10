import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { validatePlan, validateRecipe, recipeHash, renderPlan, renderExecution, cursorEnvironment } from './plan.mjs';
import { loadConfig, resolveTarget, bindingFor, approvalHash } from './config.mjs';
import { capture, inspectRecipe, verifyCapture, publishSnapshot, readCapturedFile } from './git.mjs';
import { adapter } from './providers.mjs';
import { digest, makeId, inside, requireThat, fail, writePrivate, officialUrl, scanSecrets } from './safety.mjs';
import { remoteId } from './http.mjs';
import { codexOnboarding, renderCodexOnboarding, CODEX_SETTINGS_URL } from './codex-onboarding.mjs';

export function publicJob(j) {
  return { id:j.id, state:j.state, planPath:j.planPath, provider:j.provider, repository:j.repository, planHash:j.planHash, recipeHash:j.recipeHash, manifestHash:j.manifestHash, approvalHash:j.approvalHash, dispatchHash:j.dispatchHash, accountLabel:j.accountLabel, bindingId:j.bindingId, environment:j.environment, snapshot:j.snapshot, receipt:j.receipt, observation:j.observation, error:j.error, preview:j.preview };
}
export class Core {
  constructor(root,options={}) { this.store=new Store(root); this.options=options; }
  close(){this.store.close();}
  config(){return loadConfig(this.store.root);}
  // Phase 1 has no Git/export/auth preconditions: save the current conversation first.
  async savePlan({plan,recipe,repo=process.cwd(),host='unknown',target,requestId,preview=false}) {
    validatePlan(plan);
    const root=path.resolve(repo);
    requireThat(!inside(root,this.store.root),'UNSAFE_STATE','Runtime state must be outside the repository.');
    const key=digest({requestId:requestId||null,root,host,target:target||null,plan:digest(plan),preview});
    return this.store.locked(`request:${key}`,async()=>{
      const old=this.store.byRequest(key); if(old)return publicJob(old);
      const job={id:makeId(),requestKey:key,root,host,requestedTarget:target||null,preview,planHash:digest(plan),state:'PLAN_READY',createdAt:new Date().toISOString(),resultVerdict:'UNVERIFIED'};
      job.planPath=this.store.file(job.id,'plan.md');
      this.store.create(job);
      this.store.artifact(job.id,'plan.json',plan);
      writePrivate(job.planPath,renderPlan(plan));
      try {
        job.provider=resolveTarget(host,target,this.config());
        if(recipe){validateRecipe(recipe);this.store.artifact(job.id,'recipe-draft.json',recipe);job.recipeDraftHash=digest(recipe);}
      } catch(e){this.block(job,e);}
      this.store.save(job);return publicJob(job);
    });
  }
  // Called only while holding the job lease. A failed phase never deletes the saved Plan.
  hydrate(job,recipe) {
    const plan=this.store.read(job.id,'plan.json');
    requireThat(digest(plan)===job.planHash,'ARTIFACT_CHANGED','Saved Plan changed.');
    validatePlan(plan);
    if(!job.provider)job.provider=resolveTarget(job.host,job.requestedTarget||undefined,this.config());
    const manifest=capture(job.root);
    requireThat(!inside(manifest.root,this.store.root),'UNSAFE_STATE','Runtime state must be outside the actual Git root.');
    if(job.manifestHash)requireThat(digest(manifest)===job.manifestHash,'SOURCE_CHANGED','Repository changed since preparation; create a new request.');
    job.root=manifest.root;job.repository=manifest.repository;job.manifestHash=digest(manifest);
    this.store.artifact(job.id,'manifest.json',manifest);
    if(!recipe&&job.recipeDraftHash){recipe=this.store.read(job.id,'recipe-draft.json');requireThat(digest(recipe)===job.recipeDraftHash,'ARTIFACT_CHANGED','Saved recipe changed.');}
    if(!recipe){const inferred=inspectRecipe(manifest);requireThat(inferred.recipe,'NEEDS_RECIPE',inferred.reason);recipe=inferred.recipe;}
    validateRecipe(recipe);
    requireThat(recipe.source_commit===manifest.head,'RECIPE_SOURCE_MISMATCH','Recipe must be authored from the captured HEAD.');
    job.recipeHash=recipeHash(recipe,manifest.files);job.recipeDocumentHash=digest(recipe);this.store.artifact(job.id,'recipe.json',recipe);
    if(job.preview)job.state='PREVIEW_READY';
    else{const b=bindingFor(this.config(),job.repository,job.provider);job.approvalHash=approvalHash(job,b);job.state='NEEDS_APPROVAL';}
    delete job.error;
  }
  async prepareSaved(id,recipe){return this.store.locked(`job:${id}`,async()=>{
    const job=this.store.get(id);
    if(job.receipt)return publicJob(job);
    if(job.manifestHash&&job.recipeDocumentHash){requireThat(!recipe||digest(recipe)===job.recipeDocumentHash,'ARTIFACT_CHANGED','A prepared recipe cannot be replaced in place.');return publicJob(job);}
    try{this.hydrate(job,recipe);}catch(e){this.block(job,e);}
    this.store.save(job);return publicJob(job);
  });}
  async prepare(input){
    const saved=await this.savePlan(input);
    if(saved.error)return saved;
    return this.prepareSaved(saved.id,input.recipe);
  }
  block(job,e){job.state=e.code||'BLOCKED';job.error={code:e.code||'BLOCKED',message:e.code?e.message:'Unexpected local failure; no raw output retained.',...(e.details?{details:e.details}:{})};}
  inputs(id){
    const job=this.store.get(id),plan=this.store.read(id,'plan.json'),manifest=this.store.read(id,'manifest.json'),recipe=this.store.read(id,'recipe.json');
    requireThat(digest(plan)===job.planHash&&digest(manifest)===job.manifestHash&&digest(recipe)===job.recipeDocumentHash,'ARTIFACT_CHANGED','Stored artifact changed since prepare.');
    validatePlan(plan);validateRecipe(recipe);requireThat(recipeHash(recipe,manifest.files)===job.recipeHash,'ARTIFACT_CHANGED','Environment inputs changed.');
    const binding=bindingFor(this.config(),job.repository,job.provider);
    requireThat(binding.flavor===({codex:'codex_new_ui',claude:'claude_managed_cli',cursor:'cursor_cloud_api_v1',devin:'devin_cloud_api_v3'})[job.provider],'INVALID_TARGET','Unsupported execution flavor.');
    return{job,plan,manifest,recipe,binding};
  }
  review(id){const x=this.inputs(id);return{...publicJob(x.job),account:x.binding.accountLabel,binding:x.binding,approvalHash:approvalHash(x.job,x.binding),files:x.manifest.files.map(({data,...f})=>f),deleted:x.manifest.deleted,recipe:x.recipe,plan:x.plan};}
  approve(id,hash){const x=this.inputs(id);requireThat(hash===approvalHash(x.job,x.binding),'APPROVAL_CHANGED','Review changed; approve the current content.');this.store.approve(hash,{jobId:id,at:new Date().toISOString(),method:'user-tty'});}
  approved(x){
    requireThat(!x.job.preview,'PREVIEW_ONLY','Preview jobs cannot be submitted. Prepare a normal job.');
    const hash=approvalHash(x.job,x.binding);x.job.approvalHash=hash;
    const remembered=this.store.approval(hash),automatic=x.binding.autoApprove&&x.binding.approvedRecipeHashes.includes(x.job.recipeHash)&&!x.manifest.files.some(f=>f.untracked);
    requireThat(remembered||automatic,'NEEDS_APPROVAL','Review this job with trust in your terminal, or configure a narrowly scoped user policy.',{jobId:x.job.id,approvalHash:hash});
    requireThat(x.binding.accountLabel!=='SET_ME','NEEDS_SETUP','Configure the intended account before sending.');
    requireThat(!x.recipe.unresolved.length,'NEEDS_RECIPE','Resolve environment requirements before any cloud write.');
    requireThat(!x.recipe.required_secret_names.length,'NEEDS_SECRET_SETUP','Recipes requiring secrets need provider-side manual setup in this release. No secret values are accepted.');
  }
  async submit(id){return this.store.locked(`job:${id}`,async()=>{
    const current=this.store.get(id);if(current.receipt)return publicJob(current);
    if(!current.manifestHash||!current.recipeDocumentHash){try{this.hydrate(current);}catch(e){this.block(current,e);this.store.save(current);return publicJob(current);}this.store.save(current);}
    if(current.provider==='codex'&&current.state==='NEEDS_AUTH')return publicJob(current);
    const completed=this.store.operation(`${id}:task`) || this.store.operation(`${id}:ui:task`);
    if(completed?.state==='DONE'){current.receipt=JSON.parse(completed.result);current.state='SUBMITTED';delete current.error;this.store.save(current);return publicJob(current);}
    let x;try{
      x=this.inputs(id);this.approved(x);verifyCapture(x.manifest);const{job,binding,recipe,plan,manifest}=x;job.accountLabel=binding.accountLabel;job.bindingId=binding.id;
      if(job.provider==='codex'){
        job.state='NEEDS_UI_DRIVER';job.error={code:'NEEDS_UI_DRIVER',message:'Open ChatGPT Codex Cloud settings and run Cloud Environment Onboarding: Setup. Request login if needed; follow references/codex-ui.md for the saved job.',details:{onboarding:codexOnboarding(job.repository)}};this.store.save(job);return publicJob(job);
      }
      if(job.provider==='cursor'){const override=manifest.files.find(f=>f.path==='.cursor/environment.json');if(override){let value;try{value=JSON.parse(readCapturedFile(manifest,override).toString());}catch{fail('ENV_BINDING_AMBIGUOUS','Repository Cursor environment JSON is invalid.');}requireThat(digest(value)===digest(cursorEnvironment(recipe)),'ENV_BINDING_AMBIGUOUS','Repository .cursor/environment.json differs from the approved environment configuration.');}}
      const a=adapter(this.store,binding,this.options);
      job.state='ENVIRONMENT_PREPARING';delete job.error;this.store.save(job);
      job.environment=await this.store.locked(`env:${binding.provider}:${binding.organizationId||binding.id}`,()=>a.ensure(job,recipe));this.store.save(job);
      job.snapshot=publishSnapshot(this.store,job,manifest,binding);this.store.save(job);
      verifyCapture(manifest);const prompt=renderExecution(job,plan,recipe,binding);requireThat(Buffer.byteLength(prompt)<=100_000,'PLAN_TOO_LARGE','Rendered dispatch is too large.');
      writePrivate(this.store.file(id,'dispatch.md'),prompt);job.dispatchHash=digest(prompt);job.state='SUBMITTING';this.store.save(job);
      job.receipt=await a.submit(job,prompt,job.environment);job.state='SUBMITTED';delete job.error;this.store.artifact(id,'receipt.json',job.receipt);this.store.save(job);return publicJob(job);
    }catch(e){const job=x?.job||current;this.block(job,e);if(e.details?.environment)job.environment=e.details.environment;this.store.save(job);return publicJob(job);}
  });}
  async status(id){
    if(!id)return this.store.list().map(publicJob);
    return this.store.locked(`job:${id}`,async()=>{
      const job=this.store.get(id);if(!job.receipt)return publicJob(job);
      if(job.provider==='codex'){job.observation={remoteState:'UNKNOWN',resultVerdict:'UNVERIFIED',note:'Inspect the official task with the connected host browser.'};return publicJob(job);}
      try{const binding=bindingFor(this.config(),job.repository,job.provider);job.observation=await adapter(this.store,binding,this.options).status(job.receipt);this.store.observe(id,job.observation);this.store.save(job);}
      catch(e){job.observation={remoteState:'UNKNOWN',resultVerdict:'UNVERIFIED',error:e.code||'STATUS_UNAVAILABLE'};this.store.save(job);}
      return publicJob(job);
    });
  }
  // The browser belongs to the calling agent. These methods journal UI intent and validate observations; they do not invent a browser connection.
  async uiBegin(id,stage){return this.store.locked(`job:${id}`,async()=>{
    const x=this.inputs(id);this.approved(x);const{job,binding,manifest,plan,recipe}=x;job.accountLabel=binding.accountLabel;job.bindingId=binding.id;
    requireThat(job.provider==='codex'&&['environment','task'].includes(stage),'INVALID_UI_STAGE','UI workflow is for new Codex only.');
    if(job.receipt)return{done:true,receipt:job.receipt};
    verifyCapture(manifest);
    if(stage==='environment')requireThat(binding.allowEnvironmentCreate||binding.environmentId,'NEEDS_SETUP','Approve personal environment preparation or configure an existing environment ID.');
    if(stage==='task'){
      requireThat(job.environment?.state==='READY','ENVIRONMENT_NOT_READY','Record the published environment before starting a task.');
      requireThat(binding.allowPromptGitGate,'NEEDS_APPROVAL','UI task dispatch requires the prompt-based commit gate.');
      job.snapshot=publishSnapshot(this.store,job,manifest,binding);this.store.save(job);
    }
    const payload={stage,account:binding.accountLabel,repository:job.repository,planHash:job.planHash,recipeHash:job.recipeHash,environment:job.environment||null,snapshot:job.snapshot||null};
    const op=`${id}:ui:${stage}`,old=this.store.operation(op);
    if(old?.state==='DONE')return{done:true,result:JSON.parse(old.result)};
    if(old&&old.state!=='REJECTED'){const intent=this.store.read(id,`ui-${stage}.json`);return{...intent,reconcileOnly:true,artifactPath:this.store.file(id,stage==='task'?'dispatch.md':'environment-setup.md'),instruction:'Resume or inspect the existing Setup/task interaction. Do not start another Setup or send again while its outcome is unknown.'};}
    const intent={...payload,nonce:randomUUID(),jobId:id,operationId:op,reconcileOnly:false,...(stage==='environment'?{onboarding:codexOnboarding(job.repository)}:{})};
    this.store.artifact(id,`ui-${stage}.json`,intent);this.store.startOperation(op,payload);
    if(stage==='task'){const prompt=renderExecution(job,plan,recipe,binding);writePrivate(this.store.file(id,'dispatch.md'),prompt);job.dispatchHash=digest(prompt);job.state='SUBMITTING';}
    else{writePrivate(this.store.file(id,'environment-setup.md'),renderCodexOnboarding(job.repository));job.state='ENVIRONMENT_PREPARING';}
    delete job.error;this.store.save(job);return{...intent,artifactPath:this.store.file(id,stage==='task'?'dispatch.md':'environment-setup.md')};
  });}
  async uiRecord(id,stage,evidence){return this.store.locked(`job:${id}`,async()=>{
    const x=this.inputs(id);this.approved(x);const{job,binding}=x;requireThat(job.provider==='codex'&&['environment','task'].includes(stage),'INVALID_UI_STAGE','Invalid UI stage.');
    scanSecrets(evidence,'browser observation');const intent=this.store.read(id,`ui-${stage}.json`),op=`${id}:ui:${stage}`;
    if(stage==='environment'&&evidence.status==='NEEDS_AUTH'){
      requireThat(evidence.nonce===intent.nonce,'OBSERVATION_MISMATCH','Authentication observation must match the saved Setup attempt.');
      requireThat(Array.isArray(evidence.evidenceRefs)&&evidence.evidenceRefs.length>0&&evidence.evidenceRefs.every(v=>typeof v==='string'&&v.length>0),'MISSING_EVIDENCE','Include an actual observation of the login requirement.');
      officialUrl(evidence.url,'codex');
      requireThat(!evidence.environmentId&&!evidence.taskId&&evidence.published!==true&&evidence.accepted!==true,'OBSERVATION_MISMATCH','A login blocker is not a completed environment or task.');
      requireThat(evidence.setupStarted===undefined||typeof evidence.setupStarted==='boolean','OBSERVATION_MISMATCH','setupStarted must be a boolean when known.');
      requireThat(this.store.operation(op)?.state!=='DONE','OPERATION_CHANGED','A completed Setup cannot be changed into a login failure.');
      // Only an observed pre-send login gate proves that no Setup was submitted.
      // A login request inside a running/unknown Setup keeps the original intent.
      if(evidence.setupStarted===false)this.store.rejectOperation(op);
      job.state='NEEDS_AUTH';job.error={code:'NEEDS_AUTH',message:'ChatGPTへのログインをお願いします。ログイン後、保存済みの同じoffload依頼を再開してください。',details:{loginUrl:CODEX_SETTINGS_URL}};
      this.store.observe(id,{stage,evidence});this.store.save(job);return publicJob(job);
    }
    requireThat(evidence.nonce===intent.nonce&&evidence.account===binding.accountLabel&&evidence.repository===job.repository&&evidence.flavor==='codex_new_ui','OBSERVATION_MISMATCH','Browser observation must match the saved account/repository/new Cloud intent.');
    requireThat(Array.isArray(evidence.evidenceRefs)&&evidence.evidenceRefs.length>0&&evidence.evidenceRefs.every(v=>typeof v==='string'&&v.length>0),'MISSING_EVIDENCE','Include actual host browser tool observation references, not guesses.');
    requireThat(evidence.recipeHash===job.recipeHash,'OBSERVATION_MISMATCH','Recipe fingerprint differs.');
    const url=officialUrl(evidence.url,'codex');remoteId(evidence.environmentId);
    const completed=this.store.operation(op);
    if(completed?.state==='DONE'){const saved=JSON.parse(completed.result);requireThat(stage==='environment'?saved.id===evidence.environmentId:saved.id===evidence.taskId&&saved.url===url,'OPERATION_CHANGED','Completed UI observations cannot be rebound.');return publicJob(job);}
    if(stage==='environment'){
      requireThat(evidence.published===true&&evidence.personal===true&&evidence.validation==='passed','ENVIRONMENT_NOT_READY','Published personal environment and successful readiness checks must be observed.');
      job.environment={id:evidence.environmentId,state:'READY',recipeHash:job.recipeHash,source:'host-browser-observation',observedAt:new Date().toISOString(),url};
      this.store.finishOperation(op,job.environment);job.state='READY_TO_SUBMIT';
    }else{
      requireThat(evidence.environmentId===job.environment?.id&&evidence.commit===job.snapshot?.commit&&evidence.dispatchHash===job.dispatchHash,'OBSERVATION_MISMATCH','Environment/code/dispatch differs.');
      requireThat(url&&new URL(url).pathname.includes(evidence.taskId||'__missing__')&&evidence.accepted===true,'INVALID_RECEIPT','Task acceptance and official task URL must be observed.');
      job.receipt={provider:'codex',id:remoteId(evidence.taskId),url,acceptedAt:new Date().toISOString(),resultVerdict:'UNVERIFIED',source:'host-browser-observation'};
      this.store.finishOperation(op,job.receipt);job.state='SUBMITTED';this.store.artifact(id,'receipt.json',job.receipt);
    }
    delete job.error;this.store.observe(id,{stage,evidence});this.store.save(job);return publicJob(job);
  });}
}
