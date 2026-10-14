import { evidencePath } from '../helpers/evidence-path.mjs';
/** Render the supplied controls preview and a side by side comparison. */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const spec=process.argv[2];if(!spec)throw Error('Pass the supplied controls specification directory.');
const output=evidencePath('model-1');await mkdir(output,{recursive:true});
const tokens=JSON.parse(await readFile(join(spec,'tokens.json'),'utf8')),css=await readFile(join(spec,'components/bundle.css'),'utf8'),preview=await readFile(join(spec,'components/ModelPicker/preview.html'),'utf8');
const base=[...tokens.spacing.tokens,...tokens.radius.tokens].map(t=>`--${t.name}:${t.value}`).join(';')+`;--font-sans:${tokens.type.families.sans};`;
const themed=tokens.color.themes.map(theme=>`[data-theme="${theme.id}"]{${base}${[...tokens.color.tokens,...tokens.shadow.tokens].map(t=>`--${t.name}:${t.value[theme.id]}`).join(';')}}`).join('\n');
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:1100}});await page.setContent(preview.replace('</head>',`<style>${themed}\n${css}</style></head>`));await page.screenshot({path:join(output,'spec-preview.png'),fullPage:true});
  for(const mode of ['light','dark']){
    const ref=page.locator(`.wm-pv[data-theme="${mode}"] .wm-menu`).first();await ref.screenshot({path:join(output,`spec-${mode}-menu.png`)});
    const reference=await readFile(join(output,`spec-${mode}-menu.png`)),actual=await readFile(join(output,`electron-1200-${mode}-menu.png`));
    const comparison=await browser.newPage({viewport:{width:1280,height:960}});await comparison.setContent(`<style>body{margin:0;background:${mode==='dark'?'#1c1c1e':'#faf9f7'};color:${mode==='dark'?'#f2f2f4':'#272724'};font:15px 'Segoe UI',sans-serif}main{display:grid;grid-template-columns:380px 1fr;gap:24px;padding:24px}img{max-width:100%;height:auto}p{line-height:1.6}small{font-size:12px}</style><main><section><h2>控件规范 · ModelPicker</h2><img src="data:image/png;base64,${reference.toString('base64')}"><p>选择项右侧打勾，选中项不加底色。菜单内按服务分组，底部添加服务。</p><small>规范样例有多个服务；实际合成账户只有一个服务，所以省略组标题。</small></section><section><h2>真实 Electron · ${mode==='light'?'浅色':'深色'}</h2><img src="data:image/png;base64,${actual.toString('base64')}"><p>同样的星芒、菜单圆角、字号与行高。程序既有页面配色保留，本包菜单按中性灰规范。</p></section></main>`);await comparison.screenshot({path:join(output,`spec-comparison-${mode}.png`),fullPage:true});await comparison.close();
  }
}finally{await browser.close();}
await writeFile(join(output,'comparison-source.json'),JSON.stringify({source:'supplied controls-spec/components/ModelPicker/preview.html + tokens.json + bundle.css',actual:'real Electron page screenshots',artifactPreview:'online artifact was unavailable; local source preview used'},null,2)+'\n');
