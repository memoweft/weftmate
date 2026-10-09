#!/usr/bin/env python3
"""A11 native Mac or one iPhone, real isolated HTTP projects, synthetic DSH/root inspection."""
import argparse, hashlib, json, os, plistlib, shutil, signal, subprocess, tempfile, urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--platform', choices=['mac','iphone'], required=True)
p.add_argument('--theme', choices=['light','dark'], required=True)
p.add_argument('--remote', action='store_true')
p.add_argument('--app', type=Path); p.add_argument('--capture', type=Path)
p.add_argument('--xctestrun', type=Path); p.add_argument('--simulator'); p.add_argument('--result', type=Path)
p.add_argument('--evidence', type=Path, required=True)
a = p.parse_args(); a.evidence.mkdir(parents=True, exist_ok=True)
fixture = subprocess.Popen(['node','apps/apple/Tests/a11_fixture.mjs'], cwd=ROOT, stdout=subprocess.PIPE, stderr=open('/private/tmp/a11-'+a.platform+'-'+a.theme+'.log','w'), text=True, env=os.environ | {'TMPDIR':'/private/tmp'})
meta = None; child = None
try:
    meta = json.loads(fixture.stdout.readline())
    def get(path):
        with urllib.request.urlopen(meta['driver']+path, timeout=30) as r: return json.load(r)
    ready = get('/ready')
    if a.platform == 'mac':
        scene = 'a11-remote' if a.remote else 'a11-all'
        flags = ['ephemeral'] + ([] if a.remote else ['a11-local-host='+ready['hostId']])
        child = subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(a.evidence.resolve()),scene,a.theme,ready['host'],ready['cloud'],*flags],start_new_session=True)
        status = child.wait(timeout=240)
        if status: raise RuntimeError('Native Mac A11 failed: '+str(status))
        native = json.loads((a.evidence/'native-report.json').read_text())
        assert native['authenticated'] and native['projectSent'] and native['moved'] and native['restrictedNotice']
        assert native['projectCreated'] != a.remote
    else:
        config = plistlib.loads(a.xctestrun.read_bytes())
        def inject(v):
            if isinstance(v,dict):
                if 'TestBundlePath' in v: v.setdefault('EnvironmentVariables',{})['WEFTMATE_A11_DRIVER'] = meta['driver']
                for c in v.values(): inject(c)
            elif isinstance(v,list):
                for c in v: inject(c)
        inject(config)
        with tempfile.NamedTemporaryFile(suffix='.xctestrun',dir=a.xctestrun.parent) as f:
            f.write(plistlib.dumps(config)); f.flush()
            subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
            subprocess.run(['xcrun','simctl','boot',a.simulator],check=True)
            subprocess.run(['xcrun','simctl','bootstatus',a.simulator,'-b'],check=True)
            name = 'test'+a.theme.title()+'ProjectsAndRestrictedSession'
            child = subprocess.Popen(['xcodebuild','test-without-building','-xctestrun',f.name,'-destination','platform=iOS Simulator,id='+a.simulator,'-jobs','2','-only-testing:WeftMatePhoneUITests/A11ProjectsUITests/'+name,'-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-resultBundlePath',str(a.result)])
            status = child.wait()
            subprocess.run(['xcrun','simctl','shutdown','all'],check=True)
            if status: raise RuntimeError('Native iPhone A11 failed: '+str(status))
        native = json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(a.result)],text=True))
        assert native['passedTests']==1 and native['failedTests']==0 and native['skippedTests']==0
        with tempfile.TemporaryDirectory() as export:
            subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(a.result),'--output-path',export],check=True)
            for test in json.loads((Path(export)/'manifest.json').read_text()):
                for shot in test['attachments']:
                    name = shot['suggestedHumanReadableName'].split('_0_')[0]
                    if name.startswith('a11-iphone-'): shutil.copyfile(Path(export)/shot['exportedFileName'],a.evidence/(name+'.png'))
    report = get('/report')
    sends = [r for r in report['operations'] if r.get('kind')=='send' and r.get('text')=='A11 合成项目消息']
    assert len(sends)==1
    restricted = ready['restrictedId']
    forbidden = [r for r in report['traffic'] if '/sessions/'+restricted+'/' in r['path'] and r['path'].split('/')[-1] in ['approvals','questions','commands','approval-mode']]
    assert not forbidden
    assert not any(r['path'].startswith('/personal/v1/tasks/') for r in report['traffic']), 'No task detail should be fetched in this fixture'
    created = next(r for r in report['creates'] if r['sessionId']==sends[0]['sessionId'])
    assert created.get('projectId')
    if a.platform=='mac' and not a.remote:
        assert created['projectId']!=ready['projectId'] and created['permission']=='write' and created['instructions']=='只使用合成资料，输出简洁中文。'
        assert native['settingsAndRemoval'] and native['syntheticFilePreserved']
        assert sum(r['method']=='POST' and r['path']=='/personal/v1/projects' for r in report['traffic'])==1
        assert sum(r['method']=='PATCH' and r['path']=='/personal/v1/projects/'+created['projectId'] for r in report['traffic'])==1
        assert sum(r['method']=='DELETE' and r['path']=='/personal/v1/projects/'+created['projectId'] for r in report['traffic'])==1
    else: assert created['projectId']==ready['projectId']
    # Public evidence excludes transient host/local filesystem paths and cookies.
    screenshots = [{'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(a.evidence.glob('*.png'))]
    validation = dict(platform=a.platform, theme=a.theme, remote=a.remote, authenticated=True, passed=1, failed=0, skipped=0,
        realPersonalHTTP=True, realProjectStore=True, syntheticRootInspector=True, syntheticDsh=True, syntheticRestrictedProjection=True,
        projectSendCount=len(sends), restrictedTaskRequests=len(forbidden), projectCreateRequests=sum(r['method']=='POST' and r['path']=='/personal/v1/projects' for r in report['traffic']),
        moved=any(r.get('sessionId')==ready['ordinaryId'] and (r.get('projectId')==ready['projectId'] or (a.platform=='mac' and not a.remote and r.get('projectId') is None)) for r in report['sessions']),
        projectRemoved=a.platform=='mac' and not a.remote and len(report['projects'])==1,
        generatedAt=datetime.now(timezone.utc).isoformat(),commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(), screenshots=screenshots,
        xcodeJobs=2,simulatorsAtOnce=1 if a.platform=='iphone' else 0)
    sources = sorted((ROOT/'apps/apple/UI').glob('*.swift')) + sorted((ROOT/'apps/apple/Packages/WeftMateCore/Sources/WeftMateCore').glob('*.swift'))
    source_hash = hashlib.sha256()
    for source in sources:
        source_hash.update(str(source.relative_to(ROOT)).encode()); source_hash.update(source.read_bytes())
    binary = a.app.with_name('WeftMateMac.debug.dylib') if a.platform=='mac' else a.xctestrun.parent/'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone'
    validation['sourcesSHA256']=source_hash.hexdigest()
    validation['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest()
    if a.platform=='mac':
        validation['nativeFolderPanelOpened']=native['nativeFolderPanelOpened']
        validation['nativeFolderSelectionConfirmed']=native['nativeFolderSelectionConfirmed']
        validation['syntheticFolderSelection']=native['syntheticFolderSelection']
    assert validation['moved']
    (a.evidence/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
    print('PASS A11',a.platform,a.theme,'remote' if a.remote else 'projects',len(screenshots),'native screenshots; restricted task requests 0',flush=True)
finally:
    if child and child.poll() is None:
        if a.platform=='mac': os.killpg(child.pid,signal.SIGTERM)
        else: child.terminate()
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            if a.platform=='mac': os.killpg(child.pid,signal.SIGKILL)
            else: child.kill()
            child.wait()
    if a.platform=='iphone': subprocess.run(['xcrun','simctl','shutdown','all'],capture_output=True)
    fixture.terminate()
    try: fixture.wait(timeout=20)
    except subprocess.TimeoutExpired: fixture.kill();fixture.wait()
    if meta: shutil.rmtree(meta['root'],ignore_errors=True)
