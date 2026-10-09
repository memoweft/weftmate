import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRP_VERSION = '0.71.0';
// Digests from the official v0.71.0 release assets, verified before extraction.
export const FRP_SHA256 = Object.freeze({
  darwin_amd64: '1b1b4e2f1836e21e8733f1dddaacd4ed9ae67d7dbee39046b9d7b7eda6253637',
  darwin_arm64: '45be02b186860d375ed49a8941ae9569628a54bf14e67fc36b29c98c99dabcc6',
  linux_amd64: '84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716',
  linux_arm64: 'f33c293c275d8fc68c654b6fba8f10b2551d6463d09a9fc9cffb7227eae82266',
  windows_amd64: '9e5062e3e5cf07e67144a3a4acf175ef6a2486f3605dd6cf288bae34ab39819f',
  windows_arm64: 'b56a5c2a1a2a55d11bc27aeef6edabd39f3d194360ea66660cc27281b502cb1c',
});
export async function downloadFrp({ platform = process.platform, arch = process.arch,
  destination = path.resolve('.local/frp'), fetcher = fetch } = {}) {
  platform = platform === 'win32' ? 'windows' : platform;
  const target = `${platform}_${arch === 'x64' ? 'amd64' : arch}`;
  const digest = FRP_SHA256[target];
  if (!digest) throw new Error(`Unsupported frp target: ${target}`);
  const name = `frp_${FRP_VERSION}_${target}`, suffix = platform === 'win32' || platform === 'windows' ? 'zip' : 'tar.gz';
  // Node names Windows win32; normalize before forming the official release URL.
  const officialName = name.replace('_win32_', '_windows_');
  const url = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${officialName}.${suffix}`;
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const archive = path.join(destination, `${officialName}.${suffix}`);
  let data;
  try { data = await readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data) {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Official frp download failed: ${response.status}`);
    // GitHub Releases redirect to GitHub's official asset CDN; never use mirrors.
    const final = new URL(response.url || url);
    if (!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname))
      throw new Error('Unexpected frp download origin');
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(data).digest('hex') !== digest) throw new Error('frp SHA256 mismatch');
  await writeFile(archive, data, { mode: 0o600 });
  const run = promisify(execFile);
  if (suffix === 'zip') {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [IO.Compression.ZipFile]::OpenRead($env:WEFTMATE_FRP_ARCHIVE); try { foreach ($entry in $archive.Entries) { $target = [IO.Path]::GetFullPath([IO.Path]::Combine($env:WEFTMATE_FRP_DEST, $entry.FullName)); $base = [IO.Path]::GetFullPath($env:WEFTMATE_FRP_DEST) + [IO.Path]::DirectorySeparatorChar; if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive entry' }; if ($entry.Name) { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true) } else { [IO.Directory]::CreateDirectory($target) | Out-Null } } } finally { $archive.Dispose() }"],
      { env: { ...process.env, WEFTMATE_FRP_ARCHIVE: archive, WEFTMATE_FRP_DEST: destination } });
  } else await run('tar', ['-xzf', archive, '-C', destination]);
  const dir = path.join(destination, officialName);
  if (suffix !== 'zip') for (const binary of ['frpc','frps']) await chmod(path.join(dir, binary), 0o700);
  return dir;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(await downloadFrp({ platform: process.platform === 'win32' ? 'windows' : process.platform }));
}
