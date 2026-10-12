import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, dist } from './build-site.mjs';

export const protectedPaths=['downloads','updates','.well-known','preview-*'];
export const backupOmissions=['downloads/files','updates'];
export const quote = s => `'${String(s).replace(/'/g,"'\\''")}'`;
export function commandLine(exe,args,platform=process.platform){const q=platform==='win32'?s=>`'${String(s).replace(/'/g,"''")}'`:quote;return (platform==='win32'?'& ':'')+[exe,...args].map(q).join(' ');}
const timestamp=()=>new Date().toISOString().replace(/[-:.]/g,'');
export function parseArgs(args) {
 const o={dryRun:false};for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--dry-run')o.dryRun=true;else if(['--host','--root','--mode','--path'].includes(arg)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing value for ${arg}`);o[arg.slice(2)]=args[++i];}else throw Error(`Unknown option: ${arg}`);}
 if(!o.host||!o.root)throw Error('--host and --root are required');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(o.host))throw Error('Use a plain SSH alias with --host');
 if(!o.root.startsWith('/')||o.root==='/'||/[\r\n\0]/.test(o.root)||o.root.split('/').some(x=>x==='..'||x==='.')||o.root.endsWith('/'))throw Error('--root must be an absolute site directory, without a trailing slash');
 if(!['preview','production'].includes(o.mode))throw Error('--mode must be preview or production');
 if(o.mode==='preview'&&!/^preview-[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(o.path||''))throw Error('Preview --path must be a single preview-* directory name');
 if(o.mode==='production'&&o.path)throw Error('--path is only for preview mode');return o;
}
export function rsyncArgs(kind='publish') {
 const omit=kind==='backup'?backupOmissions:protectedPaths;
 return ['-a',...(kind==='backup'?[]:['--delete']),...omit.map(p=>`--exclude=/${p}/***`)];
}
export function planDeployment(o,stamp=timestamp()) {
 const parent=o.root.slice(0,o.root.lastIndexOf('/'))||'/';const leaf=o.root.slice(o.root.lastIndexOf('/')+1);
 const staging=`${parent}/.${leaf}-site-${stamp}`;const backup=`${o.root}.backup-${stamp}`;const target=o.mode==='preview'?`${o.root}/${o.path}`:o.root;
 const shellFlags=rsyncArgs().map(quote).join(' ');
 const rollback=`rsync ${shellFlags} -- ${quote(backup+'/')} ${quote(o.root+'/')}`;
 const prepare=`set -eu; test -d ${quote(o.root)}; test ! -L ${quote(o.root)}; mkdir -m 700 -- ${quote(staging)}`;
 const upload=`set -eu; tar --no-same-owner -xf - -C ${quote(staging)}`;
 // Excluded paths are also protected from deletion by rsync's default receiver
 // filter semantics. Do not add --delete-excluded or follow directory symlinks.
 let publish=`set -eu; trap ${quote('rm -rf -- '+quote(staging))} EXIT; `;
 if(o.mode==='production')publish+=`mkdir -m 700 -- ${quote(backup)}; rsync ${rsyncArgs('backup').map(quote).join(' ')} -- ${quote(o.root+'/')} ${quote(backup+'/')}; rsync ${shellFlags} -- ${quote(staging+'/')} ${quote(o.root+'/')}; `;
 else publish+=`test ! -L ${quote(target)}; mkdir -p -- ${quote(target)}; rsync '-a' '--delete' -- ${quote(staging+'/')} ${quote(target+'/')}; `;
 if(o.mode==='production')publish+=`printf '%s\\n' ${quote('Rollback: '+rollback)}; `;
 const routes=['','en/','terms/','privacy/','404.html','downloads/','downloads/releases.json'];
 if(o.mode==='production')publish+=routes.map(p=>`code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' ${quote('https://weftmate.com/'+p)}); printf '%s %s\\n' ${quote('/'+p)} "$code"; test "$code" = 200`).join('; ')+'; '+`code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' 'https://weftmate.com/__site_404_check__'); printf '%s %s\\n' '/__site_404_check__' "$code"; test "$code" = 404;`;
 return {prepare,upload,publish,rollback,staging,backup,target};
}
function run(exe,args,options={}) {return new Promise((resolve,reject)=>{const child=spawn(exe,args,{stdio:['ignore','inherit','inherit'],...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${exe} exited ${code}`)));});}
export async function deploy(o) {
 const p=planDeployment(o);const commands=[['node',['scripts/build-site.mjs',...(o.mode==='preview'?['--preview']:[])]],['ssh',[o.host,p.prepare]],['pipeline',[['tar','-cf','-','-C','site/dist','.'],['ssh',o.host,p.upload]]],['ssh',[o.host,p.publish]]];
 if(o.dryRun){for(const [exe,args] of commands)console.log(exe==='pipeline'?args.map(([exe,...args])=>commandLine(exe,args)).join(' | '):commandLine(exe,args));if(o.mode==='production')console.log(`Rollback: ${commandLine('ssh',[o.host,p.rollback])}`);return p;}
 await buildSite({preview:o.mode==='preview'});await run('ssh',[o.host,p.prepare]);
 try{await new Promise((done,reject)=>{const tar=spawn('tar',['-cf','-','-C',dist,'.'],{stdio:['ignore','pipe','inherit']});const ssh=spawn('ssh',[o.host,p.upload],{stdio:['pipe','inherit','inherit']});tar.stdout.pipe(ssh.stdin);let finished=0;let failed=false;const complete=(name,code)=>{if(code!==0&&!failed){failed=true;tar.kill();ssh.kill();reject(Error(`${name} exited ${code}`));}if(++finished===2&&!failed)done();};tar.once('error',reject);ssh.once('error',reject);ssh.stdin.on('error',()=>{});tar.once('exit',c=>complete('tar',c));ssh.once('exit',c=>complete('ssh',c));});await run('ssh',[o.host,p.publish]);}
 catch(error){console.error(`Deployment did not finish. Staging directory: ${p.staging}`);if(o.mode==='production')console.error(`If a backup was created, rollback: ${commandLine('ssh',[o.host,p.rollback])}`);throw error;}
 if(o.mode==='production')console.log(`Rollback: ${commandLine('ssh',[o.host,p.rollback])}`);return p;
}

// Offline rsync model for contract tests. It consumes the actual generated
// rsync exclusion arguments rather than a second protection list.
export async function simulateRsync(source,target,args) {
 const patterns=args.filter(x=>x.startsWith('--exclude=/')).map(x=>x.slice('--exclude=/'.length).replace(/\/\*\*\*$/,''));
 const excluded=rel=>patterns.some(p=>p.endsWith('*')?rel.split('/')[0].startsWith(p.slice(0,-1)):rel===p||rel.startsWith(p+'/'));
 await mkdir(target,{recursive:true});
 async function sync(s,d,prefix=''){const sent=new Map((await readdir(s,{withFileTypes:true})).map(e=>[e.name,e]));if(args.includes('--delete'))for(const e of await readdir(d,{withFileTypes:true})){const rel=prefix+e.name;if(!excluded(rel)&&!sent.has(e.name))await rm(join(d,e.name),{recursive:e.isDirectory(),force:true});}
  for(const [name,e] of sent){const rel=prefix+name;if(excluded(rel))continue;const from=join(s,name),to=join(d,name);if(e.isDirectory()){try{const st=await lstat(to);if(!st.isDirectory()||st.isSymbolicLink())await rm(to,{recursive:st.isDirectory()&&!st.isSymbolicLink(),force:true});}catch{}await mkdir(to,{recursive:true});await sync(from,to,rel+'/');}else{try{const st=await lstat(to);if(st.isDirectory())await rm(to,{recursive:true,force:true});}catch{}await cp(from,to,{dereference:false});}}
 }await sync(source,target);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await deploy(parseArgs(process.argv.slice(2)));}catch(e){console.error(e.message);process.exitCode=1;}}
