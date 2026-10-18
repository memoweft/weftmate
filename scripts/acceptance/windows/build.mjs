// Adapted from the G7 build-only runner; keeps the production application identity.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {withMemoryRuntimeResources} from '../../memory-runtime-package.mjs';
import {verifyWindowsPackage} from '../../verify-windows-package.mjs';
const [outputArg,memoryArg,version='0.1.1-preview.1018']=process.argv.slice(2);
if(!outputArg||!memoryArg)throw Error('Usage: node scripts/acceptance/windows/build.mjs OUTPUT MEMORY_RUNTIME [VERSION]');
const repo=resolve(import.meta.dirname,'../../..'),output=resolve(outputArg);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(?:API[_-]?KEY|AUTHORIZATION|BEARER|PASSWORD|SECRET|TOKEN|CSC_LINK|CSC_KEY_PASSWORD)|^(?:WEFTMATE_|MEMOWEFT_)/i.test(k)));
Object.assign(env,{CSC_IDENTITY_AUTO_DISCOVERY:'false',WEFTMATE_EVIDENCE_DIR:output});
for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
function run(script,args=[]){const r=spawnSync(process.execPath,[script,...args],{cwd:repo,env,stdio:'inherit',windowsHide:true,timeout:1200000});if(r.status!==0)throw Error(`Build step failed: ${script} (${r.status})`);}
await mkdir(output,{recursive:true});
const source=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).stdout.trim();
const stage=join(output,'stage');run('scripts/verify-dsh-vendor.mjs');run('scripts/stage-dsh-runtime.mjs',['--stage-root',stage]);
const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8'));
const config=await withMemoryRuntimeResources({...pkg.build,extraMetadata:{version},win:{...pkg.build.win,signExecutable:false},
extraResources:[{from:stage,to:'',filter:['dsh-runtime/**/*','relay/**/*']},{from:join(repo,'src/personal-update/trusted-keys.json'),to:'update-trusted-keys.json'}],
directories:{...pkg.build.directories,output:join(output,'build')},publish:null},{mode:'full',source:resolve(memoryArg)});
const configFile=join(output,'builder.json');await writeFile(configFile,JSON.stringify(config,null,2));
run('node_modules/electron-builder/out/cli/cli.js',['--win','--publish','never','--config',configFile]);
const installer=join(output,'build',`WeftMate-Setup-${version}.exe`);
const verification=await verifyWindowsPackage({unpacked:join(output,'build/win-unpacked'),installer});
await writeFile(join(output,'package-check.json'),JSON.stringify(verification,null,2));
await writeFile(join(output,'candidate.json'),JSON.stringify({source,version,installer,installerSha256:createHash('sha256').update(await readFile(installer)).digest('hex'),memoryRuntimeIncluded:true,published:false},null,2));
