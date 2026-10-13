#!/usr/bin/env python3
"""One bounded, headless simulator run; only synthetic app-owned scenes."""
import argparse
import json
from pathlib import Path
import plistlib
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',type=Path,required=True);parser.add_argument('--derived-data',type=Path,required=True);parser.add_argument('--device',required=True)
    args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True)
    result=args.artifacts/'apple9.xcresult'
    reports=[]
    for directory in [Path('/Library/Logs/DiagnosticReports'),Path.home()/'Library/Logs/DiagnosticReports']:
        if directory.exists():reports.extend(p for p in directory.iterdir() if any(s in p.name.lower() for s in ['gpurestart','windowserver','weftmatephone']))
    baseline={p.name:p.stat().st_mtime for p in reports}
    latest=max((stamp for name,stamp in baseline.items() if 'gpurestart' in name.lower() or 'windowserver' in name.lower()),default=0)
    if time.time()-latest < 600:raise RuntimeError('Recent graphics reset; wait at least ten minutes before starting.')
    if result.exists():raise RuntimeError('Use a new artifacts directory; preserve the previous result.')
    server=subprocess.Popen(['node',str(ROOT/'Tests/phone_model_services_server.mjs')],stdout=subprocess.PIPE,text=True)
    try:
        line=server.stdout.readline();origin=json.loads(line)['origin']+'/v1'
        candidates=list((args.derived_data/'Build/Products').glob('*iphonesimulator*.xctestrun'))
        if not candidates:raise RuntimeError('Expected a simulator xctestrun from build-for-testing.')
        candidates.sort(key=lambda p:p.stat().st_mtime,reverse=True)
        data=plistlib.loads(candidates[0].read_bytes())
        targets=data.get('TestConfigurations',[{}])[0].get('TestTargets',[])
        if not targets:targets=[v for k,v in data.items() if k!='__xctestrun_metadata__' and isinstance(v,dict)]
        for target in targets:
            target.setdefault('EnvironmentVariables',{})['APPLE9_MODEL_URL']=origin
        injected=candidates[0].with_name('apple9-injected.xctestrun');injected.write_bytes(plistlib.dumps(data))
        started=time.time()
        command=['xcodebuild','test-without-building','-xctestrun',str(injected),'-destination','platform=iOS Simulator,id='+args.device,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/Apple9UITests/testServiceAndComputerScreenshots','-resultBundlePath',str(result)]
        with (args.artifacts/'xcodebuild.log').open('w') as log:completed=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=540)
        subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
        current=[]
        for directory in [Path('/Library/Logs/DiagnosticReports'),Path.home()/'Library/Logs/DiagnosticReports']:
            if directory.exists():current.extend(p for p in directory.iterdir() if any(s in p.name.lower() for s in ['gpurestart','windowserver','weftmatephone']))
        new=[p.name for p in current if p.name not in baseline and p.stat().st_mtime>=started]
        (args.artifacts/'run.json').write_text(json.dumps({'exit':completed.returncode,'simulatorStarts':1,'newReports':new,'systemBootTime':subprocess.check_output(['sysctl','-n','kern.boottime'],text=True).strip(),'screenshots':'real full-screen XCTest attachments, synthetic states; no production account/provider/computer'},ensure_ascii=False,indent=2)+'\n')
        if result.exists():subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(result),'--output-path',str(args.artifacts/'attachments')],check=True)
        if completed.returncode:raise RuntimeError('UI checks failed; see preserved xcodebuild.log and xcresult.')
        if new:raise RuntimeError('New graphics/product diagnostic report; do not restart the simulator.')
        print('PASS: one headless simulator start; shutdown complete; attachments exported.')
    finally:
        server.terminate();server.wait(timeout=10)
        subprocess.run(['xcrun','simctl','shutdown','all'],check=False)
if __name__=='__main__':
    try:main()
    except Exception as error:print('FAIL Apple9UI:',error);raise SystemExit(1)
