import {readFile,writeFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {scanAppleCopy} from '../Scripts/check_ui_copy.mjs';
const root=resolve(import.meta.dirname,'../../..'), base=join(root,'apps/apple/Tests/Evidence/A17');
const digest=b=>createHash('sha256').update(b).digest('hex');
async function walk(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat();}
const files=(await walk(base)).filter(f=>!relative(base,f).startsWith('attempts/')&&!relative(base,f).startsWith('menu-polish/')&&!/\/failure(?:-|\.)/.test(f));
const frames=[],screenshots=[];
for(const file of files){
 const name=relative(base,file);
 if(file.endsWith('.png')){const b=await readFile(file);if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG: '+name);screenshots.push({file:name,sha256:digest(b),width:b.readUInt32BE(16),height:b.readUInt32BE(20)});}
 if((file.endsWith('screenshot-text.json')&&!['screenshot-text.json','visible-copy-text.json'].includes(name))||name==='ocr-text.json'){
  const value=JSON.parse(await readFile(file,'utf8'));for(const frame of value.frames??[])frames.push({...frame,source:frame.source??name});
 }else if(/(?:-text|\.text)\.json$/.test(file)){
  const value=JSON.parse(await readFile(file,'utf8'));if(typeof value.text==='string')frames.push({...value,source:name,surface:name.includes('iphone')?'iphone':'mac',theme:name.includes('dark')?'dark':'light'});
 }else if(file.endsWith('.txt')&&name.includes('a17-text-'))frames.push({source:name,scene:name.split('/').at(-1),surface:'iphone',theme:name.includes('dark')?'dark':'light',text:await readFile(file,'utf8')});
}
const unique=[...new Map(frames.map(f=>[f.source+'|'+f.scene+'|'+digest(f.text),f])).values()];
const markers=['A15_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY','A15_SYNTHETIC_SECRET_NEVER_DISPLAY','A16_SYNTHETIC_PRIVATE_BODY_NEVER_DISPLAY','A16_SYNTHETIC_SECRET_NEVER_DISPLAY'];
const scans=markers.map(marker=>({marker,hits:unique.filter(f=>f.text.includes(marker)).length}));
if(scans.some(s=>s.hits))throw Error('Private fixture body/key appears in native accessibility text');
const icons=new Set((await readdir(join(root,'apps/apple/Resources/Icons.xcassets'))).filter(n=>n.endsWith('.imageset')).map(n=>n.slice(0,-9)));
const exclusions={};
function visibleText(text){
 // Preserve complete debug trees for privacy. Only labels/values are UI copy;
 // frame coordinates, process IDs and accessibility identifiers are metadata.
 let lines=text.startsWith('Attributes:')||text.includes('Element subtree:')?[...text.matchAll(/(?:label|value|placeholderValue): '((?:\\.|[^'\\])*)'/g)].map(m=>m[1].replaceAll("\\'","'").replaceAll('\\n','\n')):text.split('\n');
 return lines.filter(line=>{if(!icons.has(line))return true;exclusions[line]=(exclusions[line]??0)+1;return false;}).join('\n');
}
await writeFile(join(base,'screenshot-text.json'),JSON.stringify({syntheticOnly:true,frames:unique},null,2)+'\n');
const visible={syntheticOnly:true,metadataNormalization:'Labels/values extracted from raw XCTest trees; exact generated decorative image IDs excluded. Raw text retained.',frames:unique.map(f=>({...f,text:visibleText(f.text)}))};
await writeFile(join(base,'visible-copy-text.json'),JSON.stringify(visible,null,2)+'\n');
await writeFile(join(base,'image-metadata-exclusions.json'),JSON.stringify(exclusions,null,2)+'\n');
const scratch=await mkdtemp(join(tmpdir(),'a17-copy-'));let copy;
try{await writeFile(join(scratch,'screenshot-text.json'),JSON.stringify(visible));copy=await scanAppleCopy(root,scratch);}finally{await rm(scratch,{recursive:true,force:true});}
const gates=JSON.parse(await readFile(join(base,'validation.json'),'utf8'));
for(const gate of gates.requiredReports){
 const value=JSON.parse(await readFile(join(base,gate),'utf8'));
 const positive=value.passed===true||(typeof value.passed==='number'&&value.passed>0)||value.authenticated===true||value.result==='Passed';
 if(!positive||value.passed===false||value.failedTests>0||value.failed>0||value.skippedTests>0||value.skipped>0||value.result==='Failed')throw Error('Failed native report '+gate);
}
for(const file of gates.requiredScreenshots)if(!screenshots.some(s=>s.file===file))throw Error('Missing native screenshot '+file);
const launches=JSON.parse(await readFile(join(base,'mac-launches.json'),'utf8'));
const mac=join(root,'apps/apple/Build/A17/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac.debug.dylib');
if(!launches.passed||launches.launches.length!==30||launches.launches.some(l=>l.exitCode!==0)||launches.binarySHA256!==digest(await readFile(mac)))throw Error('Thirty launches must match final Mac binary');
const crash=JSON.parse(await readFile(join(base,'crash-check.json'),'utf8'));
if(crash.newCount!==0||crash.finalBuildNewCount!==0)throw Error('New crash report');
await writeFile(join(base,'screenshots.json'),JSON.stringify({originalUnmodifiedPNGs:true,screenshots},null,2)+'\n');
await writeFile(join(base,'privacy-scan.json'),JSON.stringify({syntheticOnly:true,rawAccessibilityFrames:unique.length,scans,uiCopy:copy},null,2)+'\n');
// Completion is derived only after every report, screenshot, privacy check,
// binary launch hash and diagnostic-report comparison above succeeds.
if(process.argv.includes('--finalize')) {
 gates.complete=true;
 await writeFile(join(base,'validation.json'),JSON.stringify(gates,null,2)+'\n');
} else if(!gates.complete)throw Error('Native acceptance manifest is not complete');
console.log('PASS A17:',screenshots.length,'native PNGs;',unique.length,'raw accessibility records; body/key hits 0; final Mac launches 30; new crashes 0.');
