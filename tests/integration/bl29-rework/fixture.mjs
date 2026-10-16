import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMobileCloud, authorizeMobile} from './auth.mjs';
function source(file){const url=pathToFileURL(resolve(file));return readFileSync(url,'utf8').replaceAll('import.meta.url',JSON.stringify(url.href)).replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,q,p)=>`from '${new URL(p,url).href}'`);}
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
let service=source('src/personal-access/index.mjs').replace('const service = {','const service = { __reviewServer:()=>server,__reviewContext:context,__reviewCounts:()=>({accountWaiters:accountWaiters.size,accountRevision}),');
service=service.replace('const changeKey =','const __reviewDigests=[]; const changeKey =')
 .replace("=> createHmac('sha256', changeKey)","=> (__reviewDigests.push(field), createHmac('sha256', changeKey))")
 .replace('__reviewContext:context,','__reviewContext:context,__reviewDigests:()=>__reviewDigests,');
// Observe the original handler's own Promise, after its route finally blocks.
// Return it unchanged; a response close alone is not handler completion.
service=service.replace('const { handle, handleScoped } = http;', `const { handle: reviewHandle, handleScoped } = http;
  function handle(...args) {
    const work = Reflect.apply(reviewHandle, this, args);
    service.__reviewOnHttp?.(...args, work);
    return work;
  }`);
let fixture=source('tests/integration/timeline-ui-candidate.mjs').replace(pathToFileURL(resolve('src/personal-access/index.mjs')).href,data(service))
 .replace('backend, backupManager, libraryNativeActions:', 'backend, cloudIdentity:options.cloudIdentity??null, backupManager, libraryNativeActions:')
 .replace("const command = async (body, route = '/commands') =>", "const command = async (body, route = '/commands', requestForCommand = request) =>")
 .replace("const value = await request(route, body);", "const value = await requestForCommand(route, body);")
 .replace("await request(`/commands/${value.command.commandId}`)", "await requestForCommand(`/commands/${value.command.commandId}`)");
const bridgeStart=fixture.indexOf('  const bridge = async'),bridgeEnd=fixture.indexOf('  if (options.usageSamples)',bridgeStart);
fixture=fixture.slice(0,bridgeStart)+'  let mobileRequest=request, mobileAuth=auth; const mobileCommand=(body,route)=>command(body,route,mobileRequest);\n'+
 fixture.slice(bridgeStart,bridgeEnd).replace(/\brequest\(/g,'mobileRequest(').replace(/\bcommand\(/g,'mobileCommand(').replace(/\bauth\./g,'mobileAuth.')+fixture.slice(bridgeEnd);
fixture=fixture.replace('return { root, origin,','return { root, origin, setMobileTransport:(request,auth)=>{mobileRequest=request;mobileAuth=auth;},debug:{backend,service,eventWaiters,auth,cookie},');
const {startTimelineCandidate:startIsolatedTimelineCandidate}=await import(data(fixture));
export async function startTimelineCandidate(options={}) {
 let cloud,fixture;
 try {
  if(options.cloudMobile)cloud=await createMobileCloud();
  fixture=await startIsolatedTimelineCandidate({...options,...(cloud?{cloudIdentity:cloud.configuration}:{})});
  if(options.quietCatalog)await fixture.debug.service.__reviewContext.activity.close();
  if(cloud){await authorizeMobile(fixture,cloud.cloud);const close=fixture.close;fixture.close=async()=>{try{await close();}finally{await cloud.close();}};}
  return fixture;
 }catch(error){try{await fixture?.close();}finally{await cloud?.close();}throw error;}
}

export function observeTimelineHttp(fixture, pathname) {
 const requests=[],waiters=[];let completed=0;
 const wake=()=>{for(const waiter of waiters.splice(0))waiter();};
 fixture.debug.service.__reviewOnHttp=(request,response,work)=>{
  if(request.method!=='GET'||request.url!==pathname)return;
  let close;const closed=new Promise(resolve=>{close=resolve;});
  response.once('close',()=>close());
  const row={work:Promise.resolve(work),closed,failed:false,error:undefined};requests.push(row);
  // Both callbacks only record completion. The original rejected Promise is
  // retained and rethrown by waitForCompleted, rather than swallowed.
  row.work.then(()=>{completed++;wake();},error=>{row.failed=true;row.error=error;completed++;wake();});
 };
 return {
  get started(){return requests.length;},get completed(){return completed;},
  closed:()=>Promise.all(requests.map(row=>row.closed)),
  async waitForCompleted(count){
   while(completed<count)await new Promise(resolve=>waiters.push(resolve));
   for(const row of requests)if(row.failed)throw row.error;
  },
 };
}
