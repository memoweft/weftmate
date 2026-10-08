import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
test('phone QR decoder reads the actual bundled pairing QR without BarcodeDetector', () => {
  const require = createRequire(import.meta.url);
  const QRCode = require('qrcode'), decode = require('jsqr');
  const value = 'wm1.synthetic-pairing-for-decoder';
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const scale = 5, margin = 4, width = (qr.modules.size + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) if (qr.modules.get(y, x)) {
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const index = (((y + margin) * scale + sy) * width + (x + margin) * scale + sx) * 4;
      rgba[index] = rgba[index + 1] = rgba[index + 2] = 0;
    }
  }
  assert.equal(decode(rgba, width, width)?.data, value);
});
