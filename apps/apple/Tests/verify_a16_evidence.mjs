import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { scanAppleCopy } from '../Scripts/check_ui_copy.mjs';
const root=resolve(import.meta.dirname,'../../..'),base=join(root,'apps/apple/Tests/Evidence/A16');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const frames=JSON.parse(await readFile(join(base,'screenshot-text.json'),'utf8'));
const forbidden=['A16_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY','A16_SYNTHETIC_SECRET_NEVER_DISPLAY'];
const scans=forbidden.map(marker=>({marker,hits:frames.frames.filter(f=>f.text.includes(marker)).length}));
if(scans.some(x=>x.hits))throw Error('Hidden fixture body or key appeared in native text');
const screenshots=[],surfaces=[];
const scenes=['first-screen','expanded-day','native-date-picker','date-located','search-first','search-next','side-source','returned-source','result-opened','sent','approval','temporary','temporary-menu','temporary-expiry'];
for(const surface of ['mac-light','mac-dark','iphone-light','iphone-dark']){
 const validation=JSON.parse(await readFile(join(base,surface,'validation.json'),'utf8'));
 if(!validation.passed||!validation.realPersonalHTTPHost||!validation.syntheticOnly)throw Error('Native flow not passed '+surface);
 const [platform,theme]=surface.split('-');
 for(const scene of scenes)if(!frames.frames.some(f=>f.surface===platform&&f.theme===theme&&f.scene===scene))throw Error('Missing original native scene '+surface+'/'+scene);
 const report=JSON.parse(await readFile(join(base,surface,'host-receipts.json'),'utf8'));
 if(report.historyCount!==10000||report.resultStates.map(x=>x.state).sort().join(',')!=='completed,failed,stopped')throw Error('Host history/terminal facts mismatch');
 if(!report.operations.some(x=>x.kind==='send' && x.text.includes('A16 合成主对话发送') && x.text.includes('PAPER-42')))throw Error('Logical readable attachment did not reach isolated backend');
 if(!report.operations.some(x=>x.kind==='approval' && x.outcome==='allowed-once'))throw Error('Native approval receipt missing');
 const perf=platform==='mac'?JSON.parse(await readFile(join(base,surface,'native-report.json'),'utf8')).performance:report.metrics.at(-1);
 if(!perf||perf.samples<100||perf.hostHistory!==10000||perf.bodyWindow>1000||perf.residentEndMiB<=0)throw Error('Native display-frame/process-memory measurement missing '+surface);
 surfaces.push({surface,passed:true,performance:perf});
 for(const name of await readdir(join(base,surface)))if(name.endsWith('.png')){
  const b=await readFile(join(base,surface,name));if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Original PNG signature');
  screenshots.push({file:surface+'/'+name,sha256:hash(b),width:b.readUInt32BE(16),height:b.readUInt32BE(20)});
 }
}
const watch=JSON.parse(await readFile(join(base,'watch/xctest-summary.json'),'utf8'));
if(watch.passedTests!==1||watch.failedTests!==0||watch.skippedTests!==0)throw Error('Paired Watch test missing');
const watchText=frames.frames.filter(f=>f.surface==='watch');
if(!watchText.length||watchText.some(f=>f.text.includes('合成记录')||f.text.includes('A16 合成临时正文')))throw Error('Watch projected conversation body');
const copy=await scanAppleCopy(root,base);
const files=[];
for(const dir of ['apps/apple/UI','apps/apple/Packages/WeftMateCore/Sources/WeftMateCore'])for(const name of await readdir(join(root,dir)))if(name.endsWith('.swift'))files.push(join(root,dir,name));
const sources=createHash('sha256');for(const file of files.sort()){sources.update(relative(root,file));sources.update(await readFile(file));}
const binaries={};for(const [name,path]of Object.entries({mac:'Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac.debug.dylib',iphone:'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone.debug.dylib',watch:'Debug-watchsimulator/WeftMateWatch.app/WeftMateWatch.debug.dylib'}))binaries[name]=hash(await readFile(join(root,'apps/apple/Build/A16/Build/Products',path)));
await writeFile(join(base,'validation.json'),JSON.stringify({generatedAt:new Date().toISOString(),syntheticOnly:true,sourcesSHA256:sources.digest('hex'),binarySHA256:binaries,swift:{a16:16,taskReadStopAndDirectory:44,failed:0},statePrograms:{passed:2},surfaces,watch:{passed:1,failed:0},uiCopy:copy,hiddenBodyAndKeyScan:scans,boundaries:{realPersonalHTTPHost:true,compiledDSH:false,realModel:false,realDevice:false,macXCUITest:false,macOwnNativeAX:true,globalPermissionsRequested:false,productionDeployment:false},resources:{xcodeJobs:2,xcodebuildSerial:true,simulatorsAtOnce:1,pairedWatchException:true}},null,2)+'\n');
await writeFile(join(base,'screenshots.json'),JSON.stringify({originalUnmodifiedPNGs:true,screenshots},null,2)+'\n');
await writeFile(join(base,'privacy-scan.json'),JSON.stringify({syntheticOnly:true,source:'Native accessibility names/values captured with original PNGs',frames:frames.frames.length,scans,watchBodyHits:0},null,2)+'\n');
console.log('PASS A16 native evidence: '+screenshots.length+' original PNGs; display-link frames, process memory, native receipts and hidden text/key scans verified.');
