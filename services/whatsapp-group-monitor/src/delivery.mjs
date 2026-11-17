import {createHmac} from 'node:crypto';

export function createBackendClient({url,secret,timeoutMs=15000}){
  if(!url||!secret)throw Error('MISSING_DELIVERY_CONFIG');
  const request=async payload=>{
    const body=JSON.stringify(payload);
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
    try{
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-monitor-timestamp':timestamp,'x-monitor-signature':signature},body,signal:AbortSignal.timeout(timeoutMs)});
      const data=await response.json().catch(()=>({}));
      if(response.ok&&data.ok)return {ok:true,sent:data.sent!==false};
      return {ok:false,permanent:response.status>=400&&response.status<500&&response.status!==408&&response.status!==429,code:typeof data.code==='string'?data.code:`HTTP_${response.status}`};
    }catch{return {ok:false,permanent:false,code:'NETWORK_ERROR'}}
  };
  const deliver=payload=>request({operation:'confirm-join',...payload});
  deliver.register=payload=>request({operation:'register-group',...payload});
  return deliver;
}
