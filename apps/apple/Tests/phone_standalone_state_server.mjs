// Isolated model HTTP/SSE. No cloud, real credentials, user files or model provider.
import {createServer} from 'node:http';
import {once} from 'node:events';
let requests=0,streams=0;
const server=createServer(async(req,res)=>{
 if(req.url==='/report'){res.setHeader('content-type','application/json');res.end(JSON.stringify({requests,streams}));return;}
 if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));requests++;
 if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'你好。'}}]}));return;}
 streams++;res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const slow=body.messages.some(m=>m.content.includes('慢回复'));
 const parts=slow?Array(40).fill('慢片段') : ['第一片','、第二片','，手机独立回复完成。'];
 for(const part of parts){if(res.destroyed)break;res.write('data: '+JSON.stringify({choices:[{delta:{content:part}}]})+'\n\n');await new Promise(r=>setTimeout(r,slow?100:80));}
 res.end('data: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
