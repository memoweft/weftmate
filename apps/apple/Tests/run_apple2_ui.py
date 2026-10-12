#!/usr/bin/env python3
"""One simulator; fresh real cloud + file mail + real isolated host per appearance."""
import argparse, json, os, plistlib, re, shutil, subprocess, tempfile, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--xctestrun',type=Path,required=True)
p.add_argument('--simulator',required=True)
p.add_argument('--result',type=Path,required=True)
p.add_argument('--evidence',type=Path,required=True)
p.add_argument('--theme',choices=['light','dark'],required=True)
p.add_argument('--phase',choices=['all','password','code'],default='all')
a=p.parse_args()
if a.phase == 'all':
    for phase in ['password','code']:
        subprocess.run([os.sys.executable,__file__,'--xctestrun',str(a.xctestrun),'--simulator',a.simulator,
            '--result',str(a.result)+'.'+phase+'.xcresult','--evidence',str(a.evidence),'--theme',a.theme,'--phase',phase],check=True)
    (a.evidence/('validation-'+a.theme+'.json')).write_text(json.dumps({'passed':2,'failed':0,'skipped':0,'theme':a.theme,'freshCloudPerScenario':True,'simulatorsAtOnce':1},indent=2)+'\n')
    raise SystemExit(0)
fixture=subprocess.Popen(['node','apps/apple/Tests/apple2_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/apple2-fixture-driver.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None
try:
    raw=fixture.stdout.readline()
    if not raw: raise RuntimeError('Synthetic fixture failed; see private local driver log')
    meta=json.loads(raw)
    config=plistlib.loads(a.xctestrun.read_bytes())
    def inject(value):
        if isinstance(value,dict):
            if 'TestBundlePath' in value:value.setdefault('EnvironmentVariables',{})['WEFTMATE_APPLE2_DRIVER']=meta['driver']
            for child in value.values():inject(child)
        elif isinstance(value,list):
            for child in value:inject(child)
    inject(config)
    subprocess.run(['xcrun','simctl','boot',a.simulator],capture_output=True)
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
    # No simulator settings are changed. Theme is an app-only launch argument.
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
        f.write(plistlib.dumps(config));f.flush()
        test=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/APPLE2LoginUITests/test'+a.theme.title()+a.phase.title()+'LoginFirst','-resultBundlePath',str(a.result)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        for line in test.stdout:print(re.sub(r"Type '.*?' into","Type <synthetic input redacted> into",line),end='',flush=True)
        status=test.wait()
    a.evidence.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(meta['driver']+'/report') as response: report=json.load(response)
    (a.evidence/('host-report-'+a.theme+'-'+a.phase+'.json')).write_text(json.dumps(report,indent=2)+'\n')
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    a.evidence.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if name.startswith('apple2-'):shutil.copyfile(Path(out)/attachment['exportedFileName'],a.evidence/(name+'.png'))
    (a.evidence/('validation-'+a.theme+'-'+a.phase+'.json')).write_text(json.dumps({'theme':a.theme,'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'simulatorsAtOnce':1,'realCloud':True,'realHost':True,'fileMail':True,'syntheticRelayRoute':True,'systemStatusBar':True},indent=2)+'\n')
    if status or summary['passedTests']!=1 or summary['failedTests'] or summary['skippedTests']:raise RuntimeError('Native login journey did not pass')
finally:
    subprocess.run(['xcrun','simctl','shutdown',a.simulator],capture_output=True)
    fixture.terminate()
    try:fixture.wait(timeout=20)
    except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
    if meta:shutil.rmtree(meta['root'],ignore_errors=True)
