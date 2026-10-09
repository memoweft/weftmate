// sum.mjs — 反复计算 sales.csv 的营业额
// 仅使用 Node.js 内置模块，不需要安装任何额外包。
// 参考资料：Node.js 官方文档「File system」→ fsPromises.readFile(path[, options])
//   https://nodejs.org/api/fs.html#fsfspromisesreadfilepath-options
//   文档要点：Asynchronously reads the entire contents of a file.
//   指定 options.encoding（如 'utf8'）时返回字符串，否则返回 Buffer。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 脚本所在目录，保证在任意工作目录下运行结果一致
const dir = dirname(fileURLToPath(import.meta.url));
const csvPath = join(dir, 'sales.csv');
const outPath = join(dir, 'result.json');

// —— 读文本文件（按官方文档写法，指定 utf8 编码）——
const text = await readFile(csvPath, { encoding: 'utf8' });

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
if (lines.length === 0) throw new Error('sales.csv 是空文件');

const header = lines[0].split(',').map((h) => h.trim());
const iName = header.indexOf('商品');
const iPrice = header.indexOf('单价');
const iQty = header.indexOf('数量');
if (iName < 0 || iPrice < 0 || iQty < 0) {
  throw new Error(`表头不符合预期，应包含 商品,单价,数量；实际为：${header.join(',')}`);
}

// —— 逐行累计每个商品的小计（同一商品多行会自动合并）——
const subtotalByName = new Map();
for (const line of lines.slice(1)) {
  const cols = line.split(',').map((c) => c.trim());
  const name = cols[iName];
  const price = Number(cols[iPrice]);
  const qty = Number(cols[iQty]);
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) continue; // 跳过空行/脏数据
  subtotalByName.set(name, (subtotalByName.get(name) ?? 0) + price * qty);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const items = [...subtotalByName].map(([name, sum]) => ({ 商品: name, 小计: round2(sum) }));
const 合计 = round2(items.reduce((s, it) => s + it.小计, 0));

const result = { 商品小计: items, 合计 };
await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8' });

console.log(JSON.stringify(result, null, 2));
console.log(`结果已写入 ${outPath}`);
