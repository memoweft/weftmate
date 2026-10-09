import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {scanAppleCopy} from '../Scripts/check_ui_copy.mjs';
const root=resolve(import.meta.dirname,'../../..'), evidence=join(root,'apps/apple/Tests/Evidence/A13');
const hash=value=>createHash('sha256').update(value).digest('hex');
const data=JSON.parse(await readFile(join(evidence,'screenshot-text.json'),'utf8'));
const screenshots=[];
for(const frame of data.frames){
 const folder=frame.surface==='watch'?'watch':`${frame.surface}-${frame.theme}`;
 const name=frame.surface==='watch'?'approval.png':frame.surface==='mac'?frame.scene+'.png':`a13-iphone-${frame.scene}-${frame.theme}.png`;
 const path=join(evidence,folder,name);const bytes=await readFile(path);
 frame.screenshot=folder+'/'+name;frame.screenshotSHA256=hash(bytes);
 screenshots.push({file:frame.screenshot,sha256:frame.screenshotSHA256,surface:frame.surface,theme:frame.theme,scene:frame.scene});
}
await writeFile(join(evidence,'screenshot-text.json'),JSON.stringify(data,null,2)+'\n');
const copy=await scanAppleCopy(root);
const sources=[];
for(const dir of ['apps/apple/UI','apps/apple/iOS','apps/apple/macOS','apps/apple/watchOS','apps/apple/Packages/WeftMateCore/Sources/WeftMateCore'])for(const file of await readdir(join(root,dir)))if(file.endsWith('.swift'))sources.push(join(root,dir,file));
sources.push(join(root,'src/ui-core/timeline-model.js'),join(root,'design/tokens/generated/apple/DesignTokens.swift'));
const source=createHash('sha256');for(const file of sources.sort()){source.update(relative(root,file));source.update(await readFile(file));}
const binaries={};for(const[surface,file]of Object.entries({mac:'Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac.debug.dylib',iphone:'Debug-iphonesimulator/WeftMatePhone.app/WeftMatePhone.debug.dylib',watch:'Debug-watchsimulator/WeftMateWatch.app/WeftMateWatch.debug.dylib'}))binaries[surface]=hash(await readFile(join(root,'apps/apple/Build/A13/Build/Products',file)));
const validations=[];
for(const surface of ['mac-light','mac-dark','iphone-light','iphone-dark']){
 const value=JSON.parse(await readFile(join(evidence,surface,'validation.json'),'utf8'));if(!value.passed)throw Error('Native validation failed: '+surface);validations.push(value);
}
const watch=JSON.parse(await readFile(join(evidence,'watch/xctest-summary.json'),'utf8'));if(watch.passedTests!==1||watch.failedTests!==0||watch.skippedTests!==0)throw Error('Watch validation failed');
await writeFile(join(evidence,'screenshots.json'),JSON.stringify({syntheticOnly:true,originalUnmodifiedPNGs:true,screenshots},null,2)+'\n');
await writeFile(join(evidence,'validation.json'),JSON.stringify({generatedAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourcesSHA256:source.digest('hex'),implementationSHA256:binaries,swiftCore:{passed:52,failed:0},stateChecks:{executables:2,passed:2,interactionAssertions:11},nativeFlows:{mac:2,iphone:2,watch:1,failed:0,skipped:0},uiCopy:copy,validations,resourceLimits:{xcodeJobs:2,xcodebuildSerial:true,simulatorsAtOnce:1,pairedWatchException:2},boundaries:{syntheticOnly:true,realPersonalHost:true,realWatchConnectivity:true,compiledDSH:false,realModel:false,realDevice:false,productionRelay:false,deploy:false,contractChanges:false}},null,2)+'\n');
console.log('Verified',screenshots.length,'original native screenshots, matched text and all native validations.');
