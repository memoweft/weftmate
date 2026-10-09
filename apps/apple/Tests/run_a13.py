#!/usr/bin/env python3
"""A13 real native capture, one simulator and one build at a time, synthetic-only."""
import argparse,json,os,plistlib,shutil,signal,subprocess,tempfile,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--platform',choices=['mac','iphone'],required=True);p.add_argument('--theme',choices=['light','dark'],required=True)
p.add_argument('--app',type=Path);p.add_argument('--capture',type=Path);p.add_argument('--xctestrun',type=Path);p.add_argument('--simulator');p.add_argument('--result',type=Path)
p.add_argument('--evidence',type=Path,required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True);dest=a.evidence/(a.platform+'-'+a.theme);dest.mkdir(exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a13_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a13-fixture-'+a.platform+'-'+a.theme+'.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None;child=None
try:
 meta=json.loads(fixture.stdout.readline())
 def get(path):
  with urllib.request.urlopen(meta['driver']+path,timeout=30)as r:return json.load(r)
 if a.platform=='mac':
  get('/prepare');ready=get('/ready')
  child=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(dest.resolve()),'a13-all',a.theme,ready['host'],ready['host'],'a8','ephemeral','a13-driver='+meta['driver']],start_new_session=True)
  status=child.wait(timeout=300)
 else:
  config=plistlib.loads(a.xctestrun.read_bytes())
  def inject(v):
   if isinstance(v,dict):
    if 'TestBundlePath'in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_A13_DRIVER']=meta['driver']
    for c in v.values():inject(c)
   elif isinstance(v,list):
    for c in v:inject(c)
  inject(config)
  with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent)as f:
   f.write(plistlib.dumps(config));f.flush()
   subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
   subprocess.run(['xcrun','simctl','boot',a.simulator],check=True)
   subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
   child=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:WeftMatePhoneUITests/A13ConsistencyUITests/test'+a.theme.title()+'Consistency','-resultBundlePath',str(a.result)],start_new_session=True)
   status=child.wait(timeout=600)
  with tempfile.TemporaryDirectory()as exported:
   subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',exported],check=True,stdout=subprocess.DEVNULL)
   for test in json.loads((Path(exported)/'manifest.json').read_text()):
    for item in test['attachments']:
     name=item['suggestedHumanReadableName'].split('_0_')[0]
     source=Path(exported)/item['exportedFileName']
     if name.startswith('a13-iphone-'):shutil.copyfile(source,dest/(name+'.png'))
     if name.startswith('a13-text-'):(dest/(name+'.json')).write_text(json.dumps({'scene':name.removeprefix('a13-text-').removesuffix('-'+a.theme),'text':source.read_text()},ensure_ascii=False,indent=2)+'\n')
  summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
  (dest/'xctest-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 report=get('/report');(dest/'host-receipts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 frames=[dict(surface=a.platform,theme=a.theme,**json.loads(f.read_text()))for f in dest.glob('*text*.json')]
 if a.platform=='mac':frames=[dict(surface=a.platform,theme=a.theme,**json.loads(f.read_text()))for f in dest.glob('*-text.json')]
 index=a.evidence/'screenshot-text.json';previous=json.loads(index.read_text())['frames']if index.exists()else[]
 previous=[f for f in previous if (f['surface'],f['theme'])!=(a.platform,a.theme)]
 index.write_text(json.dumps({'syntheticOnly':True,'source':'Native accessibility text captured with original screenshots; no OCR claim','frames':previous+frames},ensure_ascii=False,indent=2)+'\n')
 if status:raise RuntimeError('Native A13 flow exit '+str(status))
 assert len(report['questionHTTP'])==2 and all(r['status']==200 for r in report['questionHTTP'])
 first=report['questionHTTP'][0]['request']['answer']['answers']
 assert [row['id']for row in first]==['format','sections','note'] and first[0]['selected']==[] and first[1]['selected']==['摘要','步骤']
 assert first[0]['custom'].strip()=='合成其他格式' and first[1]['custom'].strip()=='合成补充'
 statistics=[row for row in report['usageHTTP'] if row['month']]
 assert len(statistics)>=2 and all(row['timeZone']for row in statistics)
 assert statistics[0]['month']!=statistics[-1]['month'], 'Native month choice must change the actual host statistics request'
 (dest/'validation.json').write_text(json.dumps({'passed':True,'platform':a.platform,'theme':a.theme,'realPersonalHost':True,'syntheticOnly':True,'compiledDSH':False,'xcodeJobs':2,'simulatorsAtOnce':1 if a.platform=='iphone' else 0,'questionBatchPOSTs':2,'generatedAt':datetime.now(timezone.utc).isoformat()},indent=2)+'\n')
 print('PASS A13 '+a.platform+' '+a.theme,flush=True)
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
