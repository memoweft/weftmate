#!/usr/bin/env python3
"""One paired iPhone/Watch only; real WatchConnectivity, synthetic approval text."""
import argparse,json,os,plistlib,shutil,signal,subprocess,tempfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
for flag in ['phone','watch']:p.add_argument('--'+flag,required=True)
for flag in ['products','xctestrun','result','evidence']:p.add_argument('--'+flag,type=Path,required=True)
a=p.parse_args();dest=a.evidence/'watch';dest.mkdir(parents=True,exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a16_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a16-watch-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None;child=None
try:
 meta=json.loads(fixture.stdout.readline())
 with urllib.request.urlopen(meta['driver']+'/ready')as r:ready=json.load(r)
 subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
 for device in [a.phone,a.watch]:
  subprocess.run(['xcrun','simctl','boot',device],check=True)
  subprocess.run(['xcrun','simctl','bootstatus',device,'-b'],check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['xcrun','simctl','install',a.phone,str(a.products/'Debug-iphonesimulator/WeftMatePhone.app')],check=True)
 subprocess.run(['xcrun','simctl','install',a.watch,str(a.products/'Debug-watchsimulator/WeftMateWatch.app')],check=True)
 subprocess.run(['xcrun','simctl','launch',a.phone,'com.weftmate.apple.weftmatephone','--ui-testing','--ui-testing-namespace','a16-watch-synthetic','--a5-local-server','--a5-theme','light','--server-url',ready['host'],'--a16-driver',meta['driver']],check=True)
 config=plistlib.loads(a.xctestrun.read_bytes())
 def inject(v):
  if isinstance(v,dict):
   if 'TestBundlePath'in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_A16_DRIVER']=meta['driver']
   for c in v.values():inject(c)
  elif isinstance(v,list):
   for c in v:inject(c)
 inject(config)
 with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent)as f:
  f.write(plistlib.dumps(config));f.flush()
  child=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=watchOS Simulator,id='+a.watch,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:WeftMateWatchUITests/A16WatchUITests/testMainApprovalProjection','-resultBundlePath',str(a.result)],start_new_session=True)
  status=child.wait(timeout=600)
 summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
 (dest/'xctest-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 with tempfile.TemporaryDirectory()as out:
  subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
  for test in json.loads((Path(out)/'manifest.json').read_text()):
   for item in test['attachments']:
    name=item['suggestedHumanReadableName'].split('_0_')[0];source=Path(out)/item['exportedFileName']
    if name=='a16-watch-approval':shutil.copyfile(source,dest/'approval.png')
    if name=='a16-watch-text':
     index=a.evidence/'screenshot-text.json';data=json.loads(index.read_text()) if index.exists() else {'syntheticOnly':True,'frames':[]};frame={'surface':'watch','theme':'light','scene':'approval','text':source.read_text()};data['frames']=[f for f in data['frames']if f['surface']!='watch']+[frame];index.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');(dest/'approval-text.json').write_text(json.dumps(frame,ensure_ascii=False,indent=2)+'\n')
 with urllib.request.urlopen(meta['driver']+'/report')as r:report=json.load(r)
 (dest/'host-receipts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 assert status==0 and summary['passedTests']==1 and summary['failedTests']==0 and summary['skippedTests']==0
 print('PASS A16 paired Watch main approval projection',flush=True)
finally:
 if child and child.poll()is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
 subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
