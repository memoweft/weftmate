import {passwordWrappingKey,openPasswordKey,sealPasswordKey,passwordKeyEncode} from './password-key.mjs';
const invalid=code=>Object.assign(new Error(code),{code});
export function opaqueCall(method,args,{signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(invalid('CANCELLED'));return;}
  const worker=new Worker(new URL('../password-worker.js',import.meta.url)),timer=setTimeout(()=>finish(invalid('PASSWORD_TIMEOUT')),30000);
  const cancel=()=>finish(invalid('CANCELLED'));
  function finish(error,value){clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value);}
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data})=>finish(data.error?invalid(data.error):null,data.value);
  worker.onerror=()=>finish(invalid('PASSWORD_UNAVAILABLE'));worker.postMessage({method,args});
 });
}
export async function passwordCapabilities(client){
 try{return await client.publicRequest('/password/capabilities',{});}
 catch(error){if(error.status===404)return {enabled:false};throw error;}
}
export async function passwordLogin(client,fields,request,{signal}={}){
 const start=await opaqueCall('startLogin',{password:fields.password},{signal});
 const response=await request('/start',{...fields,password:undefined,startLoginRequest:start.startLoginRequest});
 const result=await opaqueCall('finishLogin',{password:fields.password,clientLoginState:start.clientLoginState,loginResponse:response.loginResponse,identifiers:response.identifiers},{signal});
 if(!result)throw invalid('INVALID_CREDENTIALS');
 await pin(client,result.serverStaticPublicKey);
 const finished=await request('/finish',{...fields,password:undefined,flowId:response.flowId,finishLoginRequest:result.finishLoginRequest});
 return {finished,exportKey:result.exportKey,sub:response.identifiers.client};
}
async function pin(client,value){
 const slot='opaque-server:'+client.config.issuer,prior=await client.credentials(slot);
 if(prior&&prior!==value)throw invalid('PASSWORD_SERVER_CHANGED');
 if(!prior)await client.credentials(slot,value);
}
export async function unlockPasswordKey(client,exportKey,sub,check=()=>{}){
 const {wrappedKey}=await client.authorized('/password/read',{method:'POST',body:{}});
 if(!wrappedKey)return false;
 const secret=await openPasswordKey(client.vendor,exportKey,wrappedKey,{issuer:client.config.issuer,sub});
 try{
  check();await client.installAccountKey({issuer:client.config.issuer,sub,keyId:wrappedKey.keyId,secret:passwordKeyEncode(secret)},check);check();
  client.passwordUnlocked=true;return true;
 }finally{secret.fill(0);}
}
export async function setPassword(client,{password,currentPassword,passwordTicket,purpose,wrap,signal,current=()=>{}}){
 const ensure=()=>{if(signal?.aborted)throw invalid('CANCELLED');current();};
 ensure();const capabilities=await passwordCapabilities(client);ensure();
 if(!capabilities.enabled)throw invalid('PASSWORD_UNAVAILABLE');
 if(Array.from(password).length<8||Array.from(password).length>128||password===currentPassword)throw invalid('PASSWORD_NEW_REQUIRED');
 const request=async(path,body)=>{
  ensure();const response=await(passwordTicket?client.publicRequest(path,{...body,passwordTicket}):client.authorized(path,{method:'POST',body}));
  if(path!=='/password/commit')ensure();return response;
 };
 let proof,secret,wrappedKey=null,activationProof,sub;
 try{
  if(!passwordTicket){
   const status=await request('/password/read',{});sub=(await client.saved()).sub;
   if(status.version){
    const unlocked=await passwordLogin(client,{password:currentPassword},(suffix,body)=>request('/password/unlock'+suffix,body),{signal});
    proof=unlocked.finished.proof;if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof))throw invalid('INVALID_CREDENTIALS');
    if(status.wrappedKey)secret=await openPasswordKey(client.vendor,unlocked.exportKey,status.wrappedKey,{issuer:client.config.issuer,sub});
    else if(!wrap)throw invalid('ACCOUNT_KEY_INVALID');
   }
  }
  const start=await opaqueCall('startRegistration',{password},{signal});
  const response=await request('/password/registration',{registrationRequest:start.registrationRequest,proof,purpose});
  const finish=await opaqueCall('finishRegistration',{...start,password,registrationResponse:response.registrationResponse,identifiers:response.identifiers},{signal});
  ensure();await pin(client,finish.serverStaticPublicKey);ensure();sub=response.identifiers.client;
  if(!passwordTicket){
   const salt=passwordKeyEncode(crypto.getRandomValues(new Uint8Array(16)));
   const key=await passwordWrappingKey(finish.exportKey,salt,client.config.issuer,sub);
   try{
    ensure();
    if(secret)wrappedKey=await sealPasswordKey(client.vendor,key,secret,{issuer:client.config.issuer,sub,keyId:passwordKeyEncode(await crypto.subtle.digest('SHA-256',secret)),salt});
    else({wrappedKey,activationProof}=await wrap({issuer:client.config.issuer,sub,salt,secret:passwordKeyEncode(key),registrationRecord:finish.registrationRecord,flowId:response.flowId}));
   }finally{key.fill(0);}
  }
  return await request('/password/commit',{flowId:response.flowId,registrationRecord:finish.registrationRecord,wrappedKey,...(activationProof?{activationProof}:{})});
 }finally{secret?.fill(0);}
}
