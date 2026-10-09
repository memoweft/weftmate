// 反复统计 sales.csv 的营业额。只用 Node.js 内置模块 node:fs，无需安装任何额外包。
// 参考资料：Node.js 官方 File system 文档 https://nodejs.org/api/fs.html
import { readFileSync, writeFileSync } from 'node:fs';

const csvPath = new URL('./sales.csv', import.meta.url);
const jsonPath = new URL('./result.json', import.meta.url);

// 读整个文本文件：fs.readFile(path, 'utf8')，这里用同步形式 readFileSync，得到字符串
const text = readFileSync(csvPath, 'utf8');

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
const header = lines[0].split(',');
const col = Object.fromEntries(header.map((name, i) => [name, i]));

const items = [];
let total = 0;
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const name = cells[col['商品']];
  const unitPrice = Number(cells[col['单价']]);
  const quantity = Number(cells[col['数量']]);
  if (!name || !Number.isFinite(unitPrice) || !Number.isFinite(quantity)) continue;
  const subtotal = Math.round(unitPrice * quantity * 100) / 100; // 避免浮点尾差
  items.push({ 商品: name, 单价: unitPrice, 数量: quantity, 小计: subtotal });
  total += subtotal;
}

const result = {
  数据源: 'sales.csv',
  商品小计: items,
  合计: Math.round(total * 100) / 100,
};

// 文本写入文件：writeFileSync，无需任何第三方包
writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log(JSON.stringify(result, null, 2));
