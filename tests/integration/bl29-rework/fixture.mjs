import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
function source(file){const url=pathToFileURL(resolve(file));return readFileSync(url,'utf8').replaceAll('import.meta.url',JSON.stringify(url.href)).replace(/from (['"])(\.\.?\/[^'"]+)\1/g,(_,q,p)=>`from '${new URL(p,url).href}'`);}
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
let service=source('src/personal-access/index.mjs').replace('const service = {','const service = { __reviewContext:context,__reviewCounts:()=>({accountWaiters:accountWaiters.size,accountRevision}),');
service=service.replace('const changeKey =','const __reviewDigests=[]; const changeKey =')
 .replace("=> createHmac('sha256', changeKey)","=> (__reviewDigests.push(field), createHmac('sha256', changeKey))")
 .replace('__reviewContext:context,','__reviewContext:context,__reviewDigests:()=>__reviewDigests,');
let fixture=source('tests/integration/timeline-ui-candidate.mjs').replace(pathToFileURL(resolve('src/personal-access/index.mjs')).href,data(service)).replace('return { root, origin,','return { root, origin, debug:{backend,service,eventWaiters,auth,cookie},');
export const {startTimelineCandidate}=await import(data(fixture));
