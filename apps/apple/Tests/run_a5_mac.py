#!/usr/bin/env python3
"""Capture all gallery scenes from actual native Mac windows, sequentially, without global permissions."""
import argparse,json,os,shutil,subprocess,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=Path,required=True);p.add_argument('--capture',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True);p.add_argument('--scene');p.add_argument('--settings-categories',action='store_true');p.add_argument('--theme',choices=['light','dark']);p.add_argument('--ephemeral-credentials',action='store_true');a=p.parse_args()
a.evidence.mkdir(parents=True,exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a5_cloud_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a5-mac-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'});meta=None
try:
 meta=json.loads(fixture.stdout.readline())
 def get(path):return json.load(urllib.request.urlopen(meta['driver']+path))
 get('/a5/setup');get('/bootstrap');ready=get('/ready');get('/a5/review-login')
 if a.settings_categories and a.scene=='archived':get('/a7/seed-archived')
 commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
 catalog=json.loads((ROOT/'scripts/review-gallery/scenes.json').read_text())
 themes=[a.theme] if a.theme else catalog['themes']
 scenes=([{'id': 'settings-'+id} for id in ['general','appearance','account','devices','usage','models','approvals','memory','schedules','system','backups','archived','about'] if not a.scene or id == a.scene] if a.settings_categories else [scene for scene in catalog['scenes'] if not a.scene or scene['id']==a.scene])
 if a.scene in ['memory-forget','conversation-forget']:scenes=[{'id':a.scene}]
 if not scenes:raise ValueError('Unknown review scene')
 for theme in themes:
  for scene in scenes:
   now=datetime.now(timezone.utc);review_scene=scene['id'].removeprefix('settings-')
   prefix='a7' if review_scene in ['memory-forget','conversation-forget','archived'] else 'review' if review_scene in ['appearance','usage'] or not a.settings_categories else 'category'
   stem=prefix+'-mac-'+review_scene+'-'+theme+'-'+now.strftime('%Y%m%dT%H%M%SZ')
   subprocess.run([str(a.capture.resolve()),str(a.app.resolve()),str((a.evidence/(stem+'.png')).resolve()),scene['id'],theme,ready['host'],ready['cloud'],*(['ephemeral'] if a.ephemeral_credentials else [])],check=True)
   (a.evidence/(stem+'.json')).write_text(json.dumps({'platform':'mac','scene':review_scene,'theme':theme,'commit':commit,'generatedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'synthetic':True,'source':'实际 Mac 原生 App 自身窗口；真实隔离 cloud main / 宿主，合成 DSH 日志与模型'},ensure_ascii=False,indent=2)+'\n')
   print('Captured',theme,scene['id'],flush=True)
 if not a.scene and not a.theme:(a.evidence/'validation-mac.json').write_text(json.dumps({'debugBuild':True,'nativeWindowsCaptured':len(themes)*len(scenes),'globalScreenCapture':False,'accessibilityPermissionRequested':False,'compiledDshEngine':False,'synthetic':True},indent=2)+'\n')
finally:
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
