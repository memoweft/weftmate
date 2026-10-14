import { evidencePath } from '../../tests/helpers/evidence-path.mjs';
import { survey } from './ci-failure-survey.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const since = process.argv[2] || '2026-10-12T13:16:07Z';
const destination = evidencePath('ci-3');
const workflows = ['ci.yml', 'review-gallery.yml', 'windows-package.yml', 's1c-web.yml', 'relay.yml', 'host-certs.yml', 'vendor-tests.yml'];
const results = [];
for (const workflow of workflows) results.push(await survey({ workflow, since, limit: 1000, allJobs: true,
  cache: `.local/ci-3/survey/${workflow}`, destination: `.local/ci-3/survey/${workflow}` }));
mkdirSync(destination, {recursive:true});
const table = results.flatMap(result => result.table.map(row => ({workflow:result.workflow, ...row})));
const output = {since, generatedAt:new Date().toISOString(), workflows:results, table};
writeFileSync(`${destination}/flaky-table.json`, JSON.stringify(output,null,2)+'\n');
const cell = value => String(value).replaceAll('|','\\|').replaceAll('\n',' ');
writeFileSync(`${destination}/flaky-table.md`, [
  '# CI-3：CI-1 合并之后的全部检查失败', '',
  `起点：#242 合并 ${since}；采集结束：${output.generatedAt}。每个工作流所有运行、所有历史尝试均保留；重跑成功不抹掉首轮失败。历史失败仅为观察，定性另见 decisions.md。`, '',
  '| 工作流 | 运行数 | 历史任务尝试数 | 取证错误 |','|---|---:|---:|---:|',
  ...results.map(r=>`| ${r.workflow} | ${r.runs.length} | ${r.observations.length} | ${r.errors.length} |`), '',
  '| 工作流 | 检查 / 平台 | 文件 | 用例 / 步骤 | 类型 | 失败尝试数 | run / attempt（运行 / 尝试） |',
  '|---|---|---|---|---|---:|---|',
  ...table.map(r=>`| ${[r.workflow,r.job,r.file,r.name,r.type,r.count,r.attempts.join(', ')].map(cell).join(' | ')} |`),'',
  '原始日志只存本包 .local；公开 JSON（结构化数据）保留清理身份后的诊断片段、完整运行链接和每次任务结论。',
].join('\n'));
console.log(JSON.stringify({runs:results.map(r=>[r.workflow,r.runs.length]),errors:results.flatMap(r=>r.errors),failures:table.length}));
