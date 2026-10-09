import json,os,subprocess,time
from pathlib import Path
repo=Path.home()/'Desktop/WeftMate/weftmate-h3'
root=Path('/private/tmp/weftmate-qa2/apple/mac-timed');root.mkdir(parents=True,exist_ok=True)
results=[]
for theme in ['light','dark']:
 start=time.monotonic()
 args=['python3','apps/apple/Tests/run_a10_mac.py','--app','apps/apple/Build/A11/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac','--capture','apps/apple/Build/A11MacCapture','--evidence',str(root),'--theme',theme]
 r=subprocess.run(args,cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 results.append({'theme':theme,'durationMs':round((time.monotonic()-start)*1000),'exitCode':r.returncode,'flow':'A10 login, 13 categories, native send, approval bar','substepDurationMs':None})
 print(json.dumps(results[-1]),flush=True)
(root/'timings.json').write_text(json.dumps(results,indent=2)+'\n')
