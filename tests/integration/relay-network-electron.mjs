import { app, session, net } from 'electron';
import { createServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { syntheticCertificate } from '../helpers/r0-2-certificates.mjs';
import { createDesktopRelayNetwork } from '../../src/personal-relay/desktop-network.mjs';
import { frpcConfig } from '../../src/personal-relay/index.mjs';

app.setPath('userData',process.env.WEFTMATE_PROXY_TEST_PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('host-resolver-rules','MAP direct.invalid 127.0.0.1, MAP second-direct.invalid 127.0.0.1');
for(const s of [process.stdout,process.stderr])s.on('error',()=>{});
app.whenReady().then(async()=>{
 let network,proxy,origin,secure;const sockets=new Set();
 const mode=process.env.WEFTMATE_PROXY_TEST_MODE;
 const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
 const track=s=>{s.on('connection',c=>{sockets.add(c);c.once('close',()=>sockets.delete(c))});return s;};
 try {
  const hits=[];
  proxy=track(createServer((req,res)=>{
    hits.push(req.url);
    if(mode==='auth'&&req.headers['proxy-authorization']!=='Basic '+Buffer.from('synthetic-user:synthetic-pass').toString('base64')){
      res.writeHead(407,{'proxy-authenticate':'Basic realm="synthetic"'});res.end();return;
    }
    assert.equal(req.headers.cookie,undefined);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({via:'synthetic-proxy'}));
  }));
  await listen(proxy);
  const proxyUrl=`http://127.0.0.1:${proxy.address().port}`;
  let env={HTTP_PROXY:proxyUrl,HTTPS_PROXY:proxyUrl};
  if(mode==='system'||mode.startsWith('system-')){await session.defaultSession.setProxy({mode:'fixed_servers',proxyRules:proxyUrl,proxyBypassRules:'<-loopback>'});env={};}
  if(mode==='system-bypass-all')env.NO_PROXY='*';
  if(mode==='system-bypass-multiple')env.NO_PROXY=' direct.invalid, second-direct.invalid ; unused.invalid ';
  if(mode==='direct'){await session.defaultSession.setProxy({mode:'direct'});env={};}
  if(mode==='auth')env={HTTPS_PROXY:proxyUrl,HTTP_PROXY:proxyUrl.replace('http://','http://synthetic-user:synthetic-pass@')};
  if(mode==='bypass')env.NO_PROXY='direct.invalid';
  if(mode==='bypass-multiple')env.NO_PROXY=' direct.invalid, second-direct.invalid ; unused.invalid ';
  if(mode==='socks-portless')env={HTTPS_PROXY:'socks5://synthetic-user:synthetic-pass@proxy.invalid'};
  if(['direct','bypass','bypass-multiple','system-bypass-all','system-bypass-multiple','system-local','env-local'].includes(mode)){
    origin=track(createServer((req,res)=>res.end('direct')));await listen(origin);
  }
  if(mode==='tls-reject'){
    const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    secure=track(httpsServer({key:privateKey.export({format:'pem',type:'pkcs8'}),cert:syntheticCertificate(false,privateKey)},(req,res)=>res.end('untrusted')));await listen(secure);
    proxy.on('connect',(req,client,head)=>{hits.push(req.url);const upstream=connect(secure.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});sockets.add(upstream);upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());});
  }
  if(mode==='unreachable'){await new Promise(r=>proxy.close(r));}
  let proxyConfig;
  const sessionApi={defaultSession:session.defaultSession,fromPartition(...args){
    const real=session.fromPartition(...args);
    real.webRequest.onErrorOccurred(detail=>console.error('CHROMIUM_NETWORK_ERROR', /^net::ERR_[A-Z0-9_]+$/.test(detail.error)?detail.error:'REQUEST_FAILED'));
    const setProxy=real.setProxy.bind(real);
    real.setProxy=async config=>{if(config.proxyRules?.includes(proxyUrl))proxyConfig=config;await setProxy(config);};
    return real;
  }};
  let challenged=false;
  const requestApi=mode==='socks-portless'?{request(){
    const req=new EventEmitter();req.abort=()=>{};
    req.end=()=>queueMicrotask(()=>req.emit('login',{isProxy:true,host:'proxy.invalid',port:1080},(username,password)=>{
      challenged=true;assert.equal(username,'synthetic-user');assert.equal(password,'synthetic-pass');
      const response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/json'};
      req.emit('response',response);response.end('{"authenticated":true}');
    }));return req;
  }}:net;
  network=await createDesktopRelayNetwork({session:sessionApi,net:requestApi,env});
  if(mode==='bypass-multiple')assert.ok(proxyConfig.proxyBypassRules.startsWith('<-loopback>,direct.invalid,second-direct.invalid,unused.invalid,'),'Electron bypass contract uses commas');
  if(mode==='socks-portless'){
    const proxyUrl=await network.proxyFor('https://relay.invalid');
    assert.equal(proxyUrl,'socks5://synthetic-user:synthetic-pass@proxy.invalid:1080');
    const config=frpcConfig({credentials:{baseUrl:'https://content.invalid',serverAddr:'relay.invalid',serverName:'relay.invalid',serverPort:443,hostId:'synthetic',credential:'synthetic'},localPort:1,transportCaFile:'synthetic',adminPort:2,adminPassword:'synthetic',proxyUrl});
    assert.ok(config.includes('transport.proxyURL = "socks5://synthetic-user:synthetic-pass@proxy.invalid:1080"'));
    assert.deepEqual(await (await network.fetch('https://certificate.invalid')).json(),{authenticated:true});assert.equal(challenged,true);
  } else if(['tls-reject','unreachable'].includes(mode)){
    await assert.rejects(network.fetch(mode==='tls-reject'?'https://r0-2.invalid/':'http://certificate.invalid/directory',{signal:AbortSignal.timeout(3000)}),e=>e.code==='NETWORK_UNAVAILABLE');
    if(mode==='tls-reject')assert.equal(hits[0],'r0-2.invalid:443');
  } else if(['direct','bypass','bypass-multiple','system-bypass-all','system-bypass-multiple','system-local','env-local'].includes(mode)) {
    const local=mode.endsWith('-local');
    // Check relay routing first: the review's exact NO_PROXY=* reproducer.
    if(mode==='system-bypass-all')assert.equal(await network.proxyFor('https://relay.invalid'),null);
    if(local)for(const host of ['localhost','child.localhost','localhost.','child.localhost.','127.0.0.1','127.255.255.254','10.1.2.3','172.16.0.1','172.31.255.254','192.168.5.2','169.254.1.2','[::1]','[fc00::1]','[fdff::1]','[fe80::1]','[febf::1]','[::ffff:127.0.0.1]','[::ffff:10.1.2.3]','[::ffff:172.16.1.2]','[::ffff:192.168.1.2]','[::ffff:169.254.1.2]']){
      assert.equal(await network.proxyFor(`https://${host}:443`),null,`${host} must explicitly bypass ${mode}`);
    }
    if(local)for(const host of ['9.255.255.255','11.0.0.1','172.15.255.255','172.32.0.1','192.169.0.1','169.253.1.2','[2001:db8::1]','[fec0::1]']){
      assert.equal(await network.proxyFor(`https://${host}:443`),proxyUrl,`${host} must retain the proxy`);
    }
    const url=`http://${local?'127.0.0.1':'direct.invalid'}:${origin.address().port}/`;
    assert.equal(await (await network.fetch(url,{signal:AbortSignal.timeout(3000)})).text(),'direct');
    assert.equal(await network.proxyFor(url),null);assert.equal(hits.length,0);
    if(mode==='bypass-multiple'||mode==='system-bypass-multiple'){
      const second=`http://second-direct.invalid:${origin.address().port}/`;
      assert.equal(await(await network.fetch(second,{signal:AbortSignal.timeout(3000)})).text(),'direct');
      assert.equal(await network.proxyFor(second),null);assert.equal(hits.length,0);
      assert.equal((await(await network.fetch('http://certificate.invalid/directory')).json()).via,'synthetic-proxy');assert.equal(hits.length,1);
    }
  } else {
    const response=await network.fetch('http://certificate.invalid/directory',{signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,200);assert.equal((await response.json()).via,'synthetic-proxy');
    assert.ok(hits.every(u=>u==='http://certificate.invalid/directory'));assert.ok(hits.length>=1);
    assert.equal(await network.proxyFor('https://relay.invalid:443'),proxyUrl);
  }
  console.log('RELAY_PROXY_ENV_PASS '+mode);
 } catch(error) { console.error(error);process.exitCode=1; }
 finally {await network?.close();for(const socket of sockets)socket.destroy();for(const s of [proxy,origin,secure])if(s?.listening)await new Promise(r=>s.close(r));app.exit(process.exitCode||0);}
});
