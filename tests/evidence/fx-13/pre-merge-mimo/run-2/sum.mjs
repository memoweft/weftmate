// 读取 sales.csv（UTF-8），按商品汇总小计，并算出合计，写入 result.json
// 只用 Node.js 内置模块，无需安装任何第三方包。
// 参考：Node.js 官方文档 File system -> fsPromises.readFile(path[, options])
//       https://nodejs.org/api/fs.html#fsfspromisesreadfilepath-options
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const csvPath = join(dir, 'sales.csv');
const outPath = join(dir, 'result.json');

const text = await readFile(csvPath, { encoding: 'utf8' });

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
if (lines.length < 2) throw new Error('sales.csv 没有数据行');

const header = lines[0].split(',');
const idx = {
  name: header.indexOf('商品'),
  price: header.indexOf('单价'),
  qty: header.indexOf('数量'),
};
if (idx.name < 0 || idx.price < 0 || idx.qty < 0) {
  throw new Error('CSV 表头缺少 商品/单价/数量 列: ' + lines[0]);
}

const subtotals = new Map();
let total = 0;

for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const name = cells[idx.name].trim();
  const price = Number(cells[idx.price]);
  const qty = Number(cells[idx.qty]);
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) {
    throw new Error('无法解析的数据行: ' + line);
  }
  const amount = price * qty;
  subtotals.set(name, Math.round(((subtotals.get(name) ?? 0) + amount) * 1e6) / 1e6);
  total = Math.round((total + amount) * 1e6) / 1e6;
}

const result = {
  source: 'sales.csv',
  subtotals: Object.fromEntries(subtotals),
  total,
};

await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8' });
console.log(JSON.stringify(result));
