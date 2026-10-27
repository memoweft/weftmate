// Synthetic HTTP/SSE model. Every model request is counted, including unexpected background calls.
import {createServer} from 'node:http';
import {once} from 'node:events';
let requests=0, streams=0, nonStreaming=0, contexts=[];
const server=createServer(async(req,res)=>{
  if(req.url==='/report'){res.end(JSON.stringify({requests,streams,nonStreaming,contexts}));return;}
  if(req.url!=='/v1/chat/completions'||req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks));requests++;
  contexts.push(body.messages[0]?.content ?? '');
  if(!body.stream){nonStreaming++;res.writeHead(400);res.end();return;}
  streams++;res.writeHead(200,{'content-type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'合成普通聊天回复。'}}]})+'\n\ndata: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
