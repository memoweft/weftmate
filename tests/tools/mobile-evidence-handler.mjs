/** Synthetic fixture only: save three explicitly named PNG/JPEG screenshots from a normal browser form. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SLOTS = new Set(['web-desktop', 'web-390', 'mobile-390'])
const MAX_FORM_BYTES = 8 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const htmlHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'",
}

function reply(response, status, message) {
  const safe = String(message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  response.writeHead(status, htmlHeaders)
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成截图证据</title><body><p>${safe}</p><a href="/__fixture/evidence">返回表单</a></body></html>`)
}

async function readForm(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new Error('form_content_type_required')
  }
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_FORM_BYTES) throw new Error('form_too_large')
    chunks.push(chunk)
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  if ([...fields.keys()].length !== 2 || fields.getAll('slot').length !== 1 || fields.getAll('pngBase64').length !== 1) {
    throw new Error('invalid_form_fields')
  }
  const slot = fields.get('slot')
  const encoded = fields.get('pngBase64')
  if (!SLOTS.has(slot) || typeof encoded !== 'string' || encoded.length > MAX_FORM_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('invalid_image_base64')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > MAX_FORM_BYTES || bytes.toString('base64') !== encoded) throw new Error('invalid_image_base64')
  const png = bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (!png && !jpeg) throw new Error('invalid_image_signature')
  return { slot, bytes, extension: png ? 'png' : 'jpg' }
}

export async function handleFixtureEvidence(request, response, { root, fixtureHost, fixtureOrigin }) {
  let url
  try { url = new URL(request.url ?? '/', fixtureOrigin) } catch { return false }
  if (url.pathname !== '/__fixture/evidence' || url.search) return false
  if (request.method === 'GET') {
    response.writeHead(200, htmlHeaders)
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成截图证据</title><body>
<h1>合成验收截图</h1><p>仅保存当前隔离夹具的三个固定槽位，支持 PNG/JPEG；不上传到正式服务。</p>
<form method="post" action="/__fixture/evidence">
<label for="slot">截图槽位</label><select id="slot" name="slot" required>
<option value="web-desktop">网页桌面</option><option value="web-390">网页 390</option><option value="mobile-390">手机 390</option>
</select><br><label for="pngBase64">截图 Base64（PNG/JPEG）</label><textarea id="pngBase64" name="pngBase64" rows="8" cols="64" required></textarea><br>
<button type="submit">保存合成截图</button></form></body></html>`)
    return true
  }
  if (request.method !== 'POST') { reply(response, 405, '此地址只接受表单读取或提交。'); return true }
  if (request.headers.host !== fixtureHost || request.headers.origin !== fixtureOrigin) {
    reply(response, 403, '表单来源不匹配，未保存。')
    return true
  }
  try {
    const { slot, bytes, extension } = await readForm(request)
    const evidenceDir = resolve(root, 'evidence')
    const target = resolve(evidenceDir, `${slot}.${extension}`)
    if (target !== join(evidenceDir, `${slot}.${extension}`)) throw new Error('invalid_target')
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(target, bytes)
    reply(response, 200, `已保存合成截图：${target}（${bytes.length} 字节）。`)
  } catch (error) {
    reply(response, error?.message === 'form_too_large' ? 413 : 400, '截图未保存：请确认固定槽位、PNG/JPEG Base64 与文件大小。')
  }
  return true
}
