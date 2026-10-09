// 读取 sales.csv，计算每个商品的小计与总营业额，写入 result.json
// 只用 Node.js 内置模块（node:fs），无需安装任何第三方包。
// 参考: https://nodejs.org/api/fs.html  (File system — Synchronous example / fs.readFileSync)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const csvPath = join(dir, 'sales.csv');
const outPath = join(dir, 'result.json');

const text = readFileSync(csvPath, 'utf8');

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
// 第一行为表头：商品,单价,数量
const subtotals = {};
let total = 0;

for (const line of lines.slice(1)) {
  const [name, priceRaw, qtyRaw] = line.split(',').map((s) => s.trim());
  const price = Number(priceRaw);
  const qty = Number(qtyRaw);
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) continue;
  const subtotal = price * qty;
  subtotals[name] = Math.round(((subtotals[name] ?? 0) + subtotal) * 100) / 100;
  total += subtotal;
}

const result = { subtotals, total: Math.round(total * 100) / 100 };
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result));
