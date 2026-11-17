import http from 'node:http';
import process from 'node:process';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket,{DisconnectReason,fetchLatestBaileysVersion} from '@whiskeysockets/baileys';
import {Store} from './store.mjs';
import {encryptedAuthState} from './auth.mjs';
import {JoinProcessor,identities} from './core.mjs';
import {createBackendClient} from './delivery.mjs';
import {createHash} from 'node:crypto';

const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error(`MISSING_${name}`);return value};
const inviteUrl=required('GROUP_INVITE_URL');
const inviteCode=new URL(inviteUrl).pathname.split('/').filter(Boolean).at(-1);
if(!inviteCode)throw Error('INVALID_GROUP_INVITE_URL');
const store=new Store(process.env.STATE_DIR||'.state');
const log=pino({level:process.env.LOG_LEVEL||'info',redact:{paths:['qr','participant','phone','jid','groupId'],censor:'[redacted]'}});
const deliver=createBackendClient({url:required('TRACKING_BACKEND_URL'),secret:required('WHATSAPP_GROUP_MONITOR_SECRET')});
let socket,processor,qrPng,connected=false,stopping=false,reconnectTimer,tickTimer;

const httpServer=http.createServer((request,response)=>{
  if(request.url==='/health'){
    response.writeHead(connected?200:503,{'content-type':'application/json','cache-control':'no-store'});
    return response.end(JSON.stringify({ok:connected,paired:Boolean(store.get('runtime','group')),queue:store.counts()}));
  }
  if(request.url?.startsWith('/qr')&&qrPng){response.writeHead(200,{'content-type':'image/png','cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache'});return response.end(qrPng)}
  if(request.url==='/pair'){
    response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return response.end(`<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar WhatsApp</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#fff;font:16px system-ui;text-align:center}.card{padding:24px;background:#1c1c1c;border-radius:20px;box-shadow:0 18px 60px #0008}img{display:block;width:min(78vw,420px);height:auto;background:#fff;border-radius:12px;margin:16px auto}p{max-width:420px;color:#ccc}.success img{display:none}.success h1{color:#d8b45a}</style><div class="card" id="card"><h1 id="title">Conectar WhatsApp</h1><p id="instructions">Abra Aparelhos conectados no celular e escaneie. Esta tela atualiza o QR automaticamente.</p><img id="qr" alt="QR Code do WhatsApp"><p id="status">Aguardando leitura...</p></div><script>const image=document.getElementById('qr'),card=document.getElementById('card');let paired=false;const refresh=setInterval(()=>{if(!paired)image.src='/qr?ts='+Date.now()},3000);image.src='/qr?ts='+Date.now();setInterval(async()=>{try{const r=await fetch('/health',{cache:'no-store'});if(r.ok&&!paired){paired=true;clearInterval(refresh);card.classList.add('success');document.getElementById('title').textContent='WhatsApp conectado';document.getElementById('instructions').textContent='O monitor está ativo na Oracle e continuará funcionando com o computador desligado.';document.getElementById('status').textContent='Conectado com sucesso';}}catch{}},2000)</script></html>`)
  }
  response.writeHead(404,{'content-type':'text/plain'});response.end('Not found');
});
httpServer.listen(Number(process.env.PORT||3099),'127.0.0.1',()=>log.info({event:'local_status_ready'}));

async function resolveGroup(sock){
  const info=await sock.groupGetInviteInfo(inviteCode);
  if(!info?.id)throw Error('GROUP_NOT_FOUND');
  const metadata=await sock.groupMetadata(info.id);
  const ownIds=identities({id:sock.user?.id,lid:sock.user?.lid,phoneNumber:sock.user?.phoneNumber});
  const own=metadata.participants.find(member=>identities(member).some(id=>ownIds.includes(id)));
  if(!own||!['admin','superadmin'].includes(own.admin))throw Error('ACCOUNT_NOT_GROUP_ADMIN');
  const saved=store.get('runtime','group');
  if(saved&&saved.id!==metadata.id)throw Error('GROUP_ID_CHANGED');
  store.set('runtime','group',{id:metadata.id,subject:metadata.subject});
  const registration=await deliver.register({group_id:metadata.id,subject:metadata.subject,invite_hash:createHash('sha256').update(inviteCode).digest('hex')});
  if(!registration.ok)throw Error(registration.code||'GROUP_REGISTRATION_FAILED');
  if(!store.get('runtime','baseline-complete')){
    for(const member of metadata.participants){const ids=identities(member);if(ids.length)store.observe(metadata.id,ids,true)}
    store.set('runtime','baseline-complete',{at:new Date().toISOString(),groupId:metadata.id});
    log.info({event:'baseline_created',members:metadata.participants.length});
  }
  processor=new JoinProcessor({store,groupId:metadata.id,metadata:id=>sock.groupMetadata(id),deliver,log:entry=>log.warn(entry)});
  return metadata;
}

async function connect(){
  clearTimeout(reconnectTimer);
  const {state,saveCreds}=encryptedAuthState(store);
  const {version}=await fetchLatestBaileysVersion();
  socket=makeWASocket({version,auth:state,logger:pino({level:'silent'}),printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:false,shouldSyncHistoryMessage:()=>false,getMessage:async()=>undefined});
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('group-participants.update',event=>processor?.onUpdate(event));
  socket.ev.on('connection.update',async update=>{
    if(update.qr){qrPng=await QRCode.toBuffer(update.qr,{width:420,margin:2});log.info({event:'qr_ready',url:'http://127.0.0.1:'+(process.env.PORT||3099)+'/qr'})}
    if(update.connection==='open'){
      qrPng=null;connected=true;
      try{const metadata=await resolveGroup(socket);log.info({event:'connected',group:metadata.subject})}
      catch(error){connected=false;log.error({event:'group_validation_failed',code:error.message});socket.end(error)}
    }
    if(update.connection==='close'){
      connected=false;processor=null;
      const code=update.lastDisconnect?.error?.output?.statusCode;
      if(code===DisconnectReason.loggedOut){log.error({event:'logged_out'});return}
      if(!stopping)reconnectTimer=setTimeout(connect,Math.min(60000,5000+Math.floor(Math.random()*5000)));
    }
  });
}

tickTimer=setInterval(()=>processor?.tick(),5000);
const shutdown=async signal=>{stopping=true;clearInterval(tickTimer);clearTimeout(reconnectTimer);log.info({event:'shutdown',signal});try{socket?.end(new Error('shutdown'))}catch{}httpServer.close(()=>{store.close();process.exit(0)});setTimeout(()=>process.exit(1),5000).unref()};
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
connect().catch(error=>{log.fatal({event:'startup_failed',code:error.message});process.exit(1)});
