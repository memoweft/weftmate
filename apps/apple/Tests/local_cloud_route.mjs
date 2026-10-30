import {createServer} from 'node:http';
import {once} from 'node:events';

// Real cloud authentication and host exchange; only relay discovery is routed
// to this fixture's local listener, as in apple2_cloud_fixture.mjs.
export async function localCloudRoute({origin,upstreamPort,hostOrigin,offline=()=>false,dropConnections=()=>false,audit=[]}) {
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Local fixture origin required');
  const server=createServer(async(req,res)=>{
    if(dropConnections()){req.socket.destroy();return;}
    try {
      const body=[];for await(const chunk of req)body.push(chunk);
      const reply=await fetch(`http://127.0.0.1:${upstreamPort}${req.url}`,{method:req.method,redirect:'manual',
        headers:{...req.headers,'x-forwarded-host':url.host,'x-forwarded-proto':'http'},
        ...(body.length?{body:Buffer.concat(body)}:{})});
      const path=new URL(req.url,origin).pathname;audit.push({path,status:reply.status});
      let bytes=Buffer.from(await reply.arrayBuffer());
      if(path==='/personal/v1/cloud/hosts/connect'&&reply.ok&&hostOrigin()) {
        const value=JSON.parse(bytes);value.baseUrl=offline()?null:hostOrigin();value.status=offline()?'offline':'online';
        bytes=Buffer.from(JSON.stringify(value));
      }
      const headers=Object.fromEntries([...reply.headers].filter(([key])=>!['content-length','content-encoding','transfer-encoding','set-cookie'].includes(key)));
      const cookies=reply.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
      res.writeHead(reply.status,headers);res.end(bytes);
    } catch {res.writeHead(503);res.end();}
  });
  server.listen(Number(url.port),'127.0.0.1');await once(server,'listening');
  return {close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
