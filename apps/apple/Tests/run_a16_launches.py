#!/usr/bin/env python3
"""Twenty serial Mac launches against one isolated synthetic host; no global UI access."""
import argparse,hashlib,json,os,shutil,signal,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--app',type=Path,required=True);p.add_argument('--capture',type=Path,required=True)
p.add_argument('--evidence',type=Path,default=ROOT/'apps/apple/Tests/Evidence/A16');a=p.parse_args()
a.evidence.mkdir(parents=True,exist_ok=True);(a.evidence/'mac-launches.json').unlink(missing_ok=True);records=[];meta=None;child=None
with tempfile.TemporaryDirectory(prefix='a16-launch-driver-') as logs:
 with open(Path(logs)/'fixture.log','w') as log:
  fixture=subprocess.Popen(['node','apps/apple/Tests/a16_fixture.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=log,text=True,env=os.environ|{'TMPDIR':'/private/tmp'},start_new_session=True)
  try:
   meta=json.loads(fixture.stdout.readline())
   with urllib.request.urlopen(meta['driver']+'/ready') as r:ready=json.load(r)
   for i in range(20):
    with tempfile.TemporaryDirectory(prefix='a16-launch-') as dest:
     image=Path(dest)/'window.png';started=time.monotonic()
     child=subprocess.Popen([str(a.capture.resolve()),str(a.app.resolve()),str(image),'a16-launch','light' if i%2==0 else 'dark',ready['host'],ready['host'],'a8','ephemeral'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
     output,_=child.communicate(timeout=50)
     if child.returncode or not image.exists():raise RuntimeError('Launch '+str(i+1)+' failed: '+output[-500:])
     data=image.read_bytes()
     if not data.startswith(b'\x89PNG\r\n\x1a\n'):raise RuntimeError('Missing native window PNG')
     records.append({'launch':i+1,'exitCode':child.returncode,'ownWindowPNG':True,'windowSHA256':hashlib.sha256(data).hexdigest(),'seconds':round(time.monotonic()-started,2)})
     if i in (0,19):
      images=a.evidence/'mac-launches';images.mkdir(exist_ok=True);shutil.copyfile(image,images/('launch-'+str(i+1)+'.png'))
     print('PASS launch',i+1,flush=True)
   binary=a.app.with_name(a.app.name+'.debug.dylib')
   (a.evidence/'mac-launches.json').write_text(json.dumps({'launches':records,'passed':len(records)==20,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest()},indent=2)+'\n')
  finally:
   if child and child.poll() is None:
    os.killpg(child.pid,signal.SIGTERM)
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   os.killpg(fixture.pid,signal.SIGTERM)
   try:fixture.wait(timeout=20)
   except subprocess.TimeoutExpired:os.killpg(fixture.pid,signal.SIGKILL);fixture.wait()
   if meta:shutil.rmtree(meta['root'],ignore_errors=True)
