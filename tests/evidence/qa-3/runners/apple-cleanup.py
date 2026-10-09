import json,os,subprocess,time,tempfile,shutil
from pathlib import Path
root=Path('/tmp/weftmate-qa3-apple');meta=json.loads((root/'batches.json').read_text())
devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','-j'],text=True))['devices']
flat=[d for values in devices.values()for d in values]
owned=set(meta['createdDevices'])
recent=[];older=[]
tokens=['apps/apple/Tests/a5_cloud_fixture.mjs','apps/apple/Tests/a11_fixture.mjs','apps/apple/Tests/a12_fixture.mjs','apps/apple/Tests/a13_fixture.mjs','apps/apple/Build/A13MacCapture','apps/apple/Build/A13/Build/Products/Debug/WeftMateMac.app','ui-p1-desktop-motion.mjs','weftmate-qa3-apple-batch.py']
for row in subprocess.check_output(['ps','-axo','pid,lstart,command'],text=True).splitlines()[1:]:
 parts=row.split(None,6)
 if len(parts)!=7 or not any(token in parts[6]for token in tokens):continue
 started=time.mktime(time.strptime(' '.join(parts[1:6]),'%a %b %d %H:%M:%S %Y'))
 (recent if started>=meta['resourceReleasedAt']-2 else older).append(int(parts[0]))
report={'checkedAtUnix':time.time(),'bootedSimulators':sum(d.get('state')=='Booted'for d in flat),'ownedDevicesRemaining':sum(d['udid']in owned for d in flat),'recentQaProcesses':recent,'preExistingProcessesNotTouched':older,'forcedProcessTerminations':0,'motionTemporaryDirectoriesRemoved':[]}
if recent or report['ownedDevicesRemaining']or report['bootedSimulators']:
 print(json.dumps(report));raise SystemExit('QA resource remains; inspect rather than kill unrelated processes')
for parent in {Path(tempfile.gettempdir()).resolve(),Path('/private/tmp')}:
 for p in parent.iterdir():
  if p.name.startswith(('weftmate-ui-p1-','weftmate-m0-3-'))and p.is_dir()and p.stat().st_birthtime>=meta['finishedAt']-2:
   if p.resolve().parent!=parent:raise RuntimeError('Unexpected temporary path')
   shutil.rmtree(p);report['motionTemporaryDirectoriesRemoved'].append(p.name)
(root/'cleanup.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
