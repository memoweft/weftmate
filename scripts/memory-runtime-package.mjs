/** The same selection and checks serve every Windows electron-builder entry. */
import {join,resolve} from 'node:path';
import {modeOf,verifyMemoryRuntime} from './memory-runtime/verify.mjs';

export async function withMemoryRuntimeResources(config,{mode=process.env.WEFTMATE_MEMORY_RUNTIME_MODE??'full',source=process.env.WEFTMATE_MEMORY_RUNTIME_DIR}={},verify=verifyMemoryRuntime){
  mode=modeOf(mode);
  if(!source)throw Error('Windows packaging requires a prepared memory runtime directory');
  source=resolve(source);
  const verified=await verify(source,{mode,probe:true});
  return {...config,extraMetadata:{...config.extraMetadata,memoryRuntimeMode:mode,
    memoryRuntimeManifestSha256:verified?.manifestSha256},
    // electron-builder 26.17.0 tests the source filename with endsWith before
    // copying/signing. Exact absolute filenames preserve only these two
    // upstream signed executables, including when direct CLI uses the hook.
    win:{...config.win,signExts:[...new Set([...(config.win?.signExts??[]),...['python.exe','pythonw.exe'].map(name=>'!'+join(source,'python',name))])]},
    extraResources:[...(config.extraResources??[]).filter(r=>r.to!=='memory-runtime'),{from:source,to:'memory-runtime',filter:['**/*']}]};
}
export async function beforeWindowsMemoryPack(context){
  if(context.electronPlatformName!=='win32')return;
  if(context.arch!==1)throw Error('memory runtime supports only Windows x64');
  const config=context.packager.config;
  const resource=config.extraResources?.find(r=>r.to==='memory-runtime');
  const result=await withMemoryRuntimeResources(config,{mode:config.extraMetadata?.memoryRuntimeMode??process.env.WEFTMATE_MEMORY_RUNTIME_MODE,source:resource?.from??process.env.WEFTMATE_MEMORY_RUNTIME_DIR});
  config.extraMetadata=result.extraMetadata;config.extraResources=result.extraResources;
  config.win=result.win;
  Object.assign(context.packager.platformSpecificBuildOptions,result.win);
}
export async function afterWindowsMemoryPack(context){
  if(context.electronPlatformName!=='win32')return;
  return verifyMemoryRuntime(join(context.appOutDir,'resources/memory-runtime'),{mode:context.packager.config.extraMetadata?.memoryRuntimeMode,probe:true});
}
