// 读取 sales.csv（UTF-8 文本），按商品汇总小计，并算出合计。
// 仅使用 Node.js 内置模块 node:fs/promises，无需安装任何第三方包。
// 参考：Node.js 官方文档 File system — fsPromises.readFile(path[, options])
//       https://nodejs.org/api/fs.html#fspromisesreadfilepath-options
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const csvPath = join(dir, 'sales.csv');
const jsonPath = join(dir, 'result.json');

const text = await readFile(csvPath, 'utf8'); // 以 utf8 字符串读入整份文本

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
const header = lines[0].split(',').map((s) => s.trim());
// 期望表头：商品,单价,数量
const iName = header.indexOf('商品');
const iPrice = header.indexOf('单价');
const iQty = header.indexOf('数量');
if (iName < 0 || iPrice < 0 || iQty < 0) {
  throw new Error(`CSV 表头不符合预期: ${lines[0]}`);
}

const subtotals = {};
let total = 0;
for (const line of lines.slice(1)) {
  const cols = line.split(',').map((s) => s.trim());
  const name = cols[iName];
  const price = Number(cols[iPrice]);
  const qty = Number(cols[iQty]);
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) {
    throw new Error(`无法解析的数据行: ${line}`);
  }
  const amount = price * qty;
  subtotals[name] = Math.round(((subtotals[name] ?? 0) + amount) * 100) / 100;
  total = Math.round((total + amount) * 100) / 100;
}

const result = {
  source: 'sales.csv',
  generatedAt: new Date().toISOString(),
  subtotals,
  total,
};

await writeFile(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
