import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
const root='tests/evidence/qa-3';
const env=(name,scope)=>execFileSync('powershell.exe',['-NoProfile','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`],{encoding:'utf8',windowsHide:true}).trim();
const lan=env('WEFTMATE_LAN_MODEL_BASE_URL','User');
const secrets=[env('MIMO_API_KEY','Machine'),env('WEFTMATE_LAN_MODEL_KEY','User'),lan,lan&&new URL(lan).host,lan&&new URL(lan).hostname].filter(Boolean);
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]);}
const files=walk(root),hits=[],privateFiles=[],homes=[],redacted=[];
for(const file of files){
 let bytes=readFileSync(file);
 if(/\.(json|jsonl|log|txt|md|mjs|py|ps1)$/.test(file)){
  const text=bytes.toString('utf8');
  let clean=text;for(const home of [homedir(),homedir().replaceAll('\\','\\\\'),homedir().replaceAll('\\','/')])clean=clean.replaceAll(home,'[windows-home]');
  clean=clean.replace(/\/Users\/[A-Za-z0-9_.-]+\//g,'[mac-home]/');
  if(clean!==text){writeFileSync(file,clean);bytes=Buffer.from(clean);redacted.push(relative(root,file).replaceAll('\\','/'));}
  if([homedir(),homedir().replaceAll('\\','\\\\'),homedir().replaceAll('\\','/')].some(home=>clean.includes(home)))homes.push(relative(root,file));
 }
 if(secrets.some(s=>bytes.includes(Buffer.from(s))||bytes.includes(Buffer.from(s,'utf16le'))))hits.push(relative(root,file));
 if(/\.(pem|pfx|key|crt|db|sqlite|sqlite3|asar|exe|apk)$/.test(file)||/(^|[/\\])(credentials\.json|store\.json|Cookies)$/.test(file))privateFiles.push(relative(root,file));
}
const report={scannedFiles:files.length,modelKeyOrPrivateLanHits:hits,credentialCertificateRuntimeFiles:privateFiles,privateHomeTextHits:homes,redactedTextFiles:redacted,imagesUnmodified:true};
writeFileSync(root+'/privacy-scan.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({scanned:files.length,hits:hits.length,privateFiles:privateFiles.length,homes:homes.length,redacted:redacted.length}));
if(hits.length||privateFiles.length||homes.length)process.exitCode=1;
