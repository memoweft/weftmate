import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const METHODS=new Set(['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']);
/** Inspect child_process bindings, promisified aliases and injected executors.
 * RegExp.exec, database.exec and the DSH session fork API are unrelated.
 */
export function hiddenSubprocessViolations(source,file='fixture.mjs',{allowWindowsConditional=false}={}){
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  const executors=new Set(),namespaces=new Set(),wrapped=new Set(['boundedCommand']);
  const walk=(node,visit)=>{visit(node);ts.forEachChild(node,child=>walk(child,visit));};
  const name=node=>ts.isIdentifier(node)||ts.isStringLiteral(node)?node.text:ts.isPropertyAccessExpression(node)?node.name.text:undefined;
  const direct=node=>ts.isIdentifier(node)&&executors.has(node.text)||ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&namespaces.has(node.expression.text)&&METHODS.has(node.name.text);
  walk(tree,node=>{if(ts.isImportDeclaration(node)&&['node:child_process','child_process','cross-spawn'].includes(node.moduleSpecifier.text)){
    const bindings=node.importClause?.namedBindings;if(bindings&&ts.isNamedImports(bindings))for(const binding of bindings.elements)if(METHODS.has(binding.propertyName?.text??binding.name.text))executors.add(binding.name.text);
    if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
    if(node.importClause?.name){if(node.moduleSpecifier.text==='cross-spawn')executors.add(node.importClause.name.text);else namespaces.add(node.importClause.name.text);}
  }});
  let changed=true;while(changed){changed=false;walk(tree,node=>{
    if((ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isBindingElement(node))&&ts.isIdentifier(node.name)&&node.initializer){
      const init=node.initializer;let alias=direct(init);
      if(ts.isCallExpression(init)&&name(init.expression)==='promisify')alias=init.arguments.some(direct);
      if(ts.isBinaryExpression(init))alias=direct(init.left)||direct(init.right);
      if(alias&&!executors.has(node.name.text)){executors.add(node.name.text);changed=true;}
      if(name(init)==='boundedCommand'&&!wrapped.has(node.name.text)){wrapped.add(node.name.text);changed=true;}
    }
  });}
  // These names are the repository's injection seams whose defaults are spawn.
  // Recognize property calls too, including this.#options.spawnImpl(...).
  const injected=new Set(['spawnImpl','spawnProcess']);
  const violations=[];
  walk(tree,node=>{if(!ts.isCallExpression(node))return;const callee=name(node.expression);
    const processCall=direct(node.expression)||(ts.isIdentifier(node.expression)&&wrapped.has(callee))||ts.isPropertyAccessExpression(node.expression)&&injected.has(callee);
    if(!processCall)return;
    const options=node.arguments.filter(ts.isObjectLiteralExpression);
    // Opening the verified Windows Notepad GUI is the explicitly requested
    // desktop action. SW_HIDE would also hide that intended application window.
    // Its GUI executable has no console; this precise action is the only exception.
    const notepad=file.replaceAll('\\','/').endsWith('src/personal-desktop-task.mjs')&&callee==='spawnProcess'&&
      node.arguments[0]?.getText(tree)==='executable'&&source.includes("const executable = path.win32.join(systemRoot, 'System32', 'notepad.exe');")&&
      options.some(option=>['shell: false','detached: true',"stdio: 'ignore'",'windowsHide: false'].every(value=>option.getText(tree).includes(value)));
    if(notepad)return;
    const hidden=options.some(option=>{
      let hides=false;
      for(const property of option.properties){
        if(ts.isSpreadAssignment(property))hides=false;
        if(ts.isPropertyAssignment(property)&&name(property.name)==='windowsHide'){
          const value=property.initializer;
          hides=value.kind===ts.SyntaxKind.TrueKeyword||allowWindowsConditional&&ts.isBinaryExpression(value)&&value.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&value.left.getText(tree)==='process.platform'&&ts.isStringLiteral(value.right)&&value.right.text==='win32';
        }
      }
      return hides;
    });
    if(!hidden){const position=tree.getLineAndCharacterOfPosition(node.getStart(tree));violations.push(`${file}:${position.line+1}: ${callee} must set windowsHide: true`);}
  });return violations;
}
export async function checkHiddenSubprocesses(root=resolve('src')){
  const failures=[];
  async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(/\.(?:[cm]?js|ts)$/.test(entry.name))failures.push(...hiddenSubprocessViolations(await readFile(file,'utf8'),relative(resolve('.'),file)));}}
  await visit(root);return failures;
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href){const failures=await checkHiddenSubprocesses();if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('All source subprocess launches hide console windows.');}
