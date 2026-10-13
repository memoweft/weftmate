import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {createServer,request as httpRequest} from 'node:http';
import {writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
function crc(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function png(){const w=320,h=200,header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*(w*3+1)+1+x*3;const sky=y<h/2;pixels[p]=sky?180:92;pixels[p+1]=sky?204:132;pixels[p+2]=sky?210:104;}
 const chunk=(name,data)=>{const type=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([head,type,data,tail]);};
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
function pdf(){const streams=['BT /F1 24 Tf 48 700 Td (Synthetic reading - page 1) Tj 0 -45 Td /F1 14 Tf (This document contains fictional test content.) Tj ET','BT /F1 24 Tf 48 700 Td (Synthetic reading - page 2) Tj ET'];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let result='%PDF-1.4\n',offsets=[0];objects.forEach((o,n)=>{offsets.push(Buffer.byteLength(result));result+=`${n+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(result);}
export async function startAnd7Fixture(){
 const candidate=await startTimelineCandidate({daily:true,logicalMobile:true,inlineProgress:true});
 const root=join(candidate.root,'and7-files');await mkdir(root);
 const markdown='# 虚构周计划\n\n这份计划仅供测试，**保留休息**，也要*慢慢来*。\n\n- 阅读一本虚构小说\n- 整理合成记录\n\n## 时间安排\n\n| 项目 | 时间 |\n| --- | --- |\n| 阅读 | 今天 9:00 |\n| 散步 | 今天 17:00 |\n\n[示例链接](https://example.com)\n\n```python\nprint("synthetic example")\n```\n';
 const outputs=new Map();for(const [name,bytes] of [['虚构周计划.md',Buffer.from(markdown)],['虚构便签.txt',Buffer.from('虚构便签\n\n请给自己留一点休息时间。\n这些文字可以选择、复制。')],['synthetic-example.py',Buffer.from('# fictional test only\nfor day in range(7):\n    print(day)\n')],['虚构风景.png',png()],['虚构阅读.pdf',pdf()],['虚构文档.docx',Buffer.from([80,75,3,4,0,1,2,3])]]){
  const source=await candidate.newOutputSource('创建虚构文件：'+name);const file=join(root,name);await writeFile(file,bytes);const artifact=await candidate.registerOutput(file,source);candidate.finishOutputSource(source);outputs.set(name,artifact.artifactId);
 }
 let mode='normal';
 const proxy=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/and7-control'){mode=url.searchParams.get('mode');res.end('ok');return;}
  const list=url.pathname==='/personal/v1/library';const preview=/^\/personal\/v1\/library\/[^/]+\/preview$/.test(url.pathname);
  if(list && mode==='empty'){res.setHeader('content-type','application/json');res.end(JSON.stringify({items:[],projects:[],total:0,nextCursor:null}));return;}
  if(list && mode==='loading'){setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({items:[],projects:[],total:0,nextCursor:null}));},5000);return;}
  if(preview && mode==='file-loading'){setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({kind:'text',text:'虚构便签',item:{fileName:'虚构便签.txt',size:12}}));},5000);return;}
  if(list && mode==='error'||preview&&mode==='file-error'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'HOST_UNAVAILABLE'}}));return;}
  if(preview&&mode==='missing'){res.setHeader('content-type','application/json');res.end(JSON.stringify({kind:'missing',item:{fileName:'虚构便签.txt',exists:false}}));return;}
  const upstream=httpRequest(candidate.origin+req.url,{method:req.method,headers:{...req.headers,host:new URL(candidate.origin).host,...(req.headers.origin?{origin:req.headers.origin.replace(proxyOrigin,candidate.origin)}:{})}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'HOST_UNAVAILABLE'}}));});req.pipe(upstream);
 });
 await new Promise(done=>proxy.listen(0,'127.0.0.1',done));const proxyOrigin=`http://127.0.0.1:${proxy.address().port}`;
 return {origin:proxyOrigin,credentials:candidate.credentials,outputs:Object.fromEntries(outputs),close:async()=>{await new Promise(done=>proxy.close(done));await candidate.close();await rm(candidate.root,{recursive:true,force:true});}};
}
