import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';
import { exportAccountFolder } from '../../src/personal-data/export.mjs';
import { removeAccountPath } from '../../src/personal-data/paths.mjs';
const root = await mkdtemp(join(tmpdir(),'weftmate-st4-core-')), evidence = resolve('tests/evidence/st-4'); await mkdir(evidence,{recursive:true});
const python='D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe', pythonPath='D:/AIProjects/MemoWeft/Core/py/src';
const server=createServer((req,res)=>{res.writeHead(503);res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const baseUrl=`http://127.0.0.1:${server.address().port}/v1`, a='owner-00000000-0000-4000-8000-000000000041',b='owner-00000000-0000-4000-8000-000000000042';
let usable=true;const make=()=>createPersonalMemoryManager({root,enabled:true,python,pythonPath,baseUrl,model:'@current',credential:()=>usable?'synthetic-st4-key':null});let manager=make();
const boundary=(text,id)=>boundaryForCompletedTurn({id,header:{agentPreset:'personal-remote'},events:[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'user/message',data:{id:'user-'+id,source:{kind:'user'},content:[{type:'text',text}]}},{seq:3,type:'assistant/message',data:{message:{id:'assistant-'+id,content:[{type:'text',text:'收到'}]}}},{seq:4,type:'turn/end',data:{turn:1,reason:{kind:'stop'}}}]},{seq:4,type:'turn/end',data:{turn:1,reason:{kind:'stop'}}});
try {
 await manager.ingest(a,boundary('合成 A 喜欢蓝色织物','session-st4-a'));await manager.ingest(b,boundary('合成 B 喜欢绿色织物','session-st4-b'));
 const ae=await manager.query(a,'query_evidence',{operation:'list'}),be=await manager.query(b,'query_evidence',{operation:'list'});assert.ok(ae.evidence.length);assert.ok(be.evidence.length);
 const dbA=join(root,'accounts',a,'memory-home','memoweft','memoweft.sqlite3');
 // Synthetic seed uses the real schema; deletion below exclusively uses formal Core commands.
 const seed=`import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\ndb.execute("INSERT INTO cognition(id,subject_id,content,content_type,formed_by,confidence,cred_status,created_at,updated_at) VALUES(?,?,?,'preference','stated',80,'stable','2026-10-10T00:00:00Z','2026-10-10T00:00:00Z')",('cognition-st4-a',sys.argv[2],'合成 A 喜欢蓝色织物'))\ndb.execute("INSERT INTO cognition_evidence(cognition_id,evidence_id,relation) VALUES(?,?,'support')",('cognition-st4-a',sys.argv[3]))\ndb.commit()\ndb.close()`;
 execFileSync(python,['-c',seed,dbA,a,ae.evidence[0].evidence_id],{windowsHide:true,env:{...process.env,PYTHONPATH:pythonPath}});
 const portable=await manager.portableExport(a);assert.equal(portable.version??portable.schema_version??portable.schemaVersion,4);
 const plan=await manager.query(a,'portable_plan',{bundle:portable});assert.equal(plan.valid,true,JSON.stringify(plan));
 await exportAccountFolder({destination:join(root,'export'),entries:[{name:'memory/portable-v4.json',content:portable}]});
 const copied=JSON.parse(await readFile(join(root,'export','memory/portable-v4.json'),'utf8'));assert.equal((await manager.query(a,'portable_plan',{bundle:copied})).valid,true);
 const beforeB=JSON.stringify(await manager.query(b,'portable_export',{exported_at:'2026-10-10T00:00:00Z'}));
 await manager.eraseAccount(a);
 await removeAccountPath(join(root,'accounts',a),join(root,'accounts',a,'memory-home'));
 await manager.markAccountErased(a);usable=false;
 assert.equal((await manager.query(a,'query_evidence',{operation:'list'})).evidence.length,0);
 for(const kind of ['cognition','entity','relationship','event'])assert.equal((await manager.query(a,'query_world',{operation:'list',object_kind:kind,include_history:true})).items.length,0);
 assert.equal((await manager.query(a,'preview_recall',{query:'蓝色织物'})).preview.rendered_recall,'');
 assert.equal(JSON.stringify(await manager.query(b,'portable_export',{exported_at:'2026-10-10T00:00:00Z'})),beforeB);
 usable=true;await manager.close();manager=make();assert.equal((await manager.query(a,'query_evidence',{operation:'list'})).evidence.length,0);assert.equal((await manager.query(b,'query_evidence',{operation:'list'})).evidence.length,be.evidence.length);
 await writeFile(join(evidence,'core-checks.json'),JSON.stringify({realCore:true,syntheticAccounts:2,randomPort:true,portableV4ImportValidation:true,formalErase:true,emptyEvidenceAndWorld:true,emptyRecall:true,restartEmpty:true,otherAccountUnchanged:true},null,2)+'\n');
 console.log('ST-4 real Core export, import validation, erasure, recall and restart passed');
} finally {await manager.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}


