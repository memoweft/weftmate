import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,normalize} from 'node:path';
import {extractFile} from '@electron/asar';
const baseline='2a075c13c9f9a428c149d5831432a469e2d97b4f';
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'src'],{encoding:'utf8'}).trim().split('\n');const archive=resolve('.local/qa-7/releases/0.1.1-preview.7/build/win-unpacked/resources/app.asar');const report={baseline,archiveProductFiles:0,archiveMissing:[],archiveMismatch:[],oldSourceFiles:0,oldSourceMismatch:[]};
for(const f of files){const expected=execFileSync('git',['show',baseline+':'+f],{maxBuffer:30e6});let actual;try{actual=extractFile(archive,normalize(f))}catch{report.archiveMissing.push(f);continue;}report.archiveProductFiles++;if(!actual.equals(expected)&&actual.toString().replaceAll('\r\n','\n')!==expected.toString().replaceAll('\r\n','\n'))report.archiveMismatch.push(f);}
const oldFiles=execFileSync('git',['ls-tree','-r','--name-only','f787c3c','src'],{encoding:'utf8'}).trim().split('\n');for(const f of oldFiles){const file=join('.local/qa-6/old-source',f);if(!existsSync(file)){report.oldSourceMismatch.push(f);continue;}report.oldSourceFiles++;const e=execFileSync('git',['show','f787c3c:'+f],{maxBuffer:30e6}),a=readFileSync(file);if(!a.equals(e)&&a.toString().replaceAll('\r\n','\n')!==e.toString().replaceAll('\r\n','\n'))report.oldSourceMismatch.push(f);}
writeFileSync('tests/evidence/qa-7/source-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
