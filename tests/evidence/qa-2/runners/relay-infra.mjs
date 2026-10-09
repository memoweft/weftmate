import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=await mkdtemp('/tmp/weftmate-qa2-relay-'),procs=[];
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const ports={};for(const k of ['frps','https','control','content','plugin','front'])ports[k]=await port();
const env={CLOUD_RELAY_DOMAIN:'hosts.example.com',CLOUD_RELAY_SERVER_NAME:'relay.example.com',CLOUD_RELAY_FRPS_PORT:String(ports.frps),CLOUD_RELAY_FRPS_HTTPS_PORT:String(ports.https),CLOUD_RELAY_CONTROL_PORT:String(ports.control),CLOUD_RELAY_CONTENT_PORT:String(ports.content),CLOUD_RELAY_PLUGIN_PORT:String(ports.plugin)};
try{
await writeFile(root+'/transport.cnf','[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=relay.example.com\n[ext]\nsubjectAltName=DNS:relay.example.com\nbasicConstraints=critical,CA:TRUE\n');
await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',root+'/key.pem','-out',root+'/cert.pem','-days','2','-config',root+'/transport.cnf']);
await writeFile(root+'/frps.toml',`bindAddr="127.0.0.1"\nbindPort=${ports.frps}\nproxyBindAddr="127.0.0.1"\nvhostHTTPSPort=${ports.https}\ntransport.tls.force=true\ntransport.tls.certFile="${root}/cert.pem"\ntransport.tls.keyFile="${root}/key.pem"\ntransport.tcpMux=true\nlog.level="error"\n[[httpPlugins]]\nname="weftmate"\naddr="127.0.0.1:${ports.plugin}"\npath="/frp/plugin"\nops=["Login","NewProxy","Ping","NewWorkConn","NewUserConn"]\n`);
let cfg=await readFile('services/cloud/deploy/haproxy.cfg','utf8');cfg=cfg.replace(' send-proxy-v2','').replace('bind :443',`bind 0.0.0.0:${ports.front}`).replace('127.0.0.1:7001',`127.0.0.1:${ports.control}`).replace('127.0.0.1:7444',`127.0.0.1:${ports.content}`);await writeFile(root+'/haproxy.cfg',cfg);
for(const [file,args] of [['.local/frp/frp_0.71.0_linux_amd64/frps',['-c',root+'/frps.toml']],['/usr/sbin/haproxy',['-db','-f',root+'/haproxy.cfg']]]){const p=spawn(file,args,{stdio:['ignore','ignore','pipe']});p.stderr.on('data',()=>{});procs.push(p);}
console.log(JSON.stringify({root,ports,env}));process.stdin.resume();await new Promise(r=>process.stdin.on('end',r));
}finally{for(const p of procs)p.kill('SIGTERM');await new Promise(r=>setTimeout(r,700));for(const p of procs)if(p.exitCode===null)p.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
