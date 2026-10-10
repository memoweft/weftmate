import pathlib,sqlite3,json
from compression import zstd
base=pathlib.Path('tests/evidence/qa-5');r={'memory':[],'streamingMessages':[]}
for name in ['exit-formation-tray','exit-formation-task-manager-force','exit-formation-logout-taskkill']:
 root=pathlib.Path((base/name/'run-root.txt').read_text().strip())
 for db in (root/'profile/personal-access/accounts').glob('*/memory-home/memoweft/memoweft.sqlite3'):
  c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
  columns=[x[1] for x in c.execute('pragma table_info(evidence)')]
  texts=[x[0] for x in c.execute('select raw_content from evidence')] if 'raw_content' in columns else []
  states=dict(c.execute('select state,count(*) from memory_world_job group by state'))
  r['memory'].append({'run':name,'jobStates':states,'evidenceCount':c.execute('select count(*) from evidence').fetchone()[0],'latestCompletedUserTextsPreserved':sum(any(f'我偏好第{i}种合成茶加两片柠檬。' in t for t in texts) for i in range(1,4))})
  c.close()
root=pathlib.Path((base/'exit-matrix/run-root.txt').read_text().strip());rows=json.loads((base/'exit-matrix/results.json').read_text())['rows']
files=list((root/'profile/dsh-home/sessions').rglob('session.jsonl.zstd'))
for row in rows:
 if row['state']!='chat':continue
 candidates=[]
 for file in files:
  raw=zstd.decompress(file.read_bytes()).decode('utf8')
  if row['sessionId'] in raw.split('\n',1)[0]:candidates.append(raw)
 r['streamingMessages'].append({'method':row['method'],'attempt':row['attempt'],'sessionId':row['sessionId'],'artifactCount':len(candidates),'acceptedStreamingUserTextPreserved':any('请确认这条正在输出的合成消息。' in s for s in candidates)})
r['passed']=all(x['latestCompletedUserTextsPreserved']==3 and x['jobStates'].get('applied')==6 for x in r['memory']) and len(r['streamingMessages'])==9 and all(x['acceptedStreamingUserTextPreserved'] for x in r['streamingMessages'])
(base/'exit-durable-review.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(r,ensure_ascii=False))
