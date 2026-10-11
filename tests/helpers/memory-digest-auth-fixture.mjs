import assert from 'node:assert/strict';
import {fixture as cloudFixture} from './auth-1-https-cloud.mjs';
import {registration,appDevice,control,refresh,proof} from '../../services/cloud/test/app-helpers.mjs';

/** Native owner plus a real, mailbox-verified synthetic cloud phone session. */
export async function digestAuthFixture(){
  const cleanups=[];
  const close=async()=>{for(const cleanup of cleanups.reverse())await cleanup();};
  try{
    const cloud=await cloudFixture({after:cleanup=>cleanups.push(cleanup)});
    await registration(cloud);
    return {cloudIdentity:{issuer:cloud.config.issuer},close,
      authenticate:async({service,origin,hostId})=>{
        const api=async(route,body,auth,headers={},status=200)=>{
          const response=await fetch(origin+'/personal/v1'+route,{method:body===undefined?'GET':'POST',
            headers:{origin,'content-type':'application/json',...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}),...headers},
            ...(body===undefined?{}:{body:JSON.stringify(body)})});
          const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));
          return {...data,cookie:response.headers.get('set-cookie')?.split(';')[0]??auth?.cookie};
        };
        const desktopHeaders={'x-weftmate-desktop':service.libraryDesktopToken};
        await api('/auth/desktop',{},undefined,{},403);
        const native=await api('/auth/desktop',{deviceName:'Synthetic memory desktop'},undefined,desktopHeaders);
        assert.equal(native.device.authKind,'desktop');assert.equal(native.local,true);
        const desktop=await appDevice(cloud,'desktop');
        const nonce=await api('/auth/cloud-nonce',{});
        const linked=await api('/auth/cloud-desktop',{accessToken:desktop.tokens.access_token,deviceName:'Synthetic memory desktop'},native,
          {...desktopHeaders,dpop:await proof(desktop,origin+'/personal/v1/auth/cloud-desktop',desktop.tokens.access_token,{nonce:nonce.nonce})});
        assert.equal(linked.account.ownerId,native.account.ownerId);
        const phone=await appDevice(cloud,'mem3-phone');
        const selected=(await control(phone,'/hosts/connect',{hostId})).data;
        assert.equal(selected.approval,'trusted');await refresh(phone,selected.resource);
        const phoneNonce=await api('/auth/cloud-nonce',{});
        const remote=await api('/auth/cloud-session',{accessToken:phone.tokens.access_token,deviceName:'Synthetic memory phone'},undefined,
          {dpop:await proof(phone,origin+'/personal/v1/auth/cloud-session',phone.tokens.access_token,{nonce:phoneNonce.nonce})});
        assert.equal(remote.device.authKind,'cloud');assert.equal(remote.account.ownerId,native.account.ownerId);
        const identity=await api('/auth/me',undefined,remote);assert.equal(identity.device.authKind,'cloud');
        return {auth:remote,cookie:remote.cookie};
      }};
  }catch(error){await close();throw error;}
}
