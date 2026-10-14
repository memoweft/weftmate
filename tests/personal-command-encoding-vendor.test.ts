import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCommandCollector, installCommandEncoding } from '../src/plugins/personal-command-encoding.mjs';

test('native DSH shell collectors decode GBK before foreground and background tool reads',async()=>{
 const {Context}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js');
 const {LocalSubprocessRuntime}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js');
 const {resolvePwshPath,ENCODING_PREAMBLE}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-pwsh-local/lib/index.js');
 const ctx=new Context();const runtime=new LocalSubprocessRuntime(ctx);
 const hex='d6d0cec4c3fcc1eecae4b3f60a';
 const code=`process.stdout.write(Buffer.from('${hex}','hex'));process.stderr.write(Buffer.from('${hex}','hex'));process.stdout.write('English output\\n'+String.fromCodePoint(0x4e2d,0x6587)+' UTF-8\\n')`;
 const argv=process.platform==='win32'?[resolvePwshPath(),'-NoLogo','-NoProfile','-NonInteractive','-Command',`${ENCODING_PREAMBLE}& '${process.execPath.replaceAll("'","''")}' -e "${code.replaceAll('"','`"')}"`]:[process.execPath,'-e',code];
 const spec={argv,cwd:process.cwd(),graceMs:1000,stdio:{stdin:'ignore',stdout:{maxBytes:4096},stderr:{maxBytes:4096}}};
 let dispose=()=>{};
 try {
  const original=runtime.spawn(spec);await original.done;
  // This is the shipped collector's actual UTF-8-only behavior, not a mock.
  assert.notEqual(original.collected.stdout.readFrom(0).text,'中文命令输出\nEnglish output\n中文 UTF-8\n');
  dispose=installCommandEncoding(runtime,{platform:'win32',codePage:936});
  const fixed=runtime.spawn(spec);
  if(process.platform!=='win32')for(const reader of Object.values(fixed.collected))adaptCommandCollector(reader,936);
  await fixed.done;
  assert.equal(fixed.collected.stdout.readFrom(0).text,'中文命令输出\nEnglish output\n中文 UTF-8\n');
  assert.equal(fixed.collected.stderr.readFrom(0).text,'中文命令输出\n');
 }finally{dispose();await ctx.fiber.dispose();}
});
