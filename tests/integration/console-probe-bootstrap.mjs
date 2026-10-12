import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MemoWeftRpc } from '../../src/personal-memory/rpc.mjs';
// Synthetic acceptance stays off the user's working desktop.
app.on('browser-window-created', (_event, window) => {
  window.setBounds({ x: -20000, y: -20000, width: 1000, height: 800 });
  window.setFocusable(false);
  window.webContents.setBackgroundThrottling(false);
});
await import('./personal-approval-bootstrap.mjs');
const root=process.env.UX2_CONSOLE_PROBE_ROOT, execute=promisify(execFile);
let running=false;
const extraTimer=setInterval(async()=>{
  if(running)return;let request;try{request=JSON.parse(await readFile(join(root,'extra-request.json'),'utf8'));}catch{return;}running=true;
  const result={};
  try{
    if(request.positiveControl){
      await writeFile(join(root,'phase.txt'),'positive-control');await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`try{$Host.UI.RawUI.WindowTitle='${process.env.UX2_CONSOLE_MARKER}-positive'}catch{}; Start-Sleep -Milliseconds 700`],{windowsHide:false});result.nodePositiveControl=true;
      await writeFile(join(root,'phase.txt'),'native-positive-control');await writeFile(join(root,'native-positive-request'),'');await new Promise(r=>setTimeout(r,1700));result.nativePositiveControl=true;
    }
    await writeFile(join(root,'phase.txt'),'system-query');
    await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Write-Output 'synthetic-system-query'"],{windowsHide:true});result.systemQuery=true;
    await writeFile(join(root,'phase.txt'),'git');await execute('git',['--version'],{windowsHide:true});result.git=true;
    await writeFile(join(root,'phase.txt'),'cmd-shim');
    await execute('cmd.exe',['/d','/c',join(root,'synthetic-command.cmd')],{windowsHide:true});result.cmdShim=true;
    // shell:true is an additional cmd.exe layer, including paths with spaces.
    await execute('cmd.exe',['/d','/c','echo synthetic-shell'],{windowsHide:true,shell:true});result.shell=true;
    const repository=resolve(import.meta.dirname,'../..');
    const {StdioClientTransport}=await import(pathToFileURL(join(repository,'vendor/dsh-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href);
    await writeFile(join(root,'phase.txt'),'mcp-stdio');const transport=new StdioClientTransport({command:'cmd.exe',args:['/d','/c',join(root,'synthetic-command.cmd')],cwd:root,stderr:'pipe'});
    await transport.start();await new Promise(r=>setTimeout(r,250));await transport.close();result.mcpStdio=true;
    if(request.nativeSandbox){
      await writeFile(join(root,'phase.txt'),'native-sandbox');
      const {AclSandbox}=await import(pathToFileURL(join(repository,'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/index.js')).href);
      const sandbox=new AclSandbox({mode:'read-only',writableDirs:[],tempDir:null,manageDacls:false});await sandbox.init();
      try{
        const child=sandbox.spawn({command:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',`try{$Host.UI.RawUI.WindowTitle='${process.env.UX2_CONSOLE_MARKER}-sandbox'}catch{}; Write-Output 'UX2_NATIVE_SANDBOX_OK'; Start-Sleep -Milliseconds 700`],cwd:root});
        const outcome=await child.wait();result.nativeSandbox={exitCode:outcome.exitCode,outputSeen:outcome.stdout.toString().includes('UX2_NATIVE_SANDBOX_OK')};
      }finally{sandbox.dispose();}
    }
    if(request.python&&request.pythonPath){
      const options={python:request.python,pythonPath:request.pythonPath,env:{PYTHONDONTWRITEBYTECODE:'1'}};
      await writeFile(join(root,'phase.txt'),'python-rpc-venv');
      const rpc=new MemoWeftRpc(options);try{const capabilities=await rpc.request('capabilities');result.pythonRpcV2=capabilities.protocol_version===2;}finally{await rpc.close();}
      await writeFile(join(root,'phase.txt'),'python-plugin-venv');const {MemoWeftBridge}=await import(pathToFileURL(join(app.getPath('userData'),'dsh-home/profiles/weftmate/plugins/weftmate-memory.mjs')).href);
      const bridge=new MemoWeftBridge({python:request.python,pythonPath:request.pythonPath,log:{warn(){},info(){}}});
      try{const capabilities=await bridge.request('capabilities');result.pythonPluginRpcV2=capabilities.protocol_version===2;}finally{await bridge.close();}
      result.pythonVirtualEnvironmentLauncher=true;
    }
  }catch(error){result.failure=String(error.code??error.message).replaceAll(root,'%TEMP%/weftmate-ux2-console');}
  clearInterval(extraTimer);await writeFile(join(root,'extra-result.json'),JSON.stringify(result));
},100);extraTimer.unref();
