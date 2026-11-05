const encode=data=>{let s='';for(const b of new Uint8Array(data))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const bad=()=>{throw Object.assign(new Error('ACCOUNT_KEY_INVALID'),{code:'ACCOUNT_KEY_INVALID'});};
export async function passwordWrappingKey(exportKey,salt,issuer,sub){
 const material=decode(exportKey),saltBytes=decode(salt);
 if(material.length!==64||saltBytes.length!==16)bad();
 try{
  const key=await crypto.subtle.importKey('raw',material,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:saltBytes,
   info:new TextEncoder().encode(JSON.stringify(['wm-password-key',issuer,sub]))},key,256));
 }finally{material.fill(0);}
}
export async function sealPasswordKey(vendor,key,secret,{issuer,sub,keyId,salt}){
 const bytes=typeof secret==='string'?decode(secret):new Uint8Array(secret);
 try{
  if(bytes.length!==32||encode(await crypto.subtle.digest('SHA-256',bytes))!==keyId)bad();
  const payload=new TextEncoder().encode(JSON.stringify([issuer,sub,keyId,encode(bytes)]));
  try{return {schema:1,keyId,salt,box:await new vendor.CompactEncrypt(payload).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:'wm-password-key+jwe',kid:keyId}).encrypt(key)};}
  finally{payload.fill(0);}
 }finally{bytes.fill(0);}
}
export async function openPasswordKey(vendor,exportKey,wrapped,{issuer,sub}){
 if(wrapped?.schema!==1||typeof wrapped.salt!=='string')bad();
 const key=await passwordWrappingKey(exportKey,wrapped.salt,issuer,sub);
 try{
  const {plaintext,protectedHeader}=await vendor.compactDecrypt(wrapped.box,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
  try{
   const [origin,account,keyId,secret]=JSON.parse(new TextDecoder().decode(plaintext)),bytes=decode(secret);
   if(origin!==issuer||account!==sub||protectedHeader.typ!=='wm-password-key+jwe'||protectedHeader.kid!==keyId||keyId!==wrapped.keyId||
      bytes.length!==32||encode(await crypto.subtle.digest('SHA-256',bytes))!==keyId){bytes.fill(0);bad();}
   return bytes;
  }finally{plaintext.fill(0);}
 }catch{bad();}finally{key.fill(0);}
}
export {encode as passwordKeyEncode};
