import hashlib,json
from pathlib import Path
r=Path.home()/'Desktop/WeftMate/weftmate-h3'
p=r/'apps/apple/Build/A13/Build/Products'
expected=json.loads((r/'apps/apple/Tests/Evidence/A13/validation.json').read_text())['implementationSHA256']
paths={'mac':p/'Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac.debug.dylib','iphone':p/'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone.debug.dylib','watch':p/'Debug-watchsimulator/WeftMateWatch.app/WeftMateWatch.debug.dylib'}
actual={k:hashlib.sha256(v.read_bytes()).hexdigest()for k,v in paths.items()}
print(json.dumps({'appleTreeAtA13AndQa3Start':'04ee40bef9364bfebd84b6f0e4090fbe8b197b66','qa3WindowsCommit':'1bbc863aa664d58105c0f1b086c5f8dc702c9235','expectedImplementationSha256':expected,'actualImplementationSha256':actual,'allMatch':actual==expected,'historicalTestResultsReused':False},indent=2))
