import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=import.meta.dirname,spec='D:/AIProjects/WeftMate/Runtime/Orchestrator/controls-spec';
const tokens=JSON.parse(await readFile(join(spec,'tokens.json'),'utf8'));
await writeFile(join(dir,'controls-spec.json'),JSON.stringify(tokens,null,2)+'\n');
const variables=[];
for(const row of tokens.color.tokens)variables.push(`--${row.name}:${row.value.dark}`);
for(const group of ['spacing','radius'])for(const row of tokens[group].tokens)variables.push(`--${row.name}:${row.value}`);
variables.push(`--font-sans:${tokens.type.families.sans}`,`--shadow-float:${tokens.shadow.tokens.find(r=>r.name==='shadow-float').value.dark}`);
const css=await readFile(join(spec,'components/bundle.css'),'utf8');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--weftmate-and5-spec-preview']});
try{
  const page=await browser.newPage({viewport:{width:390,height:694},deviceScaleFactor:720/390});
  await page.route('**/*',route=>route.abort());
  for(const name of ['Button','IconButton','Menu']){
    await page.setContent(await readFile(join(spec,`components/${name}/preview.html`),'utf8'));
    await page.addStyleTag({content:`${css}\n.wm[data-theme="dark"]{${variables.join(';')}}.wm-pair{display:block;padding:0}.wm-pv{width:390px;min-height:694px;border-radius:0;border:0}`});
    await page.locator('.wm[data-theme="light"]').evaluateAll(nodes=>nodes.forEach(node=>node.remove()));
    await page.locator('.wm[data-theme="dark"]').screenshot({path:join(dir,`spec-${name.toLowerCase()}-dark.png`)});
  }
}finally{await browser.close();}
console.log('Rendered three dark controls-spec previews; external requests blocked');
