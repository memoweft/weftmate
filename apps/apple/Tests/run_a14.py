#!/usr/bin/env python3
"""Isolated A14 native verification; sequential Xcode and a single simulator."""
import argparse,json,os,plistlib,shutil,signal,subprocess,tempfile,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--platform',choices=['mac','iphone'],required=True);p.add_argument('--theme',default='light',choices=['light','dark'])
p.add_argument('--app',type=Path);p.add_argument('--capture',type=Path);p.add_argument('--xctestrun',type=Path);p.add_argument('--simulator');p.add_argument('--result',type=Path)
p.add_argument('--evidence',type=Path,default=ROOT/'apps/apple/Tests/Evidence/A14');a=p.parse_args()
dest=a.evidence/(a.platform+'-'+a.theme);dest.mkdir(parents=True,exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a14_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/tmp/a14-'+a.platform+'-'+a.theme+'-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None;child=None
try:
 meta=json.loads(fixture.stdout.readline())
 def get(path):
  with urllib.request.urlopen(meta['driver']+path,timeout=30)as r:return json.load(r)
 if a.platform=='mac':
  child=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(dest.resolve()),'a14-all',a.theme,meta['host'],meta['host'],'a14-driver='+meta['driver']],start_new_session=True)
  status=child.wait(timeout=300)
 else:
  config=plistlib.loads(a.xctestrun.read_bytes())
  def inject(v):
   if isinstance(v,dict):
    if 'TestBundlePath'in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_A14_DRIVER']=meta['driver']
    for c in v.values():inject(c)
   elif isinstance(v,list):
    for c in v:inject(c)
  inject(config)
  with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent)as f:
   f.write(plistlib.dumps(config));f.flush()
   subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
   subprocess.run(['xcrun','simctl','boot',a.simulator],check=True)
   subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
   child=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:WeftMatePhoneUITests/A14OfflineUITests/testOfflineRoundtripAndForget','-resultBundlePath',str(a.result)],start_new_session=True)
   status=child.wait(timeout=600)
  with tempfile.TemporaryDirectory()as exported:
   subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',exported],check=True,stdout=subprocess.DEVNULL)
   for test in json.loads((Path(exported)/'manifest.json').read_text()):
    for item in test['attachments']:
     name=item['suggestedHumanReadableName'].split('_0_')[0]
     if name.startswith('a14-iphone-'):shutil.copyfile(Path(exported)/item['exportedFileName'],dest/(name+'.png'))
  summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
  # Keep only portable counts; xcresult device paths/IDs are private artifacts.
  (dest/'xctest-summary.json').write_text(json.dumps({k:summary.get(k)for k in ['title','result','totalTestCount','passedTests','failedTests','skippedTests']},indent=2)+'\n')
  assert summary.get('totalTestCount')==1 and summary.get('passedTests')==1 and summary.get('failedTests')==0 and summary.get('skippedTests')==0,'Exactly one native test must execute and pass'
  container=Path(subprocess.check_output(['xcrun','simctl','get_app_container',a.simulator,'com.weftmate.apple.weftmatephone','data'],text=True).strip())
  needles=get('/needles')['values'];hits=0;files=0;total=0
  for file in container.rglob('*'):
   if not file.is_file():continue
   data=file.read_bytes();files+=1;total+=len(data)
   for text in needles:
    for encoding in ['utf-8','utf-16le','utf-16be']:hits+=data.count(text.encode(encoding))
  (dest/'storage-scan.json').write_text(json.dumps({'scope':'entire isolated simulator app data container','files':files,'bytes':total,'plaintextOrKeyHits':hits,'encodings':['UTF-8','UTF-16LE','UTF-16BE']},indent=2)+'\n')
  assert hits==0,'Plaintext/key found in isolated app storage'
 report=get('/report');(dest/'host-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 assert status==0,'Native flow failed'
 assert report['modelCalls']==2 and report['recalledTea'] and not report['unrelatedSent'] and not report['toolsSent']
 assert len(report['ingested'])==2 and report['forgotten']
 scan=json.loads((dest/'storage-scan.json').read_text());assert scan['plaintextOrKeyHits']==0
 (dest/'validation.json').write_text(json.dumps({'passed':True,'syntheticOnly':True,'realPersonalHTTP':True,'realCloudDPoP':True,'nativeCloudCallbackInjected':True,'realCore':False,'realMiMo':False,'xcodeJobs':2,'generatedAt':datetime.now(timezone.utc).isoformat()},indent=2)+'\n')
 print('PASS A14 '+a.platform+' '+a.theme,flush=True)
finally:
 if child and child.poll()is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
 if a.platform=='iphone':subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
