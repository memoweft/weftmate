#!/usr/bin/env python3
"""Real paired WatchConnectivity -> iPhone -> isolated personal approval API.
Build schemes sequentially with -jobs 2 before invoking. Uses only synthetic accounts.
"""
import argparse, hashlib, json, os, plistlib, shutil, subprocess, tempfile, urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--phone', required=True); p.add_argument('--watch', required=True)
p.add_argument('--products', type=Path, required=True); p.add_argument('--xctestrun', type=Path, required=True)
p.add_argument('--result', type=Path, required=True); p.add_argument('--evidence', type=Path, required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True)
fixture=None;meta=None;child=None
try:
 env=os.environ|{'TMPDIR':'/private/tmp','WEFTMATE_A12_CAPTURE_DIR':str(a.evidence.resolve()),'WEFTMATE_A12_PHONE':a.phone,'WEFTMATE_A12_WATCH':a.watch}
 fixture=subprocess.Popen(['node','apps/apple/Tests/a12_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a12-live-fixture.log','w'),text=True,env=env)
 meta=json.loads(fixture.stdout.readline())
 def get(path):
  with urllib.request.urlopen(meta['driver']+path,timeout=30)as r:return json.load(r)
 ready=get('/ready')
 subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
 for device in [a.phone,a.watch]:
  subprocess.run(['xcrun','simctl','boot',device],check=True)
  subprocess.run(['xcrun','simctl','bootstatus',device,'-b'],check=True,stdout=subprocess.DEVNULL)
 phone_app=a.products/'Debug-iphonesimulator/WeftMatePhone.app'
 watch_app=a.products/'Debug-watchsimulator/WeftMateWatch.app'
 subprocess.run(['xcrun','simctl','install',a.phone,str(phone_app)],check=True)
 subprocess.run(['xcrun','simctl','install',a.watch,str(watch_app)],check=True)
 watch_container=Path(subprocess.check_output(['xcrun','simctl','get_app_container',a.watch,'com.weftmate.apple.weftmatephone.watch','data'],text=True).strip())
 (watch_container/'Documents/a12-watch.jsonl').unlink(missing_ok=True)
 subprocess.run(['xcrun','simctl','launch',a.phone,'com.weftmate.apple.weftmatephone','--ui-testing','--ui-testing-namespace','a12-live-'+datetime.now(timezone.utc).strftime('%H%M%S'),'--a5-local-server','--a5-theme','light','--server-url',ready['host'],'--a12-live-session',ready['sessionID']],check=True)
 config=plistlib.loads(a.xctestrun.read_bytes())
 def inject(v):
  if isinstance(v,dict):
   if 'TestBundlePath'in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_A12_DRIVER']=meta['driver']
   for c in v.values():inject(c)
  elif isinstance(v,list):
   for c in v:inject(c)
 inject(config)
 with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent)as f:
  f.write(plistlib.dumps(config));f.flush()
  child=subprocess.Popen(['xcodebuild','test-without-building','-xctestrun',f.name,'-destination','platform=watchOS Simulator,id='+a.watch,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:WeftMateWatchUITests/A12WatchLiveUITests/testRealPairedPhoneApprovalAndRejection','-resultBundlePath',str(a.result)])
  status=child.wait(timeout=600)
 report=get('/report');(a.evidence/'host-receipts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 container=Path(subprocess.check_output(['xcrun','simctl','get_app_container',a.watch,'com.weftmate.apple.weftmatephone.watch','data'],text=True).strip())
 trace=container/'Documents/a12-watch.jsonl'
 if trace.exists():shutil.copyfile(trace,a.evidence/'watch-connectivity.jsonl')
 summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
 (a.evidence/'xctest-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 assert status==0 and summary['passedTests']==1 and summary['failedTests']==0 and summary['skippedTests']==0
 assert report['scenarios'][0]['fileExists']==False and report['scenarios'][1]['fileExists']==True
 assert len(report['approvalHTTP'])==2 and all(r['status']==200 for r in report['approvalHTTP'])
 rows=[json.loads(line)for line in trace.read_text().splitlines()]
 assert sum(r['event']=='reply' and r.get('registered') for r in rows)==2
 assert sum(r['event']=='haptic' and r.get('type')=='success' for r in rows)==1
 screenshots=[{'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in sorted(a.evidence.glob('*.png'))]
 source_hash=hashlib.sha256()
 sources=sorted((ROOT/'apps/apple/UI').glob('*.swift'))+sorted((ROOT/'apps/apple/watchOS').glob('*.swift'))+sorted((ROOT/'apps/apple/Packages/WeftMateCore/Sources/WeftMateCore').glob('*.swift'))
 for source in sources:
  source_hash.update(str(source.relative_to(ROOT)).encode());source_hash.update(source.read_bytes())
 validation={'sourcesSHA256':source_hash.hexdigest(),'phoneBinarySHA256':hashlib.sha256((phone_app/'WeftMatePhone').read_bytes()).hexdigest(),'watchBinarySHA256':hashlib.sha256((watch_app/'WeftMateWatch').read_bytes()).hexdigest(),'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'generatedAt':datetime.now(timezone.utc).isoformat(),'pairedSimulators':True,'simulatorsAtOnce':2,'xcodeJobs':2,'realWatchConnectivity':True,'realPersonalApprovalHTTP':True,'deterministicPlanner':True,'compiledDSH':False,'realSyntheticFileDelete':True,'approved':True,'rejected':True,'completionHapticEvents':1,'passedTests':1,'failedTests':0,'skippedTests':0,'screenshots':screenshots}
 for key,app,name in [('phoneImplementationSHA256',phone_app,'WeftMatePhone'),('watchImplementationSHA256',watch_app,'WeftMateWatch')]:
  validation[key]=hashlib.sha256((app/(name+'.debug.dylib')).read_bytes()).hexdigest()
 (a.evidence/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
 print('PASS A12 paired Watch approval + rejection; real host receipts; file delete/preserve; one success haptic',flush=True)
finally:
 if child and child.poll()is None:
  child.terminate()
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 for device,bundle in [(a.watch,'com.weftmate.apple.weftmatephone.watch'),(a.phone,'com.weftmate.apple.weftmatephone')]:subprocess.run(['xcrun','simctl','terminate',device,bundle],capture_output=True)
 if fixture:
  fixture.terminate()
  try:fixture.wait(timeout=20)
  except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
 subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
