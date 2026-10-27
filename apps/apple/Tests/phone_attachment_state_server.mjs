import {createServer} from 'node:http';
import {once} from 'node:events';
const requests=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/report'){res.setHeader('content-type','application/json');res.end(JSON.stringify(requests));return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));requests.push(body);
 if(body.model==='reject-images') {res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'This model does not support image_url inputs'}}));return;}
 if(!body.stream){res.writeHead(400);res.end('Unexpected non-chat request');return;}
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.end('data: '+JSON.stringify({choices:[{delta:{content:'合成模型已收到图片和文件。'}}]})+'\n\ndata: [DONE]\n\n');
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
