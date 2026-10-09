/** Local signed cloud control plane for binding an existing synthetic password account. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
export async function syntheticCloudBinding() {
  const signing = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(signing.publicKey),kid:'fix8-synthetic',alg:'RS256',use:'sig'};
  const claims = new Map(); let base,issuer;
  const server=createServer(async(req,res)=>{
    try{
      res.setHeader('content-type','application/json');
      if(req.url.endsWith('/jwks'))return res.end(JSON.stringify({keys:[jwk]}));
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
      if(req.url.endsWith('/hosts/claims')){const claim={...body,challenge:randomUUID()};claims.set(body.claimId,claim);return res.end(JSON.stringify(claim));}
      if(req.url.endsWith('/confirm')){assert.ok(claims.has(body.claimId));return res.end('{"confirmed":true}');}
      if(req.url.endsWith('/hosts/revocations')){
        const eventToken=await new SignJWT({events:[],watermark:0}).setProtectedHeader({alg:'RS256',typ:'wm-cloud-revocations+jwt',kid:jwk.kid})
          .setIssuer(issuer).setAudience(`${base}/hosts/${body.hostId}`).setIssuedAt().setExpirationTime('300s').sign(signing.privateKey);
        return res.end(JSON.stringify({eventToken}));
      }
      res.end('{}');
    }catch{res.writeHead(500);res.end('{}');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${server.address().port}/personal/v1/cloud`;issuer=base+'/oidc';
  return {
    configuration:{issuer,allowInsecureLoopback:true},
    async bind(request){
      const before=await request('/auth/me');
      const claim=await request('/cloud/claims',{});
      const accessToken=await new SignJWT({sub:'fix8-cloud-synthetic',device_id:'fix8-control',auth_epoch:0,scope:'cloud:account'})
        .setProtectedHeader({alg:'RS256',typ:'at+jwt',kid:jwk.kid}).setIssuer(issuer).setAudience(base).setIssuedAt().setJti(randomUUID()).setExpirationTime('300s').sign(signing.privateKey);
      await request('/cloud/binding',{claimId:claim.claimId,accessToken});
      const after=await request('/auth/me');
      assert.equal(after.account.ownerId,before.account.ownerId);assert.equal(after.device.id,before.device.id);
      const binding=await request('/cloud/binding');assert.equal(binding.status,'active');
      return {ownerPreserved:true,devicePreserved:true,bound:true};
    },
    async close(){await new Promise(done=>{server.close(done);server.closeAllConnections();});}
  };
}
