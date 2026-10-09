// sum.mjs — 反复统计 sales.csv 的营业额：各商品小计 + 合计
// 只用 Node.js 内置模块，无需安装任何额外包。
// 参考资料：Node.js 官方 File system 文档 https://nodejs.org/api/fs.html
//   - fs.readFileSync(path[, options])：指定 encoding 时返回字符串
//   - fsPromises.readFile(path[, options])：不指定 encoding 时返回 Buffer
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 脚本自身所在目录，保证换工作目录也能反复跑
const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, 'sales.csv');
const jsonPath = join(here, 'result.json');

// 用 utf8 把文本文件整个读成字符串（官方文档：指定 encoding 则返回 string）
const text = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');

const round2 = (n) => Math.round(n * 100) / 100;

const subtotals = Object.create(null);
let total = 0;
let rows = 0;

for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  const [rawName, rawPrice, rawQty] = trimmed.split(',').map((s) => s.trim());
  if (rawName === '商品') continue; // 跳过表头

  const price = Number(rawPrice);
  const qty = Number(rawQty);
  if (rawName === undefined || Number.isNaN(price) || Number.isNaN(qty)) {
    throw new Error(`无法解析的行: ${line}`);
  }

  const amount = price * qty;
  subtotals[rawName] = round2((subtotals[rawName] ?? 0) + amount);
  total = round2(total + amount);
  rows += 1;
}

const result = {
  subtotals: { ...subtotals },
  total,
  小计: { ...subtotals },
  合计: total,
};

writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`已读取 ${csvPath}，统计 ${rows} 行 -> ${jsonPath}`);
console.log(JSON.stringify(result, null, 2));
