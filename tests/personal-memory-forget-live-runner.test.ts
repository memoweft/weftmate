import assert from 'node:assert/strict'
import test from 'node:test'
import {createServer} from 'node:http'
import {spawn,execFileSync} from 'node:child_process'
import {mkdtemp,readFile,readdir,rm,realpath,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const runner=fileURLToPath(new URL('./live/forget-chat-scope.test.mjs',import.meta.url))
const fixtures=JSON.parse(await readFile(new URL('./fixtures/forget-intent-chat-scope.json',import.meta.url),'utf8'))
async function invoke(extra:Record<string,string>={}) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('WEFTMATE_LIVE_')&&key!=='WEFTMATE_EVIDENCE_DIR'&&key!=='NODE_TEST_CONTEXT'))
  return new Promise<{code:number|null;output:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','--test-concurrency=1',runner],{env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']})
    let output=''
    for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{output+=part.toString()})
    const timer=setTimeout(()=>{
      if(process.platform==='win32')try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000})}catch{}
      else child.kill('SIGKILL')
    },30000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('close',code=>{clearTimeout(timer);resolve({code,output})})
  })
}
test('live classifier entry reports not run without explicit authorization or credential',async()=>{
  for(const env of [{},{WEFTMATE_LIVE_FORGET_AUTHORIZED:'1'}]){
    const result=await invoke(env)
    assert.notEqual(result.code,0,result.output)
    assert.match(result.output,/Live model validation NOT RUN/)
  }
})
test('live classifier entry records real transport responses and fails wrong verdicts without rerunning them',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-intent-live-'))
  const seen:any[]=[]
  const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part
    const request=JSON.parse(raw);seen.push(request)
    assert.equal(request.tools[0].function.name,'classify_forget_request')
    // Constant refusal, independent of all expected fixture verdicts: the
    // executable must expose the three positive-case failures, not go green.
    res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'classify_forget_request',arguments:JSON.stringify({isForgetRequest:false,subject:'self',topic:'synthetic',conditionsOrQuestions:true})}}]}}]}))
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const output=path.join(root,'first'),result=await invoke({WEFTMATE_LIVE_FORGET_AUTHORIZED:'1',WEFTMATE_LIVE_MODEL_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}/v1`,WEFTMATE_LIVE_MODEL_ID:'synthetic-not-live',WEFTMATE_LIVE_MODEL_KEY:'synthetic-local-key',WEFTMATE_EVIDENCE_DIR:output})
    assert.equal(result.code,1,result.output)
    assert.equal(seen.length,fixtures.length)
    assert.deepEqual(seen.map(row=>JSON.parse(row.messages.at(-1).content).message),fixtures.map((row:any)=>row.message))
    const names=await readdir(output);assert.equal(names.length,12)
    const records=await Promise.all(names.map(async name=>{
      const text=await readFile(path.join(output,name),'utf8');assert.ok(!text.includes('synthetic-local-key'));return JSON.parse(text)
    }))
    assert.equal(records.filter(row=>!row.passed).length,3)
    assert.ok(records.every(row=>row.actual.authorized===false&&row.calls.length===1&&row.calls[0].status===200))
    assert.ok(records.every(row=>row.configuration.model==='synthetic-not-live'&&row.classifierSha256.length===64))
    assert.ok(records.every(row=>!row.calls[0].headers&&!row.calls[0].request.headers))
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
    assert.equal(path.dirname(await realpath(root)),await realpath(tmpdir()))
    assert.equal((await lstat(root)).isSymbolicLink(),false)
    await rm(root,{recursive:true,force:true})
  }
})
