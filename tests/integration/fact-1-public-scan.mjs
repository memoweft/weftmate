import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root=resolve('tests/evidence/fact-1');
const env=(name,scope)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`],{encoding:'utf8',windowsHide:true}).trim();
const privateUrl=env('WEFTMATE_LAN_MODEL_BASE_URL','User');
const secrets=[env('MIMO_API_KEY','Machine'),env('WEFTMATE_LAN_MODEL_KEY','User'),privateUrl,privateUrl&&new URL(privateUrl).host,privateUrl&&new URL(privateUrl).hostname].filter(Boolean);
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const paths=files(root),findings=[];
for(const path of paths){if(path.endsWith('public-scan.json'))continue;
  if(/(?:credentials\.json|\.env|\.pem|\.pfx)$/i.test(path))findings.push({file:path,kind:'credential-file'});
  if(/\.(?:json|jsonl|md|txt|mjs|ps1)$/i.test(path)){
    const text=readFileSync(path,'utf8');if(secrets.some(secret=>text.includes(secret)))findings.push({file:path,kind:'private-secret-or-destination'});
    if(/[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)/i.test(text))findings.push({file:path,kind:'user-home-path'});
  }
}
writeFileSync(join(root,'public-scan.json'),JSON.stringify({at:new Date().toISOString(),files:paths.length,findings},null,2));
console.log(JSON.stringify({files:paths.length,findings:findings.length}));if(findings.length)process.exitCode=1;
