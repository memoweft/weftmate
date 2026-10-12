// Reuses APPLE-2's real cloud login, file mail and isolated personal service.
// This test-only HTTP hook observes aggregate PUTs and models one unavailable computer.
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { validateHealthPartition } from '../../../src/personal-access/daily-digest.mjs';
import { observeBody } from './health1_observe_body.mjs';
let offline = false, hostOrigin, auth, requests = [], responses = [], failures = 0, remoteChecks = 0;
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
    if(event !== 'request') return emit.call(this,event,...args);
    const [req,res] = args, path = new URL(req.url,'http://127.0.0.1').pathname;
    if(path.startsWith('/health1/')) {
        (async()=>{
            let result;
            if(path === '/health1/offline') { offline=true; result={ok:true}; }
            else if(path === '/health1/online') { offline=false; result={ok:true}; }
            else if(path === '/health1/report') {
                let items=[];
                if(auth) {
                    const response=await fetch(hostOrigin+'/personal/v1/daily-summaries',{headers:auth});
                    if(!response.ok)throw Error('GET daily summaries failed');
                    items=(await response.json()).items;remoteChecks++;
                }
                const keys=['version','status','steps','sleepMinutes','restingHeartRateBpm','exerciseMinutes','workouts'];
                result={requests:requests.length,responses,failures,remoteChecks,contractOnly:requests.every(r=>{validateHealthPartition(r.health);return Object.keys(r.health).length===keys.length&&keys.every(k=>Object.hasOwn(r.health,k));}),
                    available:requests.filter(r=>r.health.status==='available').length,unavailable:requests.filter(r=>r.health.status==='unavailable').length,
                    items:items.map(r=>({day:r.day,health:r.health})),sent:requests.map(r=>({day:r.day,health:r.health}))};
            } else throw Error('Unknown health driver action');
            res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
        })().catch(()=>{res.writeHead(500);res.end('{}');});return true;
    }
    if(path.startsWith('/personal/v1/')&&!path.startsWith('/personal/v1/cloud/')) {
        // Preserve actual authentication and server validation in all online requests.
        if(offline && ['/personal/v1/daily-summaries','/personal/v1/settings/usage','/personal/v1/settings/notifications'].some(p=>path.startsWith(p))) {
            failures++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"UNAVAILABLE"}}');return true;
        }
        const match=/^\/personal\/v1\/daily-summaries\/(\d{4}-\d{2}-\d{2})\/health$/.exec(path);
        if(match && req.method==='PUT') {
            res.once('finish',()=>responses.push({day:match[1],status:res.statusCode}));
            hostOrigin=req.headers.origin;auth={origin:hostOrigin,cookie:req.headers.cookie};
            observeBody(req, bytes => {
                const health=JSON.parse(bytes);
                requests.push({day:match[1],health});
            });
        }
    }
    return emit.call(this,event,...args);
};
syncBuiltinESMExports();
await import('./apple2_cloud_fixture.mjs');
