import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {JoinProcessor,phoneFor} from '../src/core.mjs';

test('LID digits are never treated as a phone number',()=>assert.equal(phoneFor({id:'123456789012345@lid'}),null));

test('only a confirmed new group add is delivered once',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'bf-monitor-'));
  const store=new Store(dir);
  const member={id:'5511999999999@s.whatsapp.net',phoneNumber:'5511999999999@s.whatsapp.net'};
  const sent=[];
  const processor=new JoinProcessor({store,groupId:'vip@g.us',metadata:async()=>({id:'vip@g.us',participants:[member]}),deliver:async payload=>(sent.push(payload),{ok:true,sent:true})});
  assert.equal(processor.onUpdate({id:'other@g.us',action:'add',participants:[member]}),0);
  assert.equal(processor.onUpdate({id:'vip@g.us',action:'remove',participants:[member]}),0);
  assert.equal(processor.onUpdate({id:'vip@g.us',action:'add',participants:[member]}),1);
  await processor.tick();await processor.tick();await processor.tick();
  assert.equal(sent.length,1);assert.equal(sent[0].proof_method,'baileys_add+metadata');assert.equal(sent[0].attribution_state,'unattributed');assert.match(sent[0].phone_sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(store.counts().map(row=>({...row})),[{state:'sent',count:1}]);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test('baseline members never become conversions',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'bf-monitor-'));
  const store=new Store(dir);
  const member={id:'5511888888888@s.whatsapp.net',phoneNumber:'5511888888888@s.whatsapp.net'};
  store.observe('vip@g.us',[member.id],true);
  let deliveries=0;
  const processor=new JoinProcessor({store,groupId:'vip@g.us',metadata:async()=>({id:'vip@g.us',participants:[member]}),deliver:async()=>{deliveries++;return {ok:true,sent:true}}});
  processor.onUpdate({id:'vip@g.us',action:'add',participants:[member]});await processor.tick();await processor.tick();
  assert.equal(deliveries,0);assert.equal(store.counts()[0].state,'baseline');
  store.close();rmSync(dir,{recursive:true,force:true});
});
