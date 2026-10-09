"""QA-3 read-only Apple runner; wait for A14 to release the Mac first."""
import json, os, signal, subprocess, time, hashlib
from pathlib import Path
repo=Path.home()/'Desktop/WeftMate/weftmate-h3'
out=Path('/tmp/weftmate-qa3-apple');out.mkdir(exist_ok=True)
env=os.environ|{'PATH':str(Path.home()/'.local/bin')+':'+os.environ['PATH']}
report={'syntheticOnly':True,'productCodeModified':False,'host':'Mac local isolated HTTP fixture, deterministic planner; no compiled DSH or paid model','batches':[],'startedAt':time.time()}
def save(): (out/'batches.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
def command(*args):return subprocess.check_output(args,cwd=repo,env=env,text=True).strip()
def run(name,args,timeout=900):
 t=time.time();print('START',name,flush=True)
 with (out/(name+'.log')).open('w')as log:
  p=subprocess.Popen(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   code=124
 report['batches'].append({'name':name,'startedAtUnix':t,'durationSec':round(time.time()-t,3),'exitCode':code});save()
 print('END',name,code,flush=True)
 subprocess.run(['xcrun','simctl','shutdown','all'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 return code
print('Waiting for A14 done marker; no native apps or simulators started.',flush=True)
while not (Path.home()/'.weftmate-orchestrator/a14.done').exists():time.sleep(10)
report['resourceReleasedAt']=time.time();report['fixtureSourceCommit']=command('git','rev-parse','HEAD')
products=repo/'apps/apple/Build/A13/Build/Products'
mac=products/'Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac';capture=repo/'apps/apple/Build/A13MacCapture'
phoneRun=next(products.glob('WeftMatePhone_iphonesimulator*.xctestrun'))
watchRun=next(products.glob('WeftMateWatch_watchsimulator*.xctestrun'))
report['prebuiltBinarySha256']={name:hashlib.sha256(path.read_bytes()).hexdigest()for name,path in {'mac':mac,'phone':products/'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone','watch':products/'Debug-watchsimulator/WeftMateWatch.app/WeftMateWatch'}.items()}
report['binaryProvenance']='Existing A13 binaries; fixture git HEAD may include later A14. Do not equate fixture HEAD with compiled binary version.';save()
devices=[];pair=None
try:
 run('mac-a10',['python3','apps/apple/Tests/run_a10_mac.py','--app',str(mac),'--capture',str(capture),'--evidence',str(out/'a10')])
 for theme in ['light','dark']:
  run('mac-projects-'+theme,['python3','apps/apple/Tests/run_a11.py','--platform','mac','--theme',theme,'--remote','--app',str(mac),'--capture',str(capture),'--evidence',str(out/('projects-mac-'+theme))])
  run('mac-a13-'+theme,['python3','apps/apple/Tests/run_a13.py','--platform','mac','--theme',theme,'--app',str(mac),'--capture',str(capture),'--evidence',str(out/'a13')])
 types=json.loads(command('xcrun','simctl','list','devicetypes','-j'))['devicetypes']
 runtimes=json.loads(command('xcrun','simctl','list','runtimes','-j'))['runtimes']
 phoneType=next(d['identifier']for d in types if d['name']=='iPhone 17')
 ios=next(r['identifier']for r in runtimes if r['name']=='iOS 26.2')
 phone=command('xcrun','simctl','create','QA3 iPhone',phoneType,ios);devices.append(phone);report['createdDevices']=devices;save()
 for phase in ['a6-light','a6-dark','a7-light','a9-after-light']:
  run('iphone-'+phase,['python3','apps/apple/Tests/run_a5_ui.py','--xctestrun',str(phoneRun),'--simulator',phone,'--phase',phase,'--result',str(out/(phase+'.xcresult')),'--evidence',str(out/('iphone-'+phase))])
 for theme in ['light','dark']:
  run('iphone-projects-'+theme,['python3','apps/apple/Tests/run_a11.py','--platform','iphone','--theme',theme,'--xctestrun',str(phoneRun),'--simulator',phone,'--result',str(out/('projects-'+theme+'.xcresult')),'--evidence',str(out/('projects-phone-'+theme))])
  run('iphone-a13-'+theme,['python3','apps/apple/Tests/run_a13.py','--platform','iphone','--theme',theme,'--xctestrun',str(phoneRun),'--simulator',phone,'--result',str(out/('a13-'+theme+'.xcresult')),'--evidence',str(out/'a13')])
 # Only the final phase boots a Watch; one paired phone+watch is required for actual reachability.
 watchType=next(d['identifier']for d in types if 'Apple Watch Series 11' in d['name'] and '46mm' in d['name'])
 watchOs=next(r['identifier']for r in runtimes if r['name']=='watchOS 26.2')
 watch=command('xcrun','simctl','create','QA3 Watch',watchType,watchOs);devices.append(watch)
 pair=command('xcrun','simctl','pair',watch,phone);report['createdPair']=pair;save()
 run('watch-live',['python3','apps/apple/Tests/run_a12_watch.py','--phone',phone,'--watch',watch,'--products',str(products),'--xctestrun',str(watchRun),'--result',str(out/'watch.xcresult'),'--evidence',str(out/'watch')])
finally:
 subprocess.run(['xcrun','simctl','shutdown','all'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if pair:subprocess.run(['xcrun','simctl','unpair',pair],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for device in devices:subprocess.run(['xcrun','simctl','delete',device],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 report['finishedAt']=time.time();report['ownedSimulatorsDeleted']=True;save()
