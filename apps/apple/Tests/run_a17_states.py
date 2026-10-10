#!/usr/bin/env python3
"""Actual native state gallery backed by a fresh personal/v1 HTTP host per state."""
import argparse,json,os,plistlib,shutil,signal,subprocess,tempfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--platform',choices=['mac','iphone'],required=True);p.add_argument('--theme',choices=['light','dark'],required=True)
p.add_argument('--state',choices=['empty','no-model','error','loading'],required=True);p.add_argument('--app',type=Path);p.add_argument('--capture',type=Path)
p.add_argument('--xctestrun',type=Path);p.add_argument('--simulator');p.add_argument('--result',type=Path);p.add_argument('--large-text',action='store_true');p.add_argument('--panels',action='store_true');p.add_argument('--all-states',action='store_true');p.add_argument('--evidence',type=Path,required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True);meta=None;child=None
fixture=subprocess.Popen(['node','apps/apple/Tests/a17_states_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a17-states-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp','A17_STATE':a.state},start_new_session=True)
try:
 meta=json.loads(fixture.stdout.readline())
 with urllib.request.urlopen(meta['driver']+'/ready') as r:ready=json.load(r)
 if a.platform=='mac':
  child=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str((a.evidence/(a.state+'-'+a.theme+'.png')).resolve()),'a17-'+a.state,a.theme,ready['host'],ready['cloud'],'a8','ephemeral'],start_new_session=True)
  status=child.wait(timeout=90)
  assert status==0
  text=json.loads((a.evidence/(a.state+'-'+a.theme+'.text.json')).read_text())['text']
  expected={'empty':'从这里开始','no-model':'添加模型，开始对话','error':'重试','loading':'正在打开 WeftMate'}[a.state]
  assert expected in text, 'State not visible: '+a.state
 else:
  config=plistlib.loads(a.xctestrun.read_bytes())
  def inject(v):
   if isinstance(v,dict):
    if 'TestBundlePath' in v:v.setdefault('EnvironmentVariables',{}).update({'WEFTMATE_A17_DRIVER':meta['driver'],'WEFTMATE_A17_STATE':a.state,'WEFTMATE_A17_THEME':a.theme,'WEFTMATE_A17_LARGE_TEXT':'1'if a.large_text else'0'})
    for c in v.values():inject(c)
   elif isinstance(v,list):
    for c in v:inject(c)
  inject(config)
  subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
  subprocess.run(['xcrun','simctl','boot',a.simulator],check=True)
  subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
  with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent)as f:
   f.write(plistlib.dumps(config));f.flush()
   child=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-parallel-testing-enabled','NO','-only-testing:WeftMatePhoneUITests/A17StatesUITests/'+('testNativePanels' if a.panels else 'testAllStates' if a.all_states else 'testState'),'-resultBundlePath',str(a.result)],start_new_session=True)
   status=child.wait(timeout=240)
  with tempfile.TemporaryDirectory()as exported:
   subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',exported],check=True,stdout=subprocess.DEVNULL)
   for test in json.loads((Path(exported)/'manifest.json').read_text()):
    for item in test['attachments']:
     name=item['suggestedHumanReadableName'].split('_0_')[0];source=Path(exported)/item['exportedFileName']
     if name.startswith('a17-state-'):shutil.copyfile(source,a.evidence/(name.removeprefix('a17-state-')+'.png'))
     if name.startswith('a17-panel-'):shutil.copyfile(source,a.evidence/(name+'.png'))
     if name.startswith('a17-text-'):shutil.copyfile(source,a.evidence/(name+'.txt'))
  summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
  (a.evidence/('xctest-'+a.state+'-'+a.theme+('-panels' if a.panels else '')+'.json')).write_text(json.dumps({k:summary.get(k) for k in ['result','passedTests','failedTests','skippedTests','testFailures']},indent=2)+'\n')
  assert status==0 and summary['passedTests']==1 and summary['failedTests']==0 and summary['skippedTests']==0
 (a.evidence/(a.state+'-'+a.theme+'.json')).write_text(json.dumps({'passed':True,'state':a.state,'theme':a.theme,'platform':a.platform,'syntheticOnly':True,'realPersonalHTTPHost':True,'largeText':a.large_text,'allStates':a.all_states,'panels':a.panels},indent=2)+'\n')
 print('PASS A17',a.platform,a.state,a.theme,flush=True)
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
