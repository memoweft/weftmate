// 用 Node.js 内置 node:fs 读取 CSV 文本，计算各商品小计与合计（无需任何第三方包）
// 参考: https://nodejs.org/learn/manipulating-files/reading-files-with-nodejs
//       https://nodejs.org/api/fs.html
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, 'sales.csv');
const outPath = join(here, 'result.json');

// fs.readFileSync(path, 'utf8') 同步读取整个文件内容为字符串
const text = readFileSync(csvPath, 'utf8');

const lines = text
  .replace(/^\uFEFF/, '') // 去掉可能的 BOM
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

if (lines.length < 2) {
  console.error('sales.csv 没有数据行');
  process.exit(1);
}

const header = lines[0].split(',').map((h) => h.trim());
const idxName = header.indexOf('商品');
const idxPrice = header.indexOf('单价');
const idxQty = header.indexOf('数量');
if (idxName < 0 || idxPrice < 0 || idxQty < 0) {
  console.error('表头缺少需要的列，期望: 商品,单价,数量 -> ' + header.join(','));
  process.exit(1);
}

const subtotals = {};
let total = 0;

for (const line of lines.slice(1)) {
  const cells = line.split(',').map((c) => c.trim());
  const name = cells[idxName];
  const price = Number(cells[idxPrice]);
  const qty = Number(cells[idxQty]);
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) {
    console.error('无法解析的数据行: ' + line);
    process.exit(1);
  }
  const amount = price * qty;
  subtotals[name] = Math.round(((subtotals[name] ?? 0) + amount) * 100) / 100;
  total = Math.round((total + amount) * 100) / 100;
}

const result = { 小计: subtotals, 合计: total };

// 用内置 API 写回 JSON
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log(JSON.stringify(result, null, 2));
console.log('已写入 ' + outPath);
