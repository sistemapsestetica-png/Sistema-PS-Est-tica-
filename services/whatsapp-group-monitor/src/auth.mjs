import {BufferJSON,initAuthCreds,proto} from '@whiskeysockets/baileys';

const serialize=value=>JSON.parse(JSON.stringify(value,BufferJSON.replacer));
const deserialize=value=>JSON.parse(JSON.stringify(value),BufferJSON.reviver);

export function encryptedAuthState(store){
  const saved=store.get('wa-auth','creds');
  const creds=saved?deserialize(saved):initAuthCreds();
  return {
    state:{
      creds,
      keys:{
        get:async(type,ids)=>Object.fromEntries(ids.map(id=>{
          let value=store.get(`wa-key:${type}`,id);
          if(value)value=deserialize(value);
          if(type==='app-state-sync-key'&&value)value=proto.Message.AppStateSyncKeyData.fromObject(value);
          return [id,value];
        })),
        set:async data=>{
          for(const [type,values] of Object.entries(data))for(const [id,value] of Object.entries(values)){
            store.set(`wa-key:${type}`,id,value?serialize(value):null);
          }
        }
      }
    },
    saveCreds:async()=>store.set('wa-auth','creds',serialize(creds))
  };
}
