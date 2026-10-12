#!/usr/bin/env python3
"""One headless iPhone SE boot per invocation; durable boot budget and mandatory cooldown."""
import argparse, json, os, plistlib, shutil, subprocess, tempfile, time
from pathlib import Path
root = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser()
p.add_argument('--xctestrun', type=Path, required=True)
p.add_argument('--simulator', required=True)
p.add_argument('--result', type=Path, required=True)
p.add_argument('--polish-only', action='store_true')
p.add_argument('--all-ui', action='store_true')
a = p.parse_args()
evidence = root / 'apps/apple/Tests/Evidence/APPLE-4'
logs = Path('/private/tmp/apple4-logs'); logs.mkdir(exist_ok=True)
count_file = evidence / 'simulator-count.json'
previous = json.loads(count_file.read_text()) if count_file.exists() else {'boots': 0}
if previous['boots'] >= 5: raise RuntimeError('APPLE-4 simulator budget exhausted')
# Read the exact system safety probes before every batch; keep identifying names private.
with (logs / 'preflight.log').open('a') as f:
    subprocess.run(['sh', '-c', 'ls /Library/Logs/DiagnosticReports/ | grep gpuRestart | tail -1'], stdout=f)
    subprocess.run(['uptime'], stdout=f)
reports = list(Path('/Library/Logs/DiagnosticReports').glob('*gpuRestart*')) + list((Path.home()/'Library/Logs/DiagnosticReports').glob('*gpuRestart*'))
if reports:
    until = max(x.stat().st_mtime for x in reports) + 600
    while time.time() < until:
        print('Waiting for the required GPU cooldown', flush=True); time.sleep(min(60, until-time.time()))
service = subprocess.Popen(['node', 'apps/apple/Tests/apple3_host_fixture.mjs'], cwd=root, stdout=subprocess.PIPE, stderr=(logs/'fixture.log').open('w'), text=True)
try:
    meta = json.loads(service.stdout.readline()); config = plistlib.loads(a.xctestrun.read_bytes())
    def inject(value):
        if isinstance(value, dict):
            if 'TestBundlePath' in value: value.setdefault('EnvironmentVariables', {})['WEFTMATE_APPLE3_ORIGIN'] = meta['origin']
            for child in value.values(): inject(child)
        elif isinstance(value, list):
            for child in value: inject(child)
    inject(config)
    count = {'boots': previous['boots']+1, 'smallDevice': 'iPhone SE (3rd generation)', 'windowOpened': False, 'concurrentSimulators': 1}
    count_file.write_text(json.dumps(count, indent=2)+'\n')
    subprocess.run(['xcrun','simctl','boot',a.simulator],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True,stdout=(logs/'boot.log').open('w'))
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
        f.write(plistlib.dumps(config)); f.flush()
        extra = ['-only-testing:WeftMatePhoneUITests/Apple4UITests/testPanelAndSideChatPolishBatch'] if a.all_ui else []
        result = subprocess.run(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/Apple4UITests/'+('testPanelAndSideChatPolishBatch' if a.polish_only else 'testSmallScreenRefreshBatch'),'-resultBundlePath',str(a.result)] + extra,stdout=(logs/'ui.log').open('w'),stderr=subprocess.STDOUT)
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    attempt=evidence/('attempt-'+str(count['boots'])); attempt.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',out],check=True,stdout=subprocess.DEVNULL)
        for item in json.loads((Path(out)/'manifest.json').read_text()):
            for attachment in item['attachments']:
                name=attachment['suggestedHumanReadableName'].split('_0_')[0]
                if name.startswith('apple4-'): shutil.copyfile(Path(out)/attachment['exportedFileName'],attempt/(name+'.png'))
    info={'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'syntheticOnly':True,'realCloud':False,'realHealthKit':False,'boots':count['boots']}
    (attempt/'ui-validation.json').write_text(json.dumps(info,indent=2)+'\n'); print(json.dumps(info),flush=True)
    # Sanitize the service report to route coverage and request counts, never request credentials.
    import urllib.request
    with urllib.request.urlopen(meta['origin']+'/fixture/apple3-report') as r: report=json.load(r)
    (attempt/'host-report.json').write_text(json.dumps({'syntheticOnly':True,'routes':sorted(set(x['method']+' '+x['path'] for x in report['routes'])),'decisionCount':len(report['decisions'])},indent=2)+'\n')
    if result.returncode or info['passed']!=(2 if a.all_ui else 1) or info['failed'] or info['skipped']: raise RuntimeError('Native evidence batch failed; private log retains details')
    for file in attempt.glob('apple4-*.png'): shutil.copyfile(file,evidence/file.name)
    (evidence/('final-ui-validation.json' if a.all_ui else 'polish-validation.json' if a.polish_only else 'ui-validation.json')).write_text(json.dumps(info,indent=2)+'\n')
finally:
    subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
    service.terminate(); service.wait(timeout=20)
    print('All simulators shut down; cooling down for three minutes',flush=True)
    for _ in range(3): time.sleep(60)
