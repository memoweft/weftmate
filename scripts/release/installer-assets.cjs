/** Small Win32 paint surface; no additional installer/runtime framework. */
const {mkdirSync,readFileSync,writeFileSync} = require('node:fs');
const {join,resolve} = require('node:path');
const {spawnSync} = require('node:child_process');
module.exports = async context => {
  // Shared beforePack for every platform/entry, including direct builder calls
  // and npmRebuild:false. Never depend on npm postinstall having run.
  const {pathToFileURL} = require('node:url');
  await (await import('../patch-root-csr.mjs')).applyRootCsrPatch({requireFrom:pathToFileURL(join(context.packager.projectDir,'package.json')).href});
  if (context.electronPlatformName !== 'win32') return;
  await (await import('../memory-runtime-package.mjs')).beforeWindowsMemoryPack(context);
  const root=context.packager.projectDir, out=join(root,'.local/installer-ui');
  mkdirSync(out,{recursive:true});
  const tokens=JSON.parse(readFileSync(join(root,'design/tokens/tokens.json'),'utf8'));
  const themes=Object.values(tokens.surfaces.desktop.themes);
  const values=t=>t.variables;
  const light=themes.find(t=>t.selector===':root');
  const dark=themes.find(t=>t.selector===':root[data-theme="dark"]');
  const color=hex=>`RGB(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)})`;
  writeFileSync(join(out,'palette.h'),[light,dark].map((t,i)=>`static const Palette ${i?'DARK':'LIGHT'} = {${['--canvas','--ink','--ink-secondary','--line'].map(k=>color(values(t)[k])).join(',')},${color(tokens.shared.color[i?'brand-dark':'brand-light'])}};`).join('\n'));
  const identity=context.packager.config.extraMetadata?.desktopIdentity;
  if(identity&&!/^WeftMate [a-z0-9]+$/.test(identity))throw Error('Invalid installer test identity');
  writeFileSync(join(out,'identity.nsh'),`!define WEFT_CONTROL_NAMESPACE "${identity?identity+'\\':''}"\n${identity?'!define WEFT_TEST_IDENTITY\n':''}`);
};
// afterPack sees the final app.asar, unpacked dependencies, DSH and memory
// runtime. Compile the same UI with that payload's exact path budget.
module.exports.compile = async context => {
  const root=context.packager.projectDir,out=join(root,'.local/installer-ui');
  await require('./installer-payload-paths.cjs').writeInstallerPayloadHeader(context.appOutDir,out);
  const run=(cmd,args,options={})=>{
    const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,timeout:120000,...options});
    if(r.status!==0)throw Error(`Installer asset compilation failed: ${r.stderr||r.stdout||r.error}`);
    return r.stdout.trim();
  };
  const vs=run(join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe'),['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath']);
  if(!vs)throw Error('Installer assets need Visual Studio C++ build tools (x86).');
  const identity=context.packager.config.extraMetadata?.desktopIdentity;
  const envScript=join(out,'compiler-env.cmd');
  writeFileSync(envScript,`@call "${join(vs,'VC/Auxiliary/Build/vcvars32.bat')}" >nul\r\n@set\r\n`);
  const envText=run('cmd.exe',['/d','/c',envScript]);
  const env={...process.env};for(const line of envText.split(/\r?\n/)){const i=line.indexOf('=');if(i>0)env[line.slice(0,i)]=line.slice(i+1);}
  run('cl.exe',['/nologo','/LD','/std:c++17','/O2','/MT','/utf-8','/W4','/WX','/DUNICODE','/D_UNICODE',...(identity?['/DWEFT_QA']:[]),`/I${out}`,resolve(root,'build/installer-ui.cpp'),resolve(root,'build/installer-directory.cpp'),resolve(root,'build/installer-components.cpp'),`/Fo${out}\\`,'/link',`/DEF:${join(root,'build/installer-ui.def')}`,`/OUT:${join(out,'WeftInstaller.dll')}`,'/Brepro','user32.lib','gdi32.lib','advapi32.lib','comctl32.lib','dwmapi.lib','shell32.lib','shlwapi.lib','ole32.lib'],{env,cwd:out});
};
