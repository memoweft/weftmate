/** Apple asset catalogs derived only from design/icons; no platform-specific drawings. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { deflateSync } from 'node:zlib';
const root = resolve(import.meta.dirname, '../../..');
const source = join(root, 'design/icons');
const resources = join(root, 'apps/apple/Resources');
const put = async (path, data) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, data); };
const info = { author: 'xcode', version: 1 };
const json = (path, value) => put(path, JSON.stringify(value, null, 2) + '\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(root, 'scripts/render-icons.cjs')], env });
try {
  // Encode opaque AppIcons as RGB PNGs: canvas PNG exports can retain an alpha channel.
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, crc]);
  };
  const rgbPNG = (rgb, size) => {
    const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
    const rows = Buffer.alloc(size * (size * 3 + 1));
    for (let y = 0; y < size; y++) rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  };
  const raster = async (svg, size, opaque = false) => {
    const bytes = Buffer.from(await app.evaluate(async (_electron, { svg, size, opaque }) => {
      await globalThis.iconRendererReady;
      return globalThis.iconRenderer.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, ${size}, ${size});
          if (${opaque}) {
            const rgba = ctx.getImageData(0, 0, ${size}, ${size}).data;
            const rgb = new Uint8Array(${size * size * 3});
            for (let i = 0, j = 0; i < rgba.length; i += 4) {
              if (rgba[i+3] !== 255) { reject(new Error('AppIcon must be fully opaque')); return; }
              rgb[j++] = rgba[i]; rgb[j++] = rgba[i+1]; rgb[j++] = rgba[i+2];
            }
            let binary = ''; for (let i = 0; i < rgb.length; i += 8192) binary += String.fromCharCode(...rgb.subarray(i, i + 8192));
            resolve(btoa(binary));
          } else { resolve(canvas.toDataURL('image/png').split(',')[1]); }
        }; image.onerror = reject;
        image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
      })`);
    }, { svg, size, opaque }), 'base64');
    return opaque ? rgbPNG(bytes, size) : bytes;
  };
  const imageSet = async (name, svg, size, template = true) => {
    const folder = join(resources, 'Icons.xcassets', name + '.imageset');
    const images = [];
    for (const scale of [1, 2, 3]) {
      const filename = `${name}@${scale}x.png`;
      await put(join(folder, filename), await raster(svg.replaceAll('currentColor', '#000000'), size * scale));
      images.push({ idiom: 'universal', filename, scale: `${scale}x` });
    }
    await json(join(folder, 'Contents.json'), { images, info, properties: { 'template-rendering-intent': template ? 'template' : 'original' } });
  };
  await json(join(resources, 'Icons.xcassets/Contents.json'), { info });
  const names = (await readdir(join(source, 'ui'))).filter(n => n.endsWith('.svg')).sort();
  for (const name of names) {
    const svg = await readFile(join(source, 'ui', name), 'utf8');
    await imageSet('wm-' + name.slice(0, -4), svg, 24);
    await imageSet('wm-' + name.slice(0, -4) + '-small', svg.replace('stroke-width="1.75"', 'stroke-width="1.5"'), 16);
  }
  const light = await readFile(join(source, 'app/color-light.svg'), 'utf8');
  const dark = await readFile(join(source, 'app/color-dark.svg'), 'utf8');
  const mono = await readFile(join(source, 'app/monochrome.svg'), 'utf8');
  await imageSet('wm-brand-monochrome', mono, 64);
  const brand = join(resources, 'Icons.xcassets/wm-brand.imageset');
  const brandImages = [];
  for (const [appearance, svg] of [['light', light], ['dark', dark]]) {
    for (const scale of [1, 2, 3]) {
      const filename = `${appearance}@${scale}x.png`;
      await put(join(brand, filename), await raster(svg, 64 * scale));
      brandImages.push({ idiom: 'universal', filename, scale: `${scale}x`, ...(appearance === 'dark' ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}) });
    }
  }
  await json(join(brand, 'Contents.json'), { images: brandImages, info, properties: { 'template-rendering-intent': 'original' } });
  // iOS/watchOS mask the square themselves. macOS legacy catalogs need the tile silhouette.
  const tile = (svg, color, mac = false) => svg.replace(/(<svg[^>]*>)/, `$1<rect ${mac ? 'x="4" y="4" width="56" height="56" rx="12"' : 'width="64" height="64"'} fill="${color}"/>`);
  for (const platform of ['Mac', 'Phone', 'Watch']) {
    const folder = join(resources, platform + 'Icons.xcassets/AppIcon.appiconset');
    await json(join(resources, platform + 'Icons.xcassets/Contents.json'), { info });
    const images = [];
    if (platform === 'Mac') {
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        const filename = `icon-${size}@${scale}x.png`;
        await put(join(folder, filename), await raster(tile(light, '#FAF9F6', true), size * scale));
        images.push({ idiom: 'mac', size: `${size}x${size}`, scale: `${scale}x`, filename });
      }
    } else {
      const filename = 'icon-1024.png';
      await put(join(folder, filename), await raster(tile(light, '#FAF9F6'), 1024, true));
      images.push({ idiom: 'universal', platform: platform === 'Phone' ? 'ios' : 'watchos', size: '1024x1024', filename });
      if (platform === 'Phone') for (const [value, svg] of [['dark', dark], ['tinted', mono.replaceAll('currentColor', '#FFFFFF')]]) {
        const filename = `icon-${value}-1024.png`;
        await put(join(folder, filename), await raster(tile(svg, value === 'tinted' ? '#000000' : '#1B1D24'), 1024, true));
        images.push({ idiom: 'universal', platform: 'ios', size: '1024x1024', filename, appearances: [{ appearance: 'luminosity', value }] });
      }
    }
    await json(join(folder, 'Contents.json'), { images, info });
  }
  console.log(`Generated Apple C4 AppIcon catalogs and ${names.length} template icons with small optical variants.`);
} finally { await app.close(); }
