#!/usr/bin/env python3
"""Native A16 XCUITest with a fresh synthetic HTTP host, serial builds and one simulator."""
import argparse,json,os,plistlib,shutil,signal,subprocess,tempfile,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--platform',choices=['mac','iphone'],required=True);p.add_argument('--theme',choices=['light','dark'],required=True)
p.add_argument('--app',type=Path);p.add_argument('--capture',type=Path);p.add_argument('--native-own-ax',action='store_true')
p.add_argument('--test',default=None)
p.add_argument('--xctestrun',type=Path);p.add_argument('--simulator');p.add_argument('--result',type=Path,required=True)
p.add_argument('--evidence',type=Path,default=ROOT/'apps/apple/Tests/Evidence/A16');a=p.parse_args()
dest=a.evidence/(a.platform+'-'+a.theme);dest.mkdir(parents=True,exist_ok=True)
(dest/'validation.json').unlink(missing_ok=True)
if a.native_own_ax:(dest/'native-report.json').unlink(missing_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a16_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a16-fixture-'+a.platform+'-'+a.theme+'.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'},start_new_session=True)
meta=None;child=None
try:
 line=fixture.stdout.readline()
 if not line:raise RuntimeError('Synthetic host did not start')
 meta=json.loads(line)
 def get(path):
  with urllib.request.urlopen(meta['driver']+path,timeout=30)as r:return json.load(r)
 frames=[]
 if a.native_own_ax:
  assert a.platform=='mac'
  ready=get('/ready')
  child=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(dest.resolve()),'a16-all',a.theme,ready['host'],ready['host'],'a8','ephemeral','a16-driver='+meta['driver']],start_new_session=True)
  status=child.wait(timeout=300)
  summary={'passedTests':0,'failedTests':0,'skippedTests':0,'result':'Native own-AX alternative; Mac XCUITest automation mode unavailable'}
  for f in dest.glob('*-text.json'):
   row=json.loads(f.read_text());frames.append(dict(surface=a.platform,theme=a.theme,**row))
 else:
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
   destination='platform=macOS'
   if a.platform=='iphone':
    subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
    subprocess.run(['xcrun','simctl','boot',a.simulator],check=True)
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
    destination='platform=iOS Simulator,id='+a.simulator
   target='WeftMateMacUITests'if a.platform=='mac'else'WeftMatePhoneUITests'
   child=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination',destination,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:'+target+'/A16ChatUITests/'+(a.test or ('test'+a.theme.title()+'MainChat')),'-resultBundlePath',str(a.result)],start_new_session=True)
   status=child.wait(timeout=600)
  with tempfile.TemporaryDirectory()as exported:
   subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',exported],check=True,stdout=subprocess.DEVNULL)
   frames=[]
   for test in json.loads((Path(exported)/'manifest.json').read_text()):
    for item in test['attachments']:
     name=item['suggestedHumanReadableName'].split('_0_')[0];source=Path(exported)/item['exportedFileName']
     if name.startswith('a16-text-'):frames.append({'surface':a.platform,'theme':a.theme,'scene':name.removeprefix('a16-text-').removesuffix('-'+a.theme),'text':source.read_text()})
     elif name.startswith('a16-') and source.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):shutil.copyfile(source,dest/(name+'.png'))
  summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
  (dest/'performance.json').write_text(subprocess.check_output(['xcrun','xcresulttool','get','test-results','metrics','--path',str(a.result)],text=True))
  (dest/'xctest-summary.json').write_text(json.dumps({k:summary.get(k)for k in ['title','result','passedTests','failedTests','skippedTests','totalTestCount','testFailures']},ensure_ascii=False,indent=2)+'\n')
 report=get('/report');(dest/'host-receipts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 index=a.evidence/'screenshot-text.json';previous=json.loads(index.read_text())['frames']if index.exists()else[]
 previous=[f for f in previous if (f['surface'],f['theme'])!=(a.platform,a.theme)]
 index.write_text(json.dumps({'syntheticOnly':True,'source':'Native accessibility text captured alongside original screenshots','frames':previous+frames},ensure_ascii=False,indent=2)+'\n')
 if status:raise RuntimeError('Native A16 flow exit '+str(status))
 if not a.native_own_ax:assert summary['passedTests']==1 and summary['failedTests']==0 and summary['skippedTests']==0
 (dest/'validation.json').write_text(json.dumps({'passed':True,'platform':a.platform,'theme':a.theme,'realPersonalHTTPHost':True,'syntheticOnly':True,'mediaInjected':True,'macOwnAXAlternative':a.native_own_ax,'compiledDSH':False,'xcodeJobs':2,'simulatorsAtOnce':1 if a.platform=='iphone'else 0,'generatedAt':datetime.now(timezone.utc).isoformat()},indent=2)+'\n')
 print('PASS A16 '+a.platform+' '+a.theme,flush=True)
finally:
 if child and child.poll()is None:
  os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
 os.killpg(fixture.pid,signal.SIGTERM)
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:os.killpg(fixture.pid,signal.SIGKILL);fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
 if a.platform=='iphone':subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
