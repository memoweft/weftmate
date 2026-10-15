// Isolated HTTP catalogue and delayed SSE; no account, computer or real provider.
import {createServer} from 'node:http';
import {once} from 'node:events';
const server=createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
 if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'synthetic-stream'}]}));return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 res.write('data: '+JSON.stringify({choices:[{delta:{content:'',role:'assistant',tool_calls:null,reasoning_content:null}}]})+'\n\n');
 const slow=body.messages.some(row=>typeof row.content==='string'&&row.content.includes('慢回复'));
 for(const content of slow?Array(20).fill('慢片段'):['第一片','、第二片','，Mac独立回复完成。']){
  if(res.destroyed)break;
  res.write('data: '+JSON.stringify({choices:[{delta:{content,tool_calls:null}}]})+'\n\n');
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 res.end('data: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
