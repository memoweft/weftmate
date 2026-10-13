#!/usr/bin/env python3
"""One headless 16 Pro; bounded boots, private logs, paired full-screen capture paths."""
import argparse,json,os,plistlib,subprocess,tempfile,time,urllib.request,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--test',default='Apple6UITests');p.add_argument('--result',type=Path,required=True);a=p.parse_args()
sim='BBCBCE9F-A92D-491C-A4D3-ADBBD2662394'
evidence=root/'apps/apple/Tests/Evidence/APPLE-6';evidence.mkdir(parents=True,exist_ok=True)
ledger=evidence/'simulator-ledger.json';prior=json.loads(ledger.read_text()) if ledger.exists() else {'boots':0,'batches':[]}
if prior['boots']>=6:raise RuntimeError('Six simulator starts exhausted')
if prior.get('coolUntil',0)>time.time():raise RuntimeError('Cooling interval still active')
def inventory():
    files=[]
    for folder in [Path('/Library/Logs/DiagnosticReports'),Path.home()/'Library/Logs/DiagnosticReports']:
        if folder.exists():
            for file in folder.iterdir():
                if any(x in file.name.lower() for x in ['gpurestart','windowserver','weftmate']):files.append((str(file),file.stat().st_mtime))
    return set(files)
before=inventory(); uptime=subprocess.check_output(['uptime'],text=True).strip()
bootTime=time.time()-float(subprocess.check_output(['sysctl','-n','kern.boottime'],text=True).split('sec = ')[1].split(',')[0])
private=Path(tempfile.mkdtemp(prefix='apple6-ui-',dir='/private/tmp'));private.chmod(0o700)
services=[];meta=None;booted=False
shots=evidence/('simctl-boot-'+str(prior['boots']+1));shots.mkdir(exist_ok=True)
try:
    env=os.environ|{'TMPDIR':'/private/tmp','WEFTMATE_APPLE6_SHOTS':str(shots),'WEFTMATE_APPLE6_SIMULATOR':sim,'WEFTMATE_APPLE6_HEALTH_ZONE':'America/Los_Angeles'}
    cloud=subprocess.Popen(['node','apps/apple/Tests/apple6_ui_driver.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=open(private/'cloud.log','w'),text=True,env=env);services.append(cloud)
    line=cloud.stdout.readline()
    if not line:raise RuntimeError('Local synthetic cloud failed; private cloud.log')
    meta=json.loads(line)
    host=subprocess.Popen(['node','apps/apple/Tests/apple5_real_host.mjs',str(private/'host.json')],cwd=root,stdout=subprocess.PIPE,stderr=open(private/'host.log','w'),text=True,env=env);services.append(host)
    ready=json.loads(host.stdout.readline());hostmeta=json.loads((private/'host.json').read_text())
    variables={'WEFTMATE_APPLE6_DRIVER':meta['driver'],'WEFTMATE_APPLE5_ORIGIN':hostmeta['origin'],'WEFTMATE_APPLE5_USERNAME':hostmeta['username'],'WEFTMATE_APPLE5_PASSWORD':hostmeta['password']}
    xctestrun=Path('/private/tmp/apple6-build/Build/Products/WeftMatePhone_iphonesimulator26.2-x86_64.xctestrun');config=plistlib.loads(xctestrun.read_bytes())
    def inject(value):
        if isinstance(value,dict):
            if 'TestBundlePath' in value:value.setdefault('EnvironmentVariables',{}).update(variables)
            for child in value.values():inject(child)
        elif isinstance(value,list):
            for child in value:inject(child)
    inject(config)
    prior['boots']+=1;ledger.write_text(json.dumps(prior,indent=2)+'\n')
    subprocess.run(['xcrun','simctl','boot',sim],check=True,stdout=open(private/'boot.log','w'),stderr=subprocess.STDOUT);booted=True
    subprocess.run(['xcrun','simctl','bootstatus',sim,'-b'],check=True,stdout=open(private/'bootstatus.log','w'),stderr=subprocess.STDOUT)
    with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=xctestrun.parent) as f:
        f.write(plistlib.dumps(config));f.flush()
        result=subprocess.run(['xcodebuild','test-without-building','-collect-test-diagnostics','never','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+sim,'-jobs','4','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:WeftMatePhoneUITests/'+a.test,'-resultBundlePath',str(a.result)],stdout=open(private/'ui.log','w'),stderr=subprocess.STDOUT)
    summary=json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
    export=private/'attachments';subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',str(export)],check=True,stdout=subprocess.DEVNULL)
    for item in json.loads((export/'manifest.json').read_text()):
        for attachment in item['attachments']:
            name=attachment['suggestedHumanReadableName'].split('_0_')[0]
            if name.startswith('apple6-'):shutil.copyfile(export/attachment['exportedFileName'],evidence/(name+'.png'))
    with urllib.request.urlopen(meta['driver']+'/report') as response:report=json.load(response)
    (evidence/('http-report-boot-'+str(prior['boots'])+'.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'privateLog':str(private/'ui.log')}),flush=True)
    (evidence/('ui-boot-'+str(prior['boots'])+'.json')).write_text(json.dumps({'passed':summary['passedTests'],'failed':summary['failedTests'],'skipped':summary['skippedTests'],'exitCode':result.returncode,'test':a.test},indent=2)+'\n')
finally:
    subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
    after=inventory();changes=after-before
    afterUptime=subprocess.check_output(['uptime'],text=True).strip()
    afterBoot=time.time()-float(subprocess.check_output(['sysctl','-n','kern.boottime'],text=True).split('sec = ')[1].split(',')[0])
    entry={'boot':prior['boots'],'headless':True,'device':'WeftMate shots iPhone 16 Pro','simultaneousDevices':1,'uptimeBefore':uptime,'uptimeAfter':afterUptime,'rebootObserved':afterBoot<bootTime,'gpuRestartOrWindowServerAdded':sum(any(k in f.lower() for k in ['gpurestart','windowserver']) for f,t in changes),'weftmateCrashAdded':sum('weftmate' in f.lower() for f,t in changes)}
    prior['batches'].append(entry);prior['coolUntil']=time.time()+(600 if entry['gpuRestartOrWindowServerAdded'] else 180);ledger.write_text(json.dumps(prior,indent=2)+'\n')
    for service in reversed(services):
        service.terminate()
        try:service.wait(timeout=20)
        except subprocess.TimeoutExpired:service.kill();service.wait()
    print(json.dumps(entry),flush=True)
