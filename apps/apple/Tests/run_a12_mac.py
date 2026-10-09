#!/usr/bin/env python3
"""Register/unregister the isolated A12 Mac bundle, capture own native UI, clean up."""
import argparse,hashlib,json,os,shutil,signal,subprocess,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--app',type=Path,required=True);p.add_argument('--capture',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True)
a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=True)
fixture=subprocess.Popen(['node','apps/apple/Tests/a12_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=open('/private/tmp/a12-mac-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=None;capture=None
try:
 meta=json.loads(fixture.stdout.readline())
 with urllib.request.urlopen(meta['driver']+'/ready')as r:ready=json.load(r)
 with open('/private/tmp/a12-mac-native.log','w')as log:
  capture=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(a.evidence.resolve()),'a12-login','light',ready['host'],ready['host'],'ephemeral'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  code=capture.wait(timeout=150)
 if code:raise RuntimeError('Native Mac capture exit '+str(code))
 report=json.loads((a.evidence/'native-report.json').read_text())
 assert report['realSMAppService'] and report['registerReadback'] and report['unregisterReadback']
 report['generatedAt']=datetime.now(timezone.utc).isoformat()
 report['binarySHA256']=hashlib.sha256(a.app.with_name(a.app.name+'.debug.dylib').read_bytes()).hexdigest()
 report['screenshots']=[{'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in sorted(a.evidence.glob('*.png'))]
 (a.evidence/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print('PASS real Mac SMAppService register / unregister system readback; native UI; isolated login item cleaned',flush=True)
finally:
 if capture and capture.poll()is None:
  os.killpg(capture.pid,signal.SIGTERM)
  try:capture.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(capture.pid,signal.SIGKILL);capture.wait()
 fixture.terminate()
 try:fixture.wait(timeout=20)
 except subprocess.TimeoutExpired:fixture.kill();fixture.wait()
 if meta:shutil.rmtree(meta['root'],ignore_errors=True)
