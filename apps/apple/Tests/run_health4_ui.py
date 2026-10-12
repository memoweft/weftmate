#!/usr/bin/env python3
"""Single isolated simulator, test-only localhost contract service, native XCTest screenshots."""
import argparse,json,os,plistlib,shutil,subprocess,tempfile,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--xctestrun',type=Path,required=True);p.add_argument('--simulator',required=True);p.add_argument('--theme',choices=['light','dark'],required=True);p.add_argument('--result',type=Path,required=True);a=p.parse_args()
evidence=root/'apps/apple/Tests/Evidence/HEALTH-4'
service=subprocess.Popen(['node','apps/apple/Tests/health4_host_fixture.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=open('/private/tmp/health4-fixture.log','w'),text=True)
try:
    meta=json.loads(service.stdout.readline());config=plistlib.loads(a.xctestrun.read_bytes())
    Path('/private/tmp/health4-meta-'+a.theme+'.json').write_text(json.dumps(meta))
    def inject(v):
        if isinstance(v,dict):
            if 'TestBundlePath' in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_HEALTH4_ORIGIN']=meta['origin']
            for child in v.values():inject(child)
        elif isinstance(v,list):
            for child in v:inject(child)
    inject(config)
    subprocess.run(['xcrun','simctl','boot',a.simulator],capture_output=True)
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
    seed=a.xctestrun.parent/'Debug-iphonesimulator/WeftMateHealth4Seed.app'
    subprocess.run(['xcrun','simctl','install',a.simulator,str(seed)],check=True)
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
        f.write(plistlib.dumps(config));f.flush()
        result=subprocess.run(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-parallel-testing-enabled','NO','-jobs','2','-only-testing:WeftMatePhoneUITests/HEALTH4UITests/test'+a.theme.title()+'HealthJourney','-resultBundlePath',str(a.result)],stdout=open('/private/tmp/health4-ui-'+a.theme+'.log','w'),stderr=subprocess.STDOUT)
    with urllib.request.urlopen(meta['origin']+'/fixture/report') as r:report=json.load(r)
    evidence.mkdir(parents=True,exist_ok=True)
    (evidence/('host-report-'+a.theme+'.json')).write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if name.startswith('health4-'):shutil.copyfile(Path(out)/attachment['exportedFileName'],evidence/(name+'.png'))
    container=Path(subprocess.check_output(['xcrun','simctl','get_app_container',a.simulator,'com.weftmate.apple.weftmatephone','data'],text=True).strip())
    events=[]
    for file in container.rglob('run-*.jsonl'):
        for line in file.read_text().splitlines():
            row=json.loads(line)
            if row.get('fields',{}).get('phase')=='health_delivery':events.append(row['fields'])
    allowed={'phase','dayCount','result','errorType','recordIndex'}
    privacy={'syntheticOnly':True,'healthDeliveryEvents':len(events),'fieldNames':sorted({k for e in events for k in e}),'noHealthMeasurements':all(set(e)<=allowed for e in events)}
    (evidence/('runtime-privacy-'+a.theme+'.json')).write_text(json.dumps(privacy,indent=2)+'\n')
    assert privacy['noHealthMeasurements']
    info={'theme':a.theme,'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'realHealthKit':True,'fakeHost':True,'realCloud':False,'simulatorsAtOnce':1,'systemStatusBar':True}
    (evidence/('validation-'+a.theme+'.json')).write_text(json.dumps(info,indent=2)+'\n')
    print(json.dumps(info))
    if result.returncode or info['passed']!=1 or info['failed'] or info['skipped']:raise RuntimeError('Health4 UI test did not pass; see private local log')
finally:
    subprocess.run(['xcrun','simctl','shutdown',a.simulator],capture_output=True);service.terminate();service.wait(timeout=20)
