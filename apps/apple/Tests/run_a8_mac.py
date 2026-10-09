#!/usr/bin/env python3
"""A8: one native Mac window, real isolated cloud/host, deterministic synthetic events."""
import argparse,json,os,shutil,subprocess,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--app',type=Path,required=True);p.add_argument('--capture',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True)
cases={'loading':[], 'conversation':['tools'], 'approval':['tools','approvals'], 'outputs-sources':['tools','artifact'], 'failure':['tools','artifact','failure'], 'stopped':['tools','stop'], 'unknown-limit':['unknown']}
commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
for theme in ['light','dark']:
 for scene,stages in cases.items():
  fixture=subprocess.Popen(['node','apps/apple/Tests/a5_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a8-mac-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
  meta=None
  try:
   meta=json.loads(fixture.stdout.readline())
   def get(path):return json.load(urllib.request.urlopen(meta['driver']+path))
   get('/a5/setup');get('/bootstrap');get('/a8/prepare');ready=get('/ready')
   for stage in stages:get('/a8/'+stage)
   now=datetime.now(timezone.utc);stamp=now.strftime('%Y%m%dT%H%M%SZ')
   review=scene in ['conversation','approval','outputs-sources'];stem=('review' if review else 'a8')+'-mac-'+scene+'-'+theme+'-'+stamp
   subprocess.run([str(a.capture.resolve()),str(a.app.resolve()),str((a.evidence/(stem+'.png')).resolve()),scene if review else 'conversation',theme,ready['host'],ready['cloud'],'a8'],check=True)
   (a.evidence/(stem+'.json')).write_text(json.dumps({'platform':'mac','scene':scene,'theme':theme,'commit':commit,'generatedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'synthetic':True,'source':'实际 Mac 原生 App 自身窗口；真实隔离 cloud main / 宿主，合成 DSH 日志与模型'},ensure_ascii=False,indent=2)+'\n')
   print('Captured',theme,scene,flush=True)
  finally:
   fixture.terminate()
   try:fixture.wait(timeout=20)
   except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
   if meta:shutil.rmtree(meta['root'],ignore_errors=True)
