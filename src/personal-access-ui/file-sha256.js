/** Incremental browser SHA-256 over a File/Blob without materializing the whole file. */
import { sha256 } from './vendor/noble-hashes-2.3.0/sha2.js'

const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
const frame = () => new Promise((resolve) => typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0))

export async function hashBlobSha256(blob, { signal, onProgress } = {}) {
  if (!(blob instanceof Blob) || typeof blob.stream !== 'function') throw new TypeError('FILE_UNAVAILABLE')
  const reader = blob.stream().getReader()
  const hash = sha256.create()
  let total = 0
  let yieldedAt = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new TypeError('FILE_UNAVAILABLE')
      hash.update(value)
      total += value.byteLength
      onProgress?.(total, blob.size)
      if (total - yieldedAt >= 4 * 1024 * 1024) {
        yieldedAt = total
        await frame()
      }
    }
    if (total !== blob.size) throw new TypeError('FILE_CHANGED')
    return hex(hash.digest())
  } finally {
    try { await reader.cancel() } catch { /* Reader may already be closed. */ }
    hash.destroy?.()
  }
}
