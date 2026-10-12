// Reuses APPLE-2's real cloud login, file mail and isolated personal service.
// HEALTH-4: authentication remains real; health routes emulate the documented v2 computer until HEALTH-2 merges.
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { validateHealthRecord } from './health4_validate_record.mjs';
const healthRecords=new Map();
const verifiedSessions=new Map();
let offline = false, hostOrigin, auth, requests = [], responses = [], failures = 0, remoteChecks = 0;
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
    if(event !== 'request') return emit.call(this,event,...args);
    const [req,res] = args, path = new URL(req.url,'http://127.0.0.1').pathname;
    if(path==='/personal/v1/auth/me') {
        // Observe the actual host's successful verification without changing its request or response.
        const finish=res.end;
        res.end=function(chunk,...rest){
            if(this.statusCode===200 && chunk && req.headers.cookie){
                try { const value=JSON.parse(String(chunk));if(value.csrfToken)verifiedSessions.set(req.headers.cookie,value.csrfToken); } catch {}
            }
            return finish.call(this,chunk,...rest);
        };
    }
    if(path.startsWith('/health1/')) {
        (async()=>{
            let result;
            if(path === '/health1/offline') { offline=true; result={ok:true}; }
            else if(path === '/health1/online') { offline=false; result={ok:true}; }
            else if(path === '/health1/report') {
                const items=[...healthRecords].map(([day,health])=>({day,health}));remoteChecks++;
                result={requests:requests.length,responses,failures,remoteChecks,contractOnly:requests.every(r=>{validateHealthRecord(r.health,2);return true;}),healthV2ContractFixture:true,
                    available:requests.filter(r=>r.health.status==='available').length,unavailable:requests.filter(r=>r.health.status==='unavailable').length,
                    items:items.map(r=>({day:r.day,health:r.health})),sent:requests.map(r=>({day:r.day,health:r.health}))};
            } else throw Error('Unknown health driver action');
            res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
        })().catch(error=>{process.stderr.write('Health1 fixture driver: '+error.message+'\n');res.writeHead(500);res.end('{}');});return true;
    }
    if(path.startsWith('/personal/v1/')&&!path.startsWith('/personal/v1/cloud/')) {
        // Preserve actual authentication and server validation in all online requests.
        if(offline && ['/personal/v1/daily-summaries','/personal/v1/settings/usage','/personal/v1/settings/notifications'].some(p=>path.startsWith(p))) {
            failures++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"UNAVAILABLE"}}');return true;
        }
        const match=/^\/personal\/v1\/daily-summaries\/(\d{4}-\d{2}-\d{2})\/health$/.exec(path);
        if(path==='/personal/v1/health/overview') {
            const day=new Intl.DateTimeFormat('en-CA').format(new Date());
            res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({day,connected:[...healthRecords.values()].some(h=>h.status==='available'),updatedAt:null,capabilities:{record:2,profile:false},insight:null,recovery:null,sleep:null,load:null,vitals:{},activity:null,usage:null}));return true;
        }
        if((match && req.method==='PUT')||(path==='/personal/v1/daily-summaries'&&req.method==='GET')) {
            (async()=>{
                if(req.headers.origin)hostOrigin=req.headers.origin;auth={origin:hostOrigin,cookie:req.headers.cookie};
                const csrf=verifiedSessions.get(req.headers.cookie);
                if(!csrf){res.writeHead(401);res.end('{}');return;}
                let body;
                if(match){
                    if(req.headers['x-weftmate-csrf']!==csrf)throw Error('Invalid synthetic CSRF');
                    let text='';for await(const chunk of req)text+=chunk;
                    const health=validateHealthRecord(JSON.parse(text),2);healthRecords.set(match[1],health);
                    requests.push({day:match[1],health});responses.push({day:match[1],status:200});body={day:match[1],health};
                }else body={items:[...healthRecords].map(([day,health])=>({day,health}))};
                res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));
            })().catch(error=>{process.stderr.write('Health1 fixture health route: '+error.message+'\n');res.writeHead(400);res.end('{"error":{"code":"INVALID_REQUEST"}}');});return true;
        }
    }
    return emit.call(this,event,...args);
};
syncBuiltinESMExports();
await import('./apple2_cloud_fixture.mjs');
