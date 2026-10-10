import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
const base='tests/evidence/qa-6';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.isFile()?[join(dir,e.name)]:[]);
const key=execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();
if(!key)throw Error('Expected approved machine key for exact leak scan');
const files=walk(base),hits=[];
for(const file of files){const data=readFileSync(file);if(data.includes(Buffer.from(key))||data.includes(Buffer.from('-----BEGIN '+'PRIVATE KEY-----')))hits.push(relative(base,file));}
const productDiff=execFileSync('git',['diff','480d65e4','--name-only','--','src','apps','runtime','scripts','package.json','package-lock.json'],{encoding:'utf8',windowsHide:true}).trim();
const result={files:files.length,actualMimoKeyMatches:hits.length,privatePemMatchesIncluded:true,hitFiles:hits,productDiffFiles:productDiff?productDiff.split(/\r?\n/):[],privateBackupContentExported:false};
writeFileSync(join(base,'privacy-scan.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(hits.length||productDiff)process.exitCode=1;
