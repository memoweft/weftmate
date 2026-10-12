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
a=p.parse_args()
fixture=subprocess.Popen(['node','apps/apple/Tests/health1_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/health1-fixture-driver.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp','WEFTMATE_HEALTH1_FIXTURE':'1'})
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
    for name in ['Phone','Watch']:
        seeder = a.xctestrun.parent / 'Debug-iphonesimulator' / ('WeftMateHealthSeed'+name+'.app')
        subprocess.run(['xcrun','simctl','install',a.simulator,str(seeder)],check=True)
    # No simulator settings are changed. Theme is an app-only launch argument.
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
        f.write(plistlib.dumps(config));f.flush()
        test=subprocess.Popen(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/HEALTH1UITests/test'+a.theme.title()+'DailyHealth','-resultBundlePath',str(a.result)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        for line in test.stdout:print(re.sub(r"Type '.*?' into","Type <synthetic input redacted> into",line),end='',flush=True)
        status=test.wait()
    a.evidence.mkdir(parents=True,exist_ok=True)
    container = Path(subprocess.check_output(['xcrun','simctl','get_app_container',a.simulator,'com.weftmate.apple.weftmatephone','data'],text=True).strip())
    health_events=[]
    for file in container.rglob('run-*.jsonl'):
        for line in file.read_text().splitlines():
            row=json.loads(line)
            if row.get('fields',{}).get('phase')=='health_delivery':health_events.append(row['fields'])
    allowed={'phase','dayCount','result','errorType','recordIndex'}
    privacy={'healthDeliveryEvents':len(health_events),'fieldNames':sorted({k for event in health_events for k in event}),
        'noHealthMeasurements':all(set(event)<=allowed for event in health_events),'syntheticOnly':True}
    (a.evidence/('runtime-privacy-'+a.theme+'.json')).write_text(json.dumps(privacy,indent=2)+'\n')
    if len(health_events)<3 or not privacy['noHealthMeasurements']:raise RuntimeError('Health runtime log privacy check failed')
    with urllib.request.urlopen(meta['driver']+'/health1/report') as response: report=json.load(response)
    (a.evidence/('host-report-'+a.theme+'.json')).write_text(json.dumps(report,indent=2)+'\n')
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    a.evidence.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if name.startswith('health1-'):shutil.copyfile(Path(out)/attachment['exportedFileName'],a.evidence/(name+'.png'))
    (a.evidence/('validation-'+a.theme+'.json')).write_text(json.dumps({'theme':a.theme,'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'simulatorsAtOnce':1,'realCloud':True,'realHost':True,'realHostAuthentication':True,'healthRecordService':'synthetic-v2-contract','realHealthStorage':False,'fileMail':True,'syntheticRelayRoute':True,'systemStatusBar':True},indent=2)+'\n')
    if status or summary['passedTests']!=1 or summary['failedTests'] or summary['skippedTests']:raise RuntimeError('Native daily health journey did not pass')
finally:
    subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
    import time
    time.sleep(30)
    fixture.terminate()
    try:fixture.wait(timeout=20)
    except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
    if meta:shutil.rmtree(meta['root'],ignore_errors=True)
