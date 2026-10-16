// Real HTTP/SSE transport with synthetic model decisions. Never a personal service.
import {createServer} from 'node:http';
import {once} from 'node:events';
let mode='ok',contexts=[],extractions=0,chatRequests=[],extractionSources=[],extractionBackgrounds=[],held=[];
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 if(req.url==='/mode'){mode=Buffer.concat(chunks).toString();if(mode!=='hold'){for(const resolve of held)resolve();held=[];}res.end();return;}
 if(req.url==='/report'){res.end(JSON.stringify({contexts,extractions,chatRequests,extractionSources,extractionBackgrounds}));return;}
 if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);res.end();return;}
 const body=JSON.parse(Buffer.concat(chunks));
 if(!body.stream){
  extractions++;
  const input=JSON.parse(body.messages[1].content);extractionSources.push(input.原话.map(m=>m.id));
  extractionBackgrounds.push(input.对话背景 ?? []);
  if(mode==='hold')await new Promise(resolve=>held.push(resolve));
  if(mode==='fail'){res.writeHead(503);res.end();return;}
  if(mode==='slow')await new Promise(r=>setTimeout(r,200));
  if(mode==='malformed'){res.end(JSON.stringify({choices:[{message:{content:'{broken'}}]}));return;}
  const upsert=[],invalidate=[];
  let prior=input.已有记忆.find(x=>x.text.includes('测试花名'));
  for(const m of input.原话){
   if(m.text.includes('我长期学习日语'))upsert.push({id:null,text:'长期学习日语',sourceIDs:[m.id],evidence:'我长期学习日语'});
   if(m.text.includes('我不吃辣')){upsert.push({id:null,text:'用户不吃辣',sourceIDs:[m.id],evidence:m.text});continue;}
   if(m.text.includes('忘掉')){if(prior)invalidate.push({id:prior.id,sourceIDs:[m.id],evidence:m.text});}
   else if(m.text.includes('蓝色纸鹤')||m.text.includes('不对，是绿色纸鹤')){
    upsert.push({id:prior?.id??null,text:'测试花名是'+(m.text.includes('绿色')?'绿色纸鹤':'蓝色纸鹤'),sourceIDs:[m.id],evidence:m.text});
   }
  }
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({upsert,invalidate})}}]}));return;
 }
 const system=body.messages[0].content,content=body.messages.at(-1).content,query=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('\n');contexts.push(system);chatRequests.push(body.messages);
 const image=Array.isArray(content)&&content.some(p=>p.type==='image_url');
 const text=query.includes('12×13')?'重新计算：12×13 = 156。':query.includes('一周食谱')?'周一清淡蔬菜，周二豆腐，周三鱼，周四面条，周五鸡肉，周六米饭，周日汤；都不放辣。':query.includes('代码报错')?'missing 未定义，需要先声明变量。':image?'截图里有合成色块。':mode==='invent'?(system.includes('本机记忆里没有相关记录')&&system.includes('没有可调用的工具')?'没有相关记录':'<tool_call><function=check_memory></function></tool_call>'):query.includes('是什么')?(system.includes('绿色纸鹤')?'绿色纸鹤':system.includes('蓝色纸鹤')?'蓝色纸鹤':'没有相关记录'):system.includes('尚未确认')?'收到，先处理当前消息。':'收到。';
 res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
