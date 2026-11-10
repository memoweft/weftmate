#!/usr/bin/env python3
"""Run bounded watch rendering and interaction proof in an isolated CI simulator."""
import argparse
import json
from pathlib import Path
import subprocess
from bounded_process import run_bounded

parser=argparse.ArgumentParser()
parser.add_argument('--artifacts',type=Path,required=True)
parser.add_argument('--derived-data',type=Path,required=True)
args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]
devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json'],text=True))['devices']
watch=next((row['udid'] for runtime,rows in devices.items() if 'watchOS' in runtime for row in rows if row.get('isAvailable')),None)
if not watch:
    raise SystemExit('No watchOS simulator runtime is installed; no watch UI proof produced.')
result=args.artifacts/'watch-ui.xcresult'
try:
    subprocess.run(['xcrun','simctl','boot',watch],check=False,capture_output=True)
    run_bounded(['xcrun','simctl','bootstatus',watch,'-b'],timeout=180,check=True)
    command=['xcodebuild','test','-project',str(root/'WeftMate.xcodeproj'),'-scheme','WeftMateWatch',
             '-configuration','Debug','-destination','platform=watchOS Simulator,id='+watch,
             '-derivedDataPath',str(args.derived_data),'-resultBundlePath',str(result),
             '-only-testing:WeftMateWatchUITests/WatchRoutingUITests','-parallel-testing-enabled','NO',
             '-jobs','2','-collect-test-diagnostics','never','CODE_SIGNING_ALLOWED=NO']
    with (args.artifacts/'watch-ui.log').open('w') as log:
        completed=run_bounded(command,timeout=900,stdout=log,stderr=subprocess.STDOUT)
    if result.exists():
        summary=subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(result)],text=True)
        (args.artifacts/'watch-ui-summary.json').write_text(summary)
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(result),'--output-path',str(args.artifacts/'screenshots')],check=True)
    raise SystemExit(completed.returncode)
finally:
    subprocess.run(['xcrun','simctl','shutdown',watch],capture_output=True)
