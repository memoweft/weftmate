import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyForgetCandidates } from '../src/personal-memory/forget-model.mjs';

const request = { authorized:true, subject:'self', topic:'饮品偏好', originalMessage:'忘掉我的饮品偏好，但保留独立的散步事实。',
  revisionChains:[[{key:'cognition:old-red',text:'我喜欢红茶',graphSubject:'self'},{key:'cognition:new-green',text:'我其实更喜欢绿茶',graphSubject:'self'}]] };
const candidates = Array.from({length:49},(_,i)=>({key:i===0?'cognition:old-red':i===1?'cognition:new-green':`evidence:synthetic-${i.toString().padStart(3,'0')}`,kind:i<2?'cognition':'evidence',
  text:i===0?'我喜欢红茶':i===1?'我其实更喜欢绿茶':i===48?'我喜欢绿茶，也喜欢独立的散步。':'我喜欢喝什么？',graphSubject:i<2?'self':null,
  sourceTexts:[i===48?'我喜欢绿茶，也喜欢独立的散步。':i<2?'我喜欢红茶；后来纠正为绿茶。':'我喜欢喝什么？']}));
const decision=(row:any)=>({key:row.key,matchesTopic:true,subjects:['self'],targetSubjects:row.text.endsWith('？')?[]:['self'],hasTargetFact:!row.text.endsWith('？'),sourceFullyAuthorized:!row.text.includes('散步')});
const route={baseUrl:'https://synthetic.invalid/v1',model:'bounded-classifier',credential:'synthetic'};

test('candidate classification survives a bounded tool-output budget without dropping sources or authorization',async()=>{
 const original=globalThis.fetch,seen:string[]=[],requests:any[]=[];
 globalThis.fetch=async(_url:any,init:any)=>{
  const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content);requests.push(input);
  assert.deepEqual(input.request,request,'every batch retains the whole original authorization and actual revision links');
  const output=JSON.stringify({items:input.candidates.map(decision)});
  // A provider spends part of max_tokens on reasoning. The remaining tool
  // output budget can truncate a large set of otherwise short input records.
  if(output.length>3000)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:output.slice(0,3000)}}]}));
  seen.push(...input.candidates.map((r:any)=>r.key));
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'classify_forget_candidates',arguments:output}}]}}]}));
 };
 try{
  const result=await classifyForgetCandidates(route,request,candidates);
  assert.equal(result.size,49);assert.deepEqual(seen,candidates.map(r=>r.key));assert.ok(requests.length>1);
  assert.equal(result.get('evidence:synthetic-048').sourceFullyAuthorized,false);
  assert.equal(result.get('evidence:synthetic-002').hasTargetFact,false);
 }finally{globalThis.fetch=original;}
});

test('an invalid later candidate batch fails the whole decision instead of returning a partial deletion scope',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url:any,init:any)=>{calls++;const body=JSON.parse(init.body),rows=JSON.parse(body.messages.at(-1).content).candidates;
  const items=rows.map(decision);if(rows.some((r:any)=>r.key==='evidence:synthetic-048'))items.pop();
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'classify_forget_candidates',arguments:JSON.stringify({items})}}]}}]}));};
 try{await assert.rejects(classifyForgetCandidates(route,request,candidates),{code:'MEMORY_FORGET_DECISION_INVALID'});assert.ok(calls>1,'exercise a later batch after earlier results');}
 finally{globalThis.fetch=original;}
});
