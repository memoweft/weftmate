// Same forbidden metadata names as Windows UX-1; identifiers and wire keys are excluded.
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkVisibleCopy} from '../../../scripts/check-ui-copy.mjs';
export function swiftCopy(source) {
 const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 const values=[];
 for(const m of clean.matchAll(/#?"(?:\\.|[^"\\])*"#?/g)) {
  if(/(?:replacingOccurrences|range)\(of:\s*$/.test(clean.slice(Math.max(0,m.index-100),m.index)))continue;
  const literal=m[0].replace(/^#?"|"#?$/g,'');
  // Human-readable strings anywhere (including LocalizedError/computed labels),
  // plus string arguments to the native visible-copy API. Never wire identifiers.
  if(/[\u3400-\u9fff]/.test(literal) || /(?:Text|Button|Label|TextField|Picker|DisclosureGroup|Section|NSLocalizedString|navigationTitle|accessibilityLabel|accessibilityValue|LabeledContent)\s*\(\s*$/.test(clean.slice(Math.max(0,m.index-100),m.index)))values.push(literal.replace(/\\\([^)]*\)/g,''));
 }
 return values;
}
async function files(root){const result=[];for(const e of await readdir(root,{withFileTypes:true})){const path=join(root,e.name);if(e.isDirectory())result.push(...await files(path));else if(/\.(swift|xcstrings|strings)$/.test(e.name))result.push(path);}return result;}
export async function scanAppleCopy(root=resolve(import.meta.dirname,'../../..'), evidence=join(root,'apps/apple/Tests/Evidence/A13')) {
 const found=[];let count=0;
 for(const dir of ['UI','iOS','macOS','watchOS','Resources','Packages/WeftMateCore/Sources/WeftMateCore'])for(const path of await files(join(root,'apps/apple',dir))){
  // Generated metadata dictionary is verified separately against ui-core.
  if(path.endsWith('/OperationNames.swift'))continue;
  const source=await readFile(path,'utf8');
  const copies=path.endsWith('.swift')?swiftCopy(source):path.endsWith('.xcstrings')?Object.entries(JSON.parse(source).strings).flatMap(([key,v])=>[key,...Object.values(v.localizations??{}).map(l=>l.stringUnit?.value??'')]): [...source.matchAll(/=\s*"((?:\\.|[^"\\])*)"/g)].map(m=>m[1]);
  for(const copy of copies){count++;try{checkVisibleCopy(copy,path);}catch(e){found.push(e.message);}}
 }
 const frames=JSON.parse(await readFile(join(evidence,'screenshot-text.json'),'utf8'));
 if(frames.syntheticOnly!==true||!frames.frames.length)throw Error('Missing Apple synthetic screenshot text');
 for(const frame of frames.frames)try{checkVisibleCopy(frame.text,`${frame.surface}/${frame.theme}/${frame.scene}`);}catch(e){found.push(e.message);}
 if(found.length)throw Error(found.join('\n'));return {authoredStrings:count,screenshotFrames:frames.frames.length};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(await scanAppleCopy());
