import json, sqlite3, sys
from pathlib import Path

base=Path('tests/evidence/qa-6')
report={'memory':[],'streamingMessages':[]}
names=['exit-formation-final']
for name in names:
 file=base/name/'results.json'
 if not file.exists(): continue
 rows=json.loads(file.read_text())['rows']
 root=Path((base/name/'run-root.txt').read_text().strip())
 for db in (root/'profile/personal-access/accounts').glob('*/memory-home/memoweft/memoweft.sqlite3'):
  c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
  texts=[r[0] for r in c.execute('select raw_content from evidence')]
  jobs=list(c.execute('select job_id,boundary_event_id,state,attempts from memory_world_job'))
  formation=[(i+1,r) for i,r in enumerate(rows) if r['state']=='formation']
  result={'run':name,'jobCount':len(jobs),'evidenceCount':len(texts),'cognitionCount':c.execute('select count(*) from cognition').fetchone()[0],
   'duplicateSources':c.execute('select count(*)-count(distinct origin_id) from evidence where origin_id is not null').fetchone()[0],
   'duplicateBoundaries':len(jobs)-len({j[1] for j in jobs}),
   'jobStates':dict(c.execute('select state,count(*) from memory_world_job group by state')),
   'formationLastUserQuotes':[{'method':r['method'],'attempt':r['attempt'],'retained':f'我偏好第{i}种合成茶加两片柠檬。' in texts} for i,r in formation]}
  result['expectedCompletedBoundaries']=sum(2 if row['state']=='formation' else 1 for row in rows)
  result['passed']=result['jobCount']==result['evidenceCount']==result['cognitionCount']==result['expectedCompletedBoundaries'] and result['duplicateSources']==0 and result['duplicateBoundaries']==0 and all(x['retained'] for x in result['formationLastUserQuotes']) and all(j[2]=='applied' and j[3]==1 for j in jobs)
  report['memory'].append(result);c.close()
 if any(r['state']=='chat' for r in rows):
  files=list((root/'profile/dsh-home/sessions').rglob('session.jsonl.zstd'))
  sessions=[zstd.decompress(f.read_bytes()).decode('utf8') for f in files]
  for row in rows:
   if row['state']!='chat':continue
   candidates=[s for s in sessions if row['sessionId'] in s.split('\n',1)[0]]
   report['streamingMessages'].append({'method':row['method'],'attempt':row['attempt'],'retained':any('请确认这条正在输出的合成消息。' in s for s in candidates)})
report['passed']=len(report['memory'])==len(names) and all(x['passed'] for x in report['memory']) and len(report['streamingMessages'])==0 and all(x['retained'] for x in report['streamingMessages'])
(base/'durable-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False))
