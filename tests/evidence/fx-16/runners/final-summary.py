import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def read(path): return json.loads((root/path).read_text(encoding='utf-8'))
real=read('native-live/results.json')
s=read('stability-summary.json')
fake=read('lists-and-drafts.json')
phone=read('relay-phone-release/phone-task.json')
usage=read('usage.json')['total']
r={'nativePopulations':[{k:row[k] for k in ['count','sessionsP95Ms','chatsP95Ms','createInputP95Ms','renderedRows']} for row in real['populations']], 'stability':s,'drafts':fake['drafts'],'originalRace':fake['before'],'relayPhone':{k:phone[k] for k in ['passed','durationMs','approvals','completed','noUnconfirmed']},'memoryAccount':read('memory-and-account.json')['passed'],'mimo':usage,'nativeRunCleaned':real['cleaned']}
(root/'summary.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(r,ensure_ascii=False))
