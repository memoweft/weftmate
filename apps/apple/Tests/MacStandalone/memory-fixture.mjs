// Real HTTP/SSE transport with synthetic model decisions. Never a personal service.
import {createServer} from 'node:http';
import {once} from 'node:events';
let mode='ok',contexts=[],extractions=0;
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 if(req.url==='/mode'){mode=Buffer.concat(chunks).toString();res.end();return;}
 if(req.url==='/report'){res.end(JSON.stringify({contexts,extractions}));return;}
 if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
 const body=JSON.parse(Buffer.concat(chunks));
 if(!body.stream){
  extractions++;
  if(mode==='fail'){res.writeHead(503);res.end();return;}
  if(mode==='slow')await new Promise(r=>setTimeout(r,200));
  if(mode==='malformed'){res.end(JSON.stringify({choices:[{message:{content:'{broken'}}]}));return;}
  const input=JSON.parse(body.messages[1].content),upsert=[],invalidate=[];
  let prior=input.已有记忆.find(x=>x.text.includes('测试花名'));
  for(const m of input.原话){
   if(m.text.includes('忘掉')){if(prior)invalidate.push({id:prior.id,sourceIDs:[m.id],evidence:m.text});}
   else if(m.text.includes('蓝色纸鹤')||m.text.includes('不对，是绿色纸鹤')){
    upsert.push({id:prior?.id??null,text:'测试花名是'+(m.text.includes('绿色')?'绿色纸鹤':'蓝色纸鹤'),sourceIDs:[m.id],evidence:m.text});
   }
  }
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({upsert,invalidate})}}]}));return;
 }
 const system=body.messages[0].content,query=body.messages.at(-1).content;contexts.push(system);
 const text=mode==='invent'?'记忆里还有虚构的名字小明。':query.includes('是什么')?(system.includes('绿色纸鹤')?'绿色纸鹤':system.includes('蓝色纸鹤')?'蓝色纸鹤':'没有相关记录'):'我记下了。';
 res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
