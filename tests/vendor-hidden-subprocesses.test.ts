import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { hiddenSubprocessViolations } from '../scripts/check-hidden-subprocesses.mjs';

test('pinned DSH tools and MCP stdio transports hide every direct console subprocess',async()=>{
  const runtime=new URL('../vendor/dsh-runtime/node_modules/',import.meta.url);
  const mcpSdk=createRequire(new URL('@deepseek-ai/dsh-mcp-client/package.json',runtime)).resolve('@modelcontextprotocol/sdk/client/stdio.js');
  const mcpSource=await readFile(mcpSdk,'utf8');
  assert.deepEqual(hiddenSubprocessViolations(mcpSource,'MCP client stdio transport',{allowWindowsConditional:true}),[],'MCP client stdio transport');
  const subprocessDir=new URL('@deepseek-ai/dsh-subprocess-local/lib/',runtime);
  for(const file of await readdir(subprocessDir)){
    if(!file.endsWith('.js'))continue;
    const label=`@deepseek-ai/dsh-subprocess-local/lib/${file}`;
    const source=await readFile(new URL(file,subprocessDir),'utf8');
    const lines=source.split('\n');
    const violations=hiddenSubprocessViolations(source,label,{allowWindowsConditional:true}).filter(v=>{
      const lineNo=Number(/:(\d+):/.exec(v)?.[1]??0);
      const context=lines.slice(Math.max(0,lineNo-6),lineNo+2).join('\n');
      if(file==='index.js'&&v.includes('execFile must set windowsHide: true')&&context.includes('function querySystemctl('))return false;
      if(file.startsWith('runner-launch-')&&v.includes('execFileSync must set windowsHide: true')&&context.includes('exec: (file, args) => execFileSync')&&source.includes('if (platform === "win32") return createWindowsProcessInspector();'))return false;
      return true;
    });
    assert.deepEqual(violations,[],label);
  }
});
test('native restricted-token launches hide their windows while retaining token and creation flags',async()=>{
  const directory=new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-win32-process/lib/',import.meta.url);
  const startups=[],creationFlags=[],restrictedCalls=[];
  function numeric(node){
    if(node&&ts.isNumericLiteral(node))return Number(node.text);
    if(node&&ts.isParenthesizedExpression(node))return numeric(node.expression);
    if(node&&ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarToken)return numeric(node.left)|numeric(node.right);
    throw Error('Native spawn flags must be statically inspectable numeric constants.');
  }
  function visit(node,tree){
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='encodeStartupInfo'){
      const options=node.arguments[1];assert.ok(ts.isObjectLiteralExpression(options));
      const properties=Object.fromEntries(options.properties.filter(ts.isPropertyAssignment).map(property=>[property.name.getText(tree),property.initializer]));
      const flags=numeric(properties.dwFlags);
      assert.equal(flags&0x100,0x100,'stdio inheritance must remain intact');assert.equal(flags&1,1,'STARTF_USESHOWWINDOW must be set');
      assert.equal(numeric(properties.wShowWindow),0,'SW_HIDE must be explicit');startups.push(flags);
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='createProcessAsUserW'){
      assert.equal(node.arguments[0].getText(tree),'options.token','the existing restricted token must be preserved');
      assert.equal(node.arguments[6].getText(tree),'creationFlags');restrictedCalls.push(node);
    }
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='createRestrictedProcess'){
      creationFlags.push(numeric(node.arguments[3]));
    }
    ts.forEachChild(node,child=>visit(child,tree));
  }
  for(const file of await readdir(directory))if(file.endsWith('.js')){const text=await readFile(new URL(file,directory),'utf8');const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);visit(tree,tree);}
  assert.equal(restrictedCalls.length,1,'restricted launches must share the token-preserving native call');
  assert.equal(startups.length,2,'piped and inherited stdio launches must both be covered');
  assert.deepEqual(creationFlags.sort((a,b)=>a-b),[0,4],'retain normal/suspended creation; do not add console isolation flags');
});
