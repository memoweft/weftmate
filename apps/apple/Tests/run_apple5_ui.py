#!/usr/bin/env python3
"""Bounded headless SE batch, real personal-host fixture, exported named evidence only."""
import argparse,json,os,plistlib,shutil,subprocess,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--xctestrun',type=Path,required=True);p.add_argument('--simulator',required=True);p.add_argument('--result',type=Path,required=True);p.add_argument('--addendum',action='store_true');p.add_argument('--fix',action='store_true');p.add_argument('--pages',action='store_true');p.add_argument('--evidence',type=Path);a=p.parse_args()
evidence=a.evidence or root/('apps/apple/Tests/Evidence/APPLE-5/Fix' if a.fix else 'apps/apple/Tests/Evidence/APPLE-5');evidence.mkdir(parents=True,exist_ok=True)
ledger=evidence/('fix-simulator-count.json' if a.fix else 'addendum-simulator-count.json' if a.addendum else 'simulator-count.json')
prior=json.loads(ledger.read_text()) if ledger.exists() else {'boots':0}
if prior['boots']>=(2 if a.fix or a.addendum else 5):raise RuntimeError('APPLE-5 simulator budget exhausted')
reports=list(Path('/Library/Logs/DiagnosticReports').glob('*gpuRestart*'))+list((Path.home()/'Library/Logs/DiagnosticReports').glob('*gpuRestart*'))
if reports:
    deadline=max(x.stat().st_mtime for x in reports)+600
    while time.time()<deadline:time.sleep(min(60,deadline-time.time()))
# Logs stay private; handoff records counts, never identifying filenames or paths.
with open('/private/tmp/apple5-preboot.log','w') as log:
    subprocess.run(['sh','-c','ls /Library/Logs/DiagnosticReports/ | grep gpuRestart | tail -1; uptime'],stdout=log,stderr=subprocess.STDOUT)
crashes=set((Path.home()/'Library/Logs/DiagnosticReports').glob('*[Ww]eft[Mm]ate*'))
metadata=Path('/private/tmp/apple5-ui-private.json')
service=subprocess.Popen(['node','apps/apple/Tests/apple5_real_host.mjs',str(metadata)],cwd=root,env={**os.environ,**({'WEFTMATE_IOS_UI_PAGES':'1'} if a.pages else {})},stdout=subprocess.PIPE,stderr=open('/private/tmp/apple5-ui-host.log','w'),text=True)
booted=False
presentation=None
try:
    ready=json.loads(service.stdout.readline());assert ready.get('realPersonalHost')
    meta=json.loads(metadata.read_text());config=plistlib.loads(a.xctestrun.read_bytes())
    variables={'WEFTMATE_APPLE5_ORIGIN':meta['origin'],'WEFTMATE_APPLE5_USERNAME':meta['username'],'WEFTMATE_APPLE5_PASSWORD':meta['password']}
    def inject(value):
        if isinstance(value,dict):
            if 'TestBundlePath' in value:value.setdefault('EnvironmentVariables',{}).update(variables)
            for child in value.values():inject(child)
        elif isinstance(value,list):
            for child in value:inject(child)
    if a.addendum or a.fix:
        presentation=subprocess.Popen(['node','apps/apple/Tests/apple3_host_fixture.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=open('/private/tmp/apple5-presentation-host.log','w'),text=True)
        variables['WEFTMATE_APPLE3_ORIGIN']=json.loads(presentation.stdout.readline())['origin']
    inject(config)
    prior.update(boots=prior['boots']+1,smallDevice='iPhone SE (3rd generation)',windowOpened=False,concurrentSimulators=1)
    ledger.write_text(json.dumps(prior,indent=2)+'\n')
    subprocess.run(['xcrun','simctl','boot',a.simulator],check=True,stdout=subprocess.DEVNULL);booted=True
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as run:
        run.write(plistlib.dumps(config));run.flush()
        result=subprocess.run(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',run.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/'+('Apple5UITests/testPagesLightAndDark' if a.pages else 'Apple5FixUITests' if a.fix else 'Apple5AddendumUITests' if a.addendum else 'Apple5UITests/testFeatureBatch'),*(['-only-testing:WeftMatePhoneUITests/PhoneWindowUITests/testMemoryRoutes','-only-testing:WeftMatePhoneUITests/IOSUIShellUITests/testShellLightAndDark','-only-testing:WeftMatePhoneUITests/Apple11UITests/testReminderPageDark'] if a.pages else []),'-resultBundlePath',str(a.result)],stdout=open('/private/tmp/apple5-ui.log','w'),stderr=subprocess.STDOUT)
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if (a.pages and name.endswith(('-light','-dark'))) or name.startswith('apple5fix-' if a.fix else 'apple5add-' if a.addendum else 'apple5-'):shutil.copyfile(Path(out)/attachment['exportedFileName'],evidence/(name+'.png'))
    gpuAfter=list(Path('/Library/Logs/DiagnosticReports').glob('*gpuRestart*'))+list((Path.home()/'Library/Logs/DiagnosticReports').glob('*gpuRestart*'))
    crashAfter=set((Path.home()/'Library/Logs/DiagnosticReports').glob('*[Ww]eft[Mm]ate*'))
    info={'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'realPersonalHost':True,'syntheticNativeAdapter':True,'realCloud':False,'realHealthKit':False,'syntheticPresentationService':a.addendum or a.fix,'boots':prior['boots'],'gpuResetsAdded':len(set(gpuAfter)-set(reports)),'weftmateCrashesAdded':len(crashAfter-crashes)}
    (evidence/(('fix-ui-validation-boot-' if a.fix else 'addendum-ui-validation-boot-' if a.addendum else 'ui-validation-boot-')+str(prior['boots'])+'.json')).write_text(json.dumps(info,indent=2)+'\n');print(json.dumps(info),flush=True)
    if result.returncode or info['passed']!=(4 if a.pages else 2 if a.addendum or a.fix else 1) or info['failed'] or info['skipped']:raise RuntimeError('UI batch incomplete; see private log')
finally:
    subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
    service.terminate();service.wait(timeout=20)
    if presentation: presentation.terminate();presentation.wait(timeout=20)
    if booted:
        for _ in range(3):time.sleep(60)
