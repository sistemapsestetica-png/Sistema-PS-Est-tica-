import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomBytes,createCipheriv,createDecipheriv,createHmac } from 'node:crypto';

export class Store {
  constructor(directory) {
    this.directory=resolve(directory); mkdirSync(this.directory,{recursive:true,mode:0o700});
    const keyFile=join(this.directory,'master.key');
    if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});
    this.key=readFileSync(keyFile);if(this.key.length!==32)throw Error('INVALID_STATE_KEY');
    this.db=new DatabaseSync(join(this.directory,'monitor.sqlite'));
    this.db.exec(`pragma journal_mode=WAL; pragma busy_timeout=5000;
      create table if not exists kv(bucket text,k text,v text,primary key(bucket,k));
      create table if not exists members(k text primary key,group_id text,identity text,baseline integer not null default 0,observed_at text,confirmed_at text,state text not null,payload text,attempts integer not null default 0,next_attempt integer not null default 0,last_error text);
      create table if not exists aliases(alias text primary key,member_key text not null);`);
    try{chmodSync(join(this.directory,'monitor.sqlite'),0o600)}catch{}
  }
  seal(value){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString('base64');
  }
  unseal(value){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString())}
  hash(value){return createHmac('sha256',this.key).update(value).digest('hex')}
  get(bucket,k){const r=this.db.prepare('select v from kv where bucket=? and k=?').get(bucket,k);return r?this.unseal(r.v):undefined}
  set(bucket,k,value){if(value==null)this.db.prepare('delete from kv where bucket=? and k=?').run(bucket,k);else this.db.prepare('insert into kv values(?,?,?) on conflict(bucket,k) do update set v=excluded.v').run(bucket,k,this.seal(value))}
  transaction(fn){this.db.exec('begin immediate');try{const out=fn();this.db.exec('commit');return out}catch(e){this.db.exec('rollback');throw e}}
  memberKey(group,ids){
    for(const id of ids){const row=this.db.prepare('select member_key from aliases where alias=?').get(this.hash(group+'|'+id));if(row)return row.member_key}
    return this.hash(group+'|'+ids[0]);
  }
  observe(group,ids,baseline=false,observedAt=new Date().toISOString()){
    if(!ids.length)throw Error('MISSING_IDENTITY');
    return this.transaction(()=>{
      const k=this.memberKey(group,ids);
      this.db.prepare('insert or ignore into members(k,group_id,identity,baseline,observed_at,state) values(?,?,?,?,?,?)').run(k,group,this.seal(ids),baseline?1:0,observedAt,baseline?'baseline':'pending');
      for(const id of ids)this.db.prepare('insert or ignore into aliases values(?,?)').run(this.hash(group+'|'+id),k);
      return this.db.prepare('select * from members where k=?').get(k);
    });
  }
  confirm(k,payload){this.db.prepare("update members set state='queued',confirmed_at=?,payload=?,next_attempt=0,attempts=0,last_error=null where k=? and state='pending'").run(payload.confirmed_at,this.seal(payload),k)}
  mark(k,state,error=null,next=0){this.db.prepare('update members set state=?,last_error=?,next_attempt=?,attempts=attempts+1 where k=?').run(state,error,next,k)}
  due(){return this.db.prepare("select * from members where state in ('pending','queued') and next_attempt<=? order by observed_at limit 10").all(Date.now())}
  counts(){return this.db.prepare('select state,count(*) as count from members group by state').all()}
  close(){this.db.close()}
}
