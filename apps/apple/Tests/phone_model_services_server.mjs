import http from 'node:http';
const report={catalogs:0,streams:0,models:[]};
const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/report'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(report));return;}
  if(req.url.endsWith('/models')){
    report.catalogs++;
    const status=req.url.startsWith('/auth/')?401:req.url.startsWith('/unsupported/')?404:200;
    res.writeHead(status,{'Content-Type':'application/json'});
    res.end(status===200?JSON.stringify({data:[{id:'mimo-v2.6-flash',capabilities:{vision:true},deepThinking:{supported:true}},{id:'mimo-v2.6-pro',capabilities:{vision:false}},{id:'text-embedding-3'}]}):'{}');return;
  }
  if(req.url==='/v1/chat/completions'){
    const payload=JSON.parse(body);report.models.push(payload.model);report.streams++;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:payload.model}}]})+'\n\n');
    setTimeout(()=>{res.end('data: [DONE]\n\n');},300);return;
  }
  res.writeHead(404);res.end('{}');
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`})+'\n'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
