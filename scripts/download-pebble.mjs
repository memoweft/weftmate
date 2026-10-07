// Official Pebble v2.10.1 test tools/fixtures, never installed as a service.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const version = '2.10.1';
const target = `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
const hashes = {
  'darwin-amd64': ['e670ff869886022637e077502a62e7f23be693c45a5a6727ebd76da8fdce64dc','796bd923f2c595dd7bf15ae693096abfb1df962cb3673c7981ff306daa5c4a52'],
  'darwin-arm64': ['09a3a4e6ebed71e8d83294a26d361232262f45a7488f5de7bccb5887b395217f','59bf917fe39c96e2edca980fc2899f4f04aa1ce5485f28d419d18237b902cf82'],
  'linux-amd64': ['4f2fcb5bca8c85c9cf73ad140fccfc0d2be40bd81ab99879c79b7b8a0b4f70ed','e93a5aa25ecdf3af2f9fbb2de32b0173e64a2eae81002a4ccfe35fa6f4f60b92'],
  'linux-arm64': ['b53fd072a69eb7692451de4e8b0667e0bdf5cccd7e36fc51b8eaf2fcc135ed9f','db8e1a79ccdb2195c489fbe4f40fddb7f30e86f9cd8a07912566ee5025094d6c'],
};
if (!hashes[target]) throw new Error(`Unsupported Pebble test platform ${target}`);
const root = path.resolve('.local/pebble');
async function download(url, file, expected) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let data = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!data) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pebble download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Pebble fixture/binary SHA256 mismatch');
  await writeFile(file, data, { mode: 0o600 });
}
await mkdir(path.join(root, 'bin'), { recursive: true, mode: 0o700 });
for (const [index, binary] of ['pebble','pebble-challtestsrv'].entries()) {
  const name = `${binary}-${target}`, archive = path.join(root, `${name}.tar.gz`);
  await download(`https://github.com/letsencrypt/pebble/releases/download/v${version}/${name}.tar.gz`, archive, hashes[target][index]);
  await promisify(execFile)('tar', ['-xzf', archive, '-C', root]);
  const file = path.join(root, 'bin', binary);
  await copyFile(path.join(root, name, process.platform, target.split('-')[1], binary), file); await chmod(file, 0o700);
}
for (const [name, digest] of Object.entries({
  'pebble.minica.pem': '0c502e52627ff7de972c7e9e065640103b4589b4e2d23d3fcf21bef1e3c8c67c',
  'localhost/cert.pem': 'c87fb918d9bac8db11aa54493b5f0cf6e0725a3fe73f617d1c64737e1ab4caf9',
  'localhost/key.pem': '0977979255b0e0721c17335c056b627f66a43cf56e5a52f3cda81fb111ecf00e',
})) await download(`https://raw.githubusercontent.com/letsencrypt/pebble/v${version}/test/certs/${name}`, path.join(root,'certs', name), digest);
console.log(root);
