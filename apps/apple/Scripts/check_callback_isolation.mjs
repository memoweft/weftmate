#!/usr/bin/env node
// CRASH-1: closed inventory of callbacks whose executor must be reviewed.
// Swift's complete concurrency checking handles typed Sendable boundaries; this gate
// also catches SDK callbacks that historically inherited the surrounding UI actor.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pattern = /\b(visualEffect|alignmentGuide|onGeometryChange|onScrollGeometryChange|onScrollTargetVisibilityChange|onScrollPhaseChange|GeometryReader|onPreferenceChange|anchorPreference|transformAnchorPreference|overlayPreferenceValue|backgroundPreferenceValue|Canvas|addObserver|observe|sendMessage|dataTask|downloadTask|uploadTask|fileImporter|fileExporter|ASWebAuthenticationSession|withTaskCancellationHandler|HKSampleQuery|enumerateStatistics|detached)\s*(?:\(|\{)|\b(?:struct|class|extension)\s+\w+[^\n{]*:\s*[^\n{]*\b(Shape|Layout|AnimatableModifier)\b|\b(initialResultsHandler)\s*=\s*\{|\bfunc\s+(urlSession|session|sessionReachabilityDidChange|track|styleMenu|applyMenu|menuNeedsUpdate|menu|invoke|path|sizeThatFits|placeSubviews|dataScanner|imagePickerController|imagePickerControllerDidCancel)\s*\(|\b(begin)\s*\{/g;
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => ['Build','.build','Tests','.git'].includes(e.name) ? [] : e.isDirectory() ? files(path.join(dir,e.name)) : e.name.endsWith('.swift') ? [path.join(dir,e.name)] : []); }
// Keep offsets while masking comments and literals, so braces inside strings do not
// terminate a callback. Inventory hashes use the original source, not masked text.
export function mask(text) { return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, m => m.replace(/[^\n]/g,' ')); }
export function scan(text, file='fixture.swift') {
 text=text.replace(/\r\n/g,'\n');
 const source = mask(text), rows=[];
 for (const match of source.matchAll(pattern)) {
  const api=match[1]||match[2]||match[3]||match[4]||match[5], start=match.index;
  const consume=(open,left,right)=>{let depth=0;for(let i=open;i<source.length;i++){if(source[i]===left)depth++;if(source[i]===right&&--depth===0)return i+1;}return source.length;};
  const first=source.indexOf('(',start), brace=source.indexOf('{',start);
  let end;
  if(brace>=0&&(first<0||brace<first))end=consume(brace,'{','}');
  else if(first>=0){
   end=consume(first,'(',')');
   const trailing=source.slice(end).match(/^\s*(?:(?:async|throws|rethrows)\s*)?(?:->[^\n{]+)?\s*\{/);
   if(trailing)end=consume(end+trailing[0].lastIndexOf('{'),'{','}');
  }else end=source.indexOf('\n',start);
  let depth=0;
  // Include the separately labelled action of onScrollGeometryChange, too.
  const tail=source.slice(end).match(/^\s*action:\s*\{/);
  if(tail){end+=tail[0].length;depth=1;for(;end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}'&&--depth===0){end++;break;}}}
  const body=text.slice(start,end), line=text.slice(0,start).split('\n').length;
  rows.push({file,line,api,sha256:crypto.createHash('sha256').update(body).digest('hex')});
 }
 return rows;
}
export function check(rows, allowed) {
 return rows.filter(row=>!allowed.some(a=>a.file===row.file&&a.api===row.api&&a.sha256===row.sha256&&a.reason?.length>20));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const rows=files(path.join(root,'apps/apple')).flatMap(f=>scan(fs.readFileSync(f,'utf8'),path.relative(root,f).replaceAll('\\','/')));
 if(process.argv.includes('--inventory')) console.log(JSON.stringify(rows,null,2));
 else {
  const allowed=JSON.parse(fs.readFileSync(path.join(root,'apps/apple/Scripts/callback-isolation-allowlist.json'),'utf8'));
  const errors=check(rows,allowed);
  for(const row of errors)console.error(`${row.file}:${row.line} ${row.api}: unreviewed callback or changed actor access; use a nonisolated @Sendable callback and explicitly hop to MainActor for UI state. Review and record the exact body with a reason.`);
  console.log(`CRASH-1: ${rows.length} callback sites reviewed, ${errors.length} failures`); process.exitCode=errors.length?1:0;
 }
}
