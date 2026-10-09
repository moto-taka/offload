import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseOffload } from '../lib/config.mjs';

// No provider SDK import: the current Pi instance supplies the documented extension API.
export default function offloadExtension(pi){
  const skill=fileURLToPath(new URL('../../SKILL.md',import.meta.url));
  pi.registerCommand('offload',{
    description:'Summarize this conversation into a Plan and dispatch to one managed cloud',
    handler:async(args,ctx)=>{
      try{
        const parsed=parseOffload(args||'');
        const marker=randomUUID();
        const prompt=`Explicit offload request ${marker}. Source host: pi. Read ${JSON.stringify(skill)} and execute its workflow in this conversation. Parsed user command: ${JSON.stringify(parsed)}. Use only the current visible conversation branch. Do not include hidden reasoning or switch models for planning. Do not run trust or change trusted configuration on behalf of the user. If a write tool is still active, finish it before capturing the source boundary. Return the actual job/receipt or precise blocker, not a promised future action.`;
        // Follow-up is queued after the current turn, rather than interrupting an in-flight write.
        pi.sendUserMessage(prompt,{deliverAs:'followUp'});
        ctx.ui?.notify?.('Offload requested; the current agent will prepare the Plan.','info');
      }catch(e){ctx.ui?.notify?.(e.code?e.message:'Invalid offload request.','error');}
    },
  });
}
