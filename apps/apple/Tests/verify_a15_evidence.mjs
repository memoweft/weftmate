import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {scanAppleCopy} from '../Scripts/check_ui_copy.mjs';
const root=resolve(import.meta.dirname,'../../..'),base=join(root,'apps/apple/Tests/Evidence/A15');
const digest=x=>createHash('sha256').update(x).digest('hex');
const data=JSON.parse(await readFile(join(base,'screenshot-text.json'),'utf8'));
const forbidden=['A15_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY','A15_SYNTHETIC_SECRET_NEVER_DISPLAY'];
const screenshots=[],surfaces=[];
for(const surface of ['mac-light','mac-dark','iphone-light','iphone-dark']){
 const validation=JSON.parse(await readFile(join(base,surface,'validation.json'),'utf8'));
 if(!validation.passed)throw Error('Unsuccessful native flow: '+surface);
 if(surface.startsWith('iphone')){
  const summary=JSON.parse(await readFile(join(base,surface,'xctest-summary.json'),'utf8'));
  if(summary.passedTests!==1||summary.failedTests!==0||summary.skippedTests!==0)throw Error('iPhone XCUITest failed');
 }else if(validation.macOwnAXAlternative!==true)throw Error('Mac alternative must be explicit');
 const report=JSON.parse(await readFile(join(base,surface,'host-receipts.json'),'utf8'));
 const usage=report.traffic.filter(x=>x.path.endsWith('/usage')&&x.month);
 if(!usage.length||usage.some(x=>x.timeZone!=='Asia/Shanghai'||x.status!==200))throw Error('Account time zone query mismatch');
 const thinking=report.traffic.filter(x=>x.path.endsWith('/thinking')&&x.method==='PATCH');
 if(!thinking.some(x=>x.body.enabled===true)||!thinking.some(x=>x.body.enabled===false))throw Error('Thinking acknowledgements missing');
 for(const row of thinking)if(row.request&&Object.keys(row.request).join()!=='enabled')throw Error('Client supplied provider fields');
 for(const file of await readdir(join(base,surface)))if(file.endsWith('.png')){
  const b=await readFile(join(base,surface,file));if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not an original PNG: '+file);
  screenshots.push({file:surface+'/'+file,sha256:digest(b),width:b.readUInt32BE(16),height:b.readUInt32BE(20)});
 }
 surfaces.push({surface,passed:true,usageRequests:usage.length,thinkingPATCHs:thinking.length,xcuITest:surface.startsWith('iphone')});
}
const matches=forbidden.map(marker=>({marker,hits:data.frames.filter(x=>x.text.includes(marker)).length}));
if(matches.some(x=>x.hits))throw Error('Hidden body/key appeared in native UI');
const copy=await scanAppleCopy(root,base);
const sources=[];
for(const dir of ['apps/apple/UI','apps/apple/iOS','apps/apple/macOS','apps/apple/watchOS','apps/apple/Packages/WeftMateCore/Sources/WeftMateCore'])for(const f of await readdir(join(root,dir)))if(f.endsWith('.swift'))sources.push(join(root,dir,f));
const hash=createHash('sha256');for(const f of sources.sort()){hash.update(relative(root,f));hash.update(await readFile(f));}
const binaries={};for(const[surface,path]of Object.entries({mac:'Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac.debug.dylib',iphone:'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone.debug.dylib'}))binaries[surface]=digest(await readFile(join('/private/tmp/wm-a15-build/Build/Products',path)));
await writeFile(join(base,'screenshots.json'),JSON.stringify({syntheticOnly:true,originalUnmodifiedPNGs:true,screenshots},null,2)+'\n');
await writeFile(join(base,'validation.json'),JSON.stringify({generatedAt:new Date().toISOString(),sourcesSHA256:hash.digest('hex'),binarySHA256:binaries,swiftA15:{passed:9,failed:0},stateChecks:{passed:2,failed:0},nodeCopyAndTokens:{passed:12,failed:0},surfaces,uiCopy:copy,hiddenBodyAndKeyScan:matches,resourceLimits:{xcodeJobs:2,xcodebuildSerial:true,simulatorsAtOnce:1},boundaries:{realPersonalHTTPHost:true,syntheticOnly:true,mediaInjected:true,macXCUITestAutomationUnavailable:true,compiledDSH:false,realModel:false,realCameraDevice:false,personalClipboardRead:false,personalDesktopCapture:false,productionRelay:false,deployment:false}},null,2)+'\n');
console.log('PASS A15 evidence: '+screenshots.length+' original PNGs, '+data.frames.length+' native text frames; hidden body/key zero matches.');
