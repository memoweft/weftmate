#!/usr/bin/env python3
"""One iPhone at a time; real cloud main + isolated host + synthetic native log/model."""
import argparse,json,os,plistlib,re,shutil,subprocess,tempfile,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--xctestrun',type=Path,required=True);p.add_argument('--simulator',required=True);p.add_argument('--result',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True)
p.add_argument('--phase',choices=['light','dark','delete','gallery-light','gallery-dark','a6-light','a6-dark'],required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True)
def run(*cmd):return subprocess.run(cmd,check=True,capture_output=True,text=True).stdout
fixture=subprocess.Popen(['node','apps/apple/Tests/a5_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a5-cloud-'+a.phase+'.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None
try:
 meta=json.loads(fixture.stdout.readline());config=plistlib.loads(a.xctestrun.read_bytes())
 def inject(v):
  if isinstance(v,dict):
   if 'TestBundlePath' in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_A5_DRIVER']=meta['driver']
   for child in v.values():inject(child)
  elif isinstance(v,list):
   for child in v:inject(child)
 inject(config)
 with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
  f.write(plistlib.dumps(config));f.flush()
  run('xcrun','simctl','shutdown','all');run('xcrun','simctl','boot',a.simulator);run('xcrun','simctl','bootstatus',a.simulator,'-b')
  name={'light':'testLightParityFlowAndGallery','dark':'testDarkGallery','delete':'testFocusedDeletionOption','gallery-light':'testFramedLightGallery','gallery-dark':'testFramedDarkGallery','a6-light':'testLightSettingsReachabilitySearchDeepLinkAndDeviceOperation','a6-dark':'testDarkSettingsReview'}[a.phase]
  cmd=['xcodebuild','test-without-building','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-only-testing:WeftMatePhoneUITests/'+('A6SettingsUITests' if a.phase.startswith('a6-') else 'A5ParityUITests')+'/'+name,'-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-resultBundlePath',str(a.result)]
  t=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  for line in t.stdout:print(re.sub(r"Type '.*?' into",'Type <synthetic input> into',line),end='',flush=True)
  status=t.wait();run('xcrun','simctl','shutdown','all')
  if status:
   try:
    report=json.load(urllib.request.urlopen(meta['driver']+'/a5/report'))
    Path('/private/tmp/a5-ui-failure-'+a.phase+'.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
   except Exception:pass
   raise subprocess.CalledProcessError(status,cmd)
 summary=json.loads(run('xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)))
 assert summary['passedTests']==1 and summary['failedTests']==0 and summary['skippedTests']==0
 commit=run('git','rev-parse','HEAD').strip();now=datetime.now(timezone.utc);stamp=now.strftime('%Y%m%dT%H%M%SZ');generated=now.isoformat(timespec='milliseconds').replace('+00:00','Z')
 with tempfile.TemporaryDirectory() as exported:
  run('xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',exported)
  for test in json.loads((Path(exported)/'manifest.json').read_text()):
   for attachment in test['attachments']:
    name=attachment['suggestedHumanReadableName'].split('_0_')[0]
    if name.startswith('review-iphone-'):
     stem=name+'-'+stamp;shutil.copyfile(Path(exported)/attachment['exportedFileName'],a.evidence/(stem+'.png'))
     theme=a.phase.removeprefix('gallery-').removeprefix('a6-')
     scene=name.removeprefix('review-iphone-').removesuffix('-'+theme)
     (a.evidence/(stem+'.json')).write_text(json.dumps({'platform':'iphone','scene':scene,'theme':theme,'commit':commit,'generatedAt':generated,'synthetic':True,'source':'实际 iPhone 原生 App；真实隔离 cloud main / 宿主，合成 DSH 日志与模型'},ensure_ascii=False,indent=2)+'\n')
 (a.evidence/('validation-'+a.phase+'.json')).write_text(json.dumps({'passed':1,'failed':0,'skipped':0,'realCloudMain':True,'realPersonalHost':True,'compiledDshEngine':False,'syntheticModel':True,'simulatorsAtOnce':1,'xcodeJobs':2,'shutdownImmediately':True},indent=2)+'\n')
finally:
 subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
