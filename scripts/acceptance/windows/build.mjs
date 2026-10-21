// Adapted from the G7 build-only runner; optional isolated application identity.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {assertMainSource} from './build-source.mjs';
const [outputArg,memoryArg,version='0.1.1-preview.1019',identity,stageArg,electronDistArg]=process.argv.slice(2);
if(!outputArg||!memoryArg||!identity)throw Error('Usage: node scripts/acceptance/windows/build.mjs OUTPUT MEMORY_RUNTIME VERSION UNIQUE_ID [VERIFIED_STAGE] [ELECTRON_DIST]');
const repo=resolve(import.meta.dirname,'../../..'),output=resolve(outputArg);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(?:API[_-]?KEY|AUTHORIZATION|BEARER|PASSWORD|SECRET|TOKEN|CSC_LINK|CSC_KEY_PASSWORD)|^(?:WEFTMATE_|MEMOWEFT_)/i.test(k)));
Object.assign(env,{CSC_IDENTITY_AUTO_DISCOVERY:'false',WEFTMATE_EVIDENCE_DIR:output});
for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
function run(script,args=[]){const r=spawnSync(process.execPath,[script,...args],{cwd:repo,env,stdio:'inherit',windowsHide:true,timeout:1200000});if(r.status!==0)throw Error(`Build step failed: ${script} (${r.status})`);}
await mkdir(output,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
const source=assertMainSource(repo),buildHead=git(['rev-parse','HEAD']);
const {withMemoryRuntimeResources}=await import('../../memory-runtime-package.mjs');
const {verifyWindowsPackage}=await import('../../verify-windows-package.mjs');
const {UUID}=await import('builder-util-runtime');
if(identity&&!/^[a-z0-9]+$/.test(identity))throw Error('Invalid isolated identity');
const stage=stageArg?resolve(stageArg):join(output,'stage');run('scripts/verify-dsh-vendor.mjs');if(!stageArg)run('scripts/stage-dsh-runtime.mjs',['--stage-root',stage]);
const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8'));
const appId=identity?`com.memoweft.weftmate.${identity}`:pkg.build.appId;
const config=await withMemoryRuntimeResources({...pkg.build,appId,...(electronDistArg?{electronDist:resolve(electronDistArg)}:{}),extraMetadata:{version,...(identity?{name:`weftmate-${identity}`,desktopAppId:appId,desktopIdentity:`WeftMate ${identity}`}:{})},...(identity?{productName:`WeftMate ${identity}`,executableName:`WeftMate-${identity}`,nsis:{...pkg.build.nsis,shortcutName:`WeftMate ${identity}`,uninstallDisplayName:`WeftMate ${identity}`,createDesktopShortcut:false}}:{}),win:{...pkg.build.win,signExecutable:false},
extraResources:[{from:stage,to:'',filter:['dsh-runtime/**/*','relay/**/*']},{from:join(repo,'src/personal-update/trusted-keys.json'),to:'update-trusted-keys.json'}],
directories:{...pkg.build.directories,output:join(output,'build')},publish:null},{mode:'full',source:resolve(memoryArg)});
const configFile=join(output,'builder.json');await writeFile(configFile,JSON.stringify(config,null,2));
run('node_modules/electron-builder/out/cli/cli.js',['--win','--publish','never','--config',configFile]);
const installer=join(output,'build',`WeftMate-Setup-${version}.exe`);
const verification=await verifyWindowsPackage({unpacked:join(output,'build/win-unpacked'),installer});
await writeFile(join(output,'package-check.json'),JSON.stringify(verification,null,2));
await writeFile(join(output,'candidate.json'),JSON.stringify({source,buildHead,version,identity,appId,nsisGuid:UUID.v5(appId,UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')),desktopIdentity:config.extraMetadata.desktopIdentity,executableName:config.executableName,installer,installerSha256:createHash('sha256').update(await readFile(installer)).digest('hex'),memoryRuntimeIncluded:true,published:false},null,2));
