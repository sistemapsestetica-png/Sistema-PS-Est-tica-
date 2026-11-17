import {createHash} from 'node:crypto';
export const normalizeJid=value=>typeof value==='string'?value.replace(/:\d+@/,'@'):'';
export function identities(p){return [...new Set((typeof p==='string'?[p]:[p?.id,p?.lid,p?.phoneNumber]).map(normalizeJid).filter(v=>/^[\d-]+@(lid|s\.whatsapp\.net)$/.test(v)))]}
export function phoneFor(p){const pn=identities(p).find(j=>j.endsWith('@s.whatsapp.net'));if(!pn)return null;const digits=pn.split('@')[0];return /^[1-9]\d{7,14}$/.test(digits)?digits:null}
export const phoneHash=phone=>createHash('sha256').update(phone).digest('hex');
export function matchedParticipant(candidate,metadata){const ids=identities(candidate);return metadata.participants?.find(p=>identities(p).some(id=>ids.includes(id)))||null}
export const backoff=attempt=>Math.min(900_000,5000*2**Math.min(attempt,8));

export class JoinProcessor {
 constructor({store,groupId,metadata,deliver,log=()=>{}}){Object.assign(this,{store,groupId,metadata,deliver,log});this.busy=false}
 onUpdate(event){
   if(event?.id!==this.groupId||event.action!=='add'||!Array.isArray(event.participants))return 0;
   for(const p of event.participants){const ids=identities(p);if(ids.length)this.store.observe(this.groupId,ids)}
   return event.participants.length;
 }
 async confirm(row){
   const ids=this.store.unseal(row.identity);
   const metadata=await this.metadata(this.groupId);
   if(metadata.id!==this.groupId)throw Error('WRONG_GROUP_METADATA');
   const member=matchedParticipant({id:ids[0],lid:ids.find(i=>i.endsWith('@lid')),phoneNumber:ids.find(i=>i.endsWith('@s.whatsapp.net'))},metadata);
   if(!member)throw Error('MEMBERSHIP_NOT_CONFIRMED');
   // Only numbers received as a PN JID are telephone numbers; LID digits are NOT.
   const phone=phoneFor(member)||phoneFor({id:ids.find(i=>i.endsWith('@s.whatsapp.net'))});
   if(!phone)throw Error('NO_VERIFIED_PHONE');
   const merged=this.store.observe(this.groupId,[...identities(member),...ids]);
   if(merged.baseline||merged.state==='sent') {this.store.mark(row.k,'ignored','ALREADY_MEMBER');return}
   const confirmedAt=new Date().toISOString();
   this.store.confirm(row.k,{group_id:this.groupId,participant_key:row.k,event_id:'bf-group-'+this.store.hash(this.groupId+'|'+row.k),phone_sha256:phoneHash(phone),observed_at:row.observed_at,confirmed_at:confirmedAt,proof_method:'baileys_add+metadata',attribution_state:'unattributed'});
 }
 async tick(){
   if(this.busy)return;this.busy=true;
   try{for(const row of this.store.due()){
     try{
       if(Date.now()-Date.parse(row.observed_at)>86400000){this.store.mark(row.k,'dead','EXPIRED');continue}
       if(row.state==='pending'){await this.confirm(row);continue}
       const result=await this.deliver(this.store.unseal(row.payload));
       if(result.ok&&result.sent)this.store.mark(row.k,'sent');
       else if(result.permanent)this.store.mark(row.k,'blocked',result.code||'REJECTED');
       else throw Error(result.code||'DELIVERY_RETRY');
     }catch(error){
       const code=/^[A-Z_]+$/.test(error.message)?error.message:'TEMPORARY_FAILURE';
       this.store.mark(row.k,row.attempts>=11?'dead':row.state,code,Date.now()+backoff(row.attempts));
       this.log({event:'join_retry',code,attempt:row.attempts+1});
     }
   }}finally{this.busy=false}
 }
}
