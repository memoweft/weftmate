import assert from 'node:assert/strict'
import test from 'node:test'
import { handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs'

test('formation retry preserves owner and idempotency token without claiming success', async () => {
  const calls: any[]=[]
  const manager={retryFormation:async(...args:any[])=>{calls.push(args);return {job_id:'new-job',original_job_id:'source-job'}}}
  const path='/personal/v1/memory/formation/source-job/retry'
  const invoke=(body:any)=>handlePersonalMemoryHttp({manager,ownerId:'synthetic-owner',request:{method:'POST'},pathname:path,url:new URL('https://example.test'+path),readJson:async()=>body})
  assert.equal((await invoke({requestId:'same-request'})).status,202)
  assert.deepEqual(calls,[['synthetic-owner','source-job','same-request']])
  await assert.rejects(()=>invoke({}),{code:'INVALID_REQUEST'})
  await assert.rejects(()=>invoke({requestId:'x'.repeat(129)}),{code:'INVALID_REQUEST'})
  assert.equal(calls.length,1)
})
