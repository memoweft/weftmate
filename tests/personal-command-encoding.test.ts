import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommandBytes, adaptCommandCollector, installCommandEncoding } from '../src/plugins/personal-command-encoding.mjs';
const gbk=Buffer.from('d6d0cec4c3fcc1eeca e4b3f6'.replaceAll(' ',''),'hex');
test('GBK native output and existing UTF-8/English lines reach the model without replacement',()=>{
 const bytes=Buffer.concat([gbk,Buffer.from('\nEnglish output\n已有 UTF-8 中文输出\n')]);
 assert.equal(decodeCommandBytes(bytes,936).text,'中文命令输出\nEnglish output\n已有 UTF-8 中文输出\n');
});
test('incremental reads retain incomplete UTF-8 and GBK characters at raw byte offsets',()=>{
 const ambiguous=Buffer.from('c2a3d6d0cec4','hex');
 for(const bytes of [gbk,Buffer.from('已有 UTF-8 中文输出'),ambiguous]) {
  const reader:any={chunks:[],bytes:0,total:0,readFrom:()=>({text:'',nextOffset:0,lossy:false}),finalize:()=>({text:'',truncated:false}),seal(){}};
  adaptCommandCollector(reader,936);let offset=0,text='';
  for(const byte of bytes){reader.chunks.push(Buffer.from([byte]));reader.bytes++;reader.total++;const part=reader.readFrom(offset);text+=part.text;offset=part.nextOffset;}
  reader.seal();const final=reader.readFrom(offset);text+=final.text;
  assert.equal(text,bytes===gbk?'中文命令输出':bytes===ambiguous?'拢中文':'已有 UTF-8 中文输出');assert.equal(final.nextOffset,bytes.length);
  assert.equal(reader.finalize().text,text);
 }
});
test('shell adapter preserves truncation/spill facts and excludes protocol subprocesses',()=>{
 const make=()=>({chunks:[gbk],bytes:gbk.length,total:gbk.length+20,readFrom:()=>({text:gbk.toString('utf8'),nextOffset:gbk.length+20,lossy:true,spillPath:'synthetic.log'}),finalize:()=>({text:gbk.toString('utf8'),truncated:true,spillPath:'synthetic.log'}),seal(){}});
 const service:any={spawn:()=>({collected:{stdout:make(),stderr:make()}})}, original=service.spawn;
 const dispose=installCommandEncoding(service,{platform:'win32',codePage:936});
 const result=service.spawn({argv:['powershell.exe']}).collected.stdout;result.seal();
 assert.deepEqual(result.readFrom(0),{text:'中文命令输出',nextOffset:gbk.length+20,lossy:true,spillPath:'synthetic.log'});
 assert.deepEqual(result.finalize(),{text:'中文命令输出',truncated:true,spillPath:'synthetic.log'});
 assert.equal(service.spawn({argv:['node','memory-bridge.js']}).collected.stdout.readFrom(0).text,gbk.toString('utf8'));
 dispose();assert.equal(service.spawn,original);
});
