// Synthetic model only, bound to loopback. Deterministic fixtures test mechanism, not model quality.
import {createServer} from 'node:http';import {once} from 'node:events';
let requests=0,streams=0,extractions=0,mode='ok',contexts=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/mode'){const chunks=[];for await(const c of req)chunks.push(c);mode=Buffer.concat(chunks).toString();res.end('ok');return;}
 if(req.url==='/report'){res.end(JSON.stringify({requests,streams,extractions,contexts}));return;}
 if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));requests++;
 const extraction=body.messages[0]?.content.includes('轻量记忆');
 if(extraction){
  extractions++;if(mode==='fail'){res.writeHead(503);res.end();return;}
  if(mode==='slow')await new Promise(r=>setTimeout(r,400));
  const input=JSON.parse(body.messages[1].content),upsert=[],invalidate=[];
  for(const m of input.原话){
   // These are labelled expectations, not an extraction algorithm.
   if(m.text.includes('坏输出')){res.end(JSON.stringify({choices:[{message:{content:'{broken'}}]}));return;}
   if(m.text.startsWith('我')||m.text.startsWith('请记住')){
    const previous=input.已有记忆.find(i=>i.text.includes('清淡'));
    upsert.push({id:m.text.includes('改成辣')?previous?.id:null,text:m.text,sourceIDs:[m.id],evidence:m.text});
   }
  }
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({upsert,invalidate})}}]}));return;
 }
 if(body.stream){streams++;contexts.push(body.messages[0].content);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'合成助手：我猜你住北京。'}}]})+'\n\ndata: [DONE]\n\n');return;}
 res.end(JSON.stringify({choices:[{message:{content:'你好'}}]}));
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
