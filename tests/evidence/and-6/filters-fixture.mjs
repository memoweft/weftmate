import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {startFeedFixture} from '../and-5/fixture.mjs';

/** Both page-filter comparisons use one synthetic account and the same six file projections. */
export async function startFiltersFixture(){
  const base=await startFeedFixture(),requests=[];
  const json=(res,b,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(b))};
  const rows=[['document','合成项目计划.md','text/markdown'],['spreadsheet','合成预算表.csv','text/csv'],['image','合成示意图.png','image/png'],['code','synthetic-example.py','text/x-python'],['other','合成资料.zip','application/zip'],['document','合成说明.txt','text/plain']].map(([type,fileName,contentType],n)=>({id:`synthetic-file-${n}`,type,fileName,contentType,size:128,createdAt:new Date().toISOString(),modifiedAt:new Date().toISOString(),exists:true,projectName:null,source:{kind:'artifact',sessionId:'session-11111111-1111-4111-8111-111111111111',taskId:'synthetic-task'}}));
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/personal/v1/library'){
      const auth=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});if(!auth.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      const type=u.searchParams.get('type');const items=type?rows.filter(r=>r.type===type):rows;requests.push({path:u.pathname,type});return json(res,{items,total:items.length,nextCursor:null,projects:[]});
    }
    const headers={};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','connection','content-length','transfer-encoding'].includes(k))headers[k]=v;
    const chunks=[];if(!['GET','HEAD'].includes(req.method))for await(const chunk of req)chunks.push(chunk);
    // A finite body prevents hop-by-hop chunked headers entering the inherited fixture proxy.
    const r=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}),redirect:'manual'});
    requests.push({path:u.pathname,method:req.method,status:r.status});
    const h=Object.fromEntries(r.headers);delete h['content-length'];delete h['content-encoding'];if(r.headers.getSetCookie().length)h['set-cookie']=r.headers.getSetCookie();res.writeHead(r.status,h);if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
  }catch{json(res,{error:{code:'FIXTURE_FAILED'}},500)}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close()}};
}
