#!/usr/bin/env python3
"""Capture all gallery scenes from actual native Mac windows, sequentially, without global permissions."""
import argparse,json,os,shutil,subprocess,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=Path,required=True);p.add_argument('--capture',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True);a=p.parse_args()
a.evidence.mkdir(parents=True,exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a5_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a5-mac-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'});meta=None
try:
 meta=json.loads(fixture.stdout.readline())
 def get(path):return json.load(urllib.request.urlopen(meta['driver']+path))
 get('/a5/setup');get('/bootstrap');ready=get('/ready');get('/a5/review-login')
 commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
 catalog=json.loads((ROOT/'scripts/review-gallery/scenes.json').read_text())
 for theme in catalog['themes']:
  for scene in catalog['scenes']:
   now=datetime.now(timezone.utc);stem='review-mac-'+scene['id']+'-'+theme+'-'+now.strftime('%Y%m%dT%H%M%SZ')
   subprocess.run([str(a.capture.resolve()),str(a.app.resolve()),str((a.evidence/(stem+'.png')).resolve()),scene['id'],theme,ready['host'],ready['cloud']],check=True)
   (a.evidence/(stem+'.json')).write_text(json.dumps({'platform':'mac','scene':scene['id'],'theme':theme,'commit':commit,'generatedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'synthetic':True,'source':'实际 Mac 原生 App 自身窗口；真实隔离 cloud main / 宿主，合成 DSH 日志与模型'},ensure_ascii=False,indent=2)+'\n')
   print('Captured',theme,scene['id'],flush=True)
 (a.evidence/'validation-mac.json').write_text(json.dumps({'debugBuild':True,'nativeWindowsCaptured':len(catalog['themes'])*len(catalog['scenes']),'globalScreenCapture':False,'accessibilityPermissionRequested':False,'compiledDshEngine':False,'synthetic':True},indent=2)+'\n')
finally:
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
