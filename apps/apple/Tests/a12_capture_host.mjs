// Render actual captured host events/receipts for review; no fabricated app UI.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory=process.argv[2];
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});
 for(const scene of ['approve-pending','approve-ended','reject-pending','reject-ended']) {
  const report=JSON.parse(await readFile(join(directory,scene+'-host.json'),'utf8'));
  const scenario=scene.startsWith('approve')?'approve':'reject';
  const row=report.scenarios.find(value=>value.name===scenario);
  const events=report.events.filter(value=>value.scenario===scenario);
  const http=report.approvalHTTP.filter(value=>value.path.endsWith(row.approvalId));
  const html=`<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;margin:40px;color:#202020;background:#fafafa}h1{font-size:28px}p{color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px monospace;background:white;border:1px solid #ddd;padding:20px;border-radius:12px}b{color:#202020}</style><h1>A12 · ${escape(scene)} · 真实隔离宿主记录</h1><p>Mac 本地个人宿主；真实审批 HTTP / 持久回执；合成规划器与合成文件。此图是事件 JSON 的可读渲染。</p><p><b>审批：</b>${escape(row.approvalId)}<br><b>任务：</b>${escape(row.commandId)}<br><b>文件：</b>${escape(row.filename)}<br><b>结果：</b>${escape(row.outcome??'pending')} · <b>实际文件存在：</b>${escape(row.fileExists??'尚未决定')}</p><pre>${escape(JSON.stringify(events,null,2))}</pre><pre>${escape(JSON.stringify(http.map(value=>({status:value.status,request:value.request,reply:value.reply})),null,2))}</pre>`;
  await page.setContent(html);await page.screenshot({path:join(directory,scene+'-host.png'),fullPage:true});
 }
}finally{await browser.close();}
console.log('PASS four host event screenshots from actual captured JSON');
