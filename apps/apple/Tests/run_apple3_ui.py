#!/usr/bin/env python3
"""One headless small-device boot; synthetic loopback contracts; export only named screenshots."""
import argparse,json,os,plistlib,shutil,subprocess,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--xctestrun',type=Path,required=True);p.add_argument('--simulator',required=True);p.add_argument('--result',type=Path,required=True);p.add_argument('--boot-number',type=int,required=True);a=p.parse_args()
evidence=root/'apps/apple/Tests/Evidence/APPLE-3';evidence.mkdir(parents=True,exist_ok=True)
# Respect both system and per-user reports without recording machine-identifying report names.
reports=list(Path('/Library/Logs/DiagnosticReports').glob('*gpuRestart*'))+list((Path.home()/'Library/Logs/DiagnosticReports').glob('*gpuRestart*'))
if reports:
    delay=max(0,600-(time.time()-max(x.stat().st_mtime for x in reports)))
    while delay>0:time.sleep(min(delay,60));delay-=60
service=subprocess.Popen(['node','apps/apple/Tests/apple3_host_fixture.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=open('/private/tmp/apple3-logs/fixture.log','w'),text=True)
try:
    meta=json.loads(service.stdout.readline());config=plistlib.loads(a.xctestrun.read_bytes())
    def inject(v):
        if isinstance(v,dict):
            if 'TestBundlePath' in v:v.setdefault('EnvironmentVariables',{})['WEFTMATE_APPLE3_ORIGIN']=meta['origin']
            for child in v.values():inject(child)
        elif isinstance(v,list):
            for child in v:inject(child)
    inject(config)
    (evidence/'simulator-count.json').write_text(json.dumps({'boots':a.boot_number,'smallDevice':'iPhone SE (3rd generation)','windowOpened':False,'concurrentSimulators':1})+'\n')
    subprocess.run(['xcrun','simctl','boot',a.simulator],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=subprocess.DEVNULL)
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
        f.write(plistlib.dumps(config));f.flush()
        result=subprocess.run(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/Apple3UITests/testSmallScreenEvidenceBatch','-resultBundlePath',str(a.result)],stdout=open('/private/tmp/apple3-logs/ui.log','w'),stderr=subprocess.STDOUT)
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if name.startswith('apple3-'):shutil.copyfile(Path(out)/attachment['exportedFileName'],evidence/(name+'.png'))
    import urllib.request
    with urllib.request.urlopen(meta['origin']+'/fixture/apple3-report') as r:report=json.load(r)
    (evidence/'host-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    info={'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'syntheticOnly':True,'realCloud':False,'realHealthKit':False,'systemStatusBar':True,'boots':a.boot_number}
    (evidence/'ui-validation.json').write_text(json.dumps(info,indent=2)+'\n');print(json.dumps(info),flush=True)
    if result.returncode or info['passed']!=1 or info['failed'] or info['skipped']:raise RuntimeError('Native evidence test failed; see private log')
finally:
    subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True);service.terminate();service.wait(timeout=20)
    for _ in range(3):time.sleep(60)
