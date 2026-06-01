// Generates simple placeholder PNG icons (no external deps) so the tray and
// packaged app have an icon. Replace resources/icon.png with real art anytime.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// Is the point part of the letter "R", in glyph-local unit coords (u right, v down)?
function inLetterR(u, v) {
  // Vertical stem.
  if (u >= 0.04 && u <= 0.30 && v >= 0.0 && v <= 1.0) return true
  // Upper bowl (annulus, clipped to the top half).
  const cu = 0.40
  const cv = 0.27
  const outer = ((u - cu) / 0.42) ** 2 + ((v - cv) / 0.27) ** 2
  const inner = ((u - cu) / 0.20) ** 2 + ((v - cv) / 0.115) ** 2
  if (v <= 0.56 && outer <= 1 && inner >= 1 && u >= 0.1) return true
  // Diagonal leg from the bowl down to the bottom-right.
  if (u >= 0.28 && u <= 1.0 && v >= 0.5 && v <= 1.0) {
    const t = (u - 0.28) / 0.72
    const lineV = 0.5 + t * 0.5
    if (Math.abs(v - lineV) <= 0.13) return true
  }
  return false
}

function makePng(size) {
  // Glyph bounding box within the icon.
  const gx0 = 0.32 * size
  const gx1 = 0.7 * size
  const gy0 = 0.24 * size
  const gy1 = 0.76 * size

  const px = (x, y) => {
    // Rounded square indigo badge with a soft diagonal highlight.
    const r = size * 0.22
    const inside = x >= r || y >= r ? true : (x - r) ** 2 + (y - r) ** 2 <= r * r
    const insideTR = x <= size - r || y >= r ? true : (x - (size - r)) ** 2 + (y - r) ** 2 <= r * r
    const insideBL = x >= r || y <= size - r ? true : (x - r) ** 2 + (y - (size - r)) ** 2 <= r * r
    const insideBR =
      x <= size - r || y <= size - r
        ? true
        : (x - (size - r)) ** 2 + (y - (size - r)) ** 2 <= r * r
    if (!(inside && insideTR && insideBL && insideBR)) return [0, 0, 0, 0]

    // Draw the white "R" glyph on top of the gradient.
    if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) {
      const u = (x - gx0) / (gx1 - gx0)
      const v = (y - gy0) / (gy1 - gy0)
      if (inLetterR(u, v)) return [245, 246, 255, 255]
    }

    const t = (x + y) / (2 * size)
    const rC = Math.round(99 + 60 * t)
    const gC = Math.round(102 + 40 * t)
    const bC = Math.round(241 - 20 * t)
    return [rC, gC, bC, 255]
  }

  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const targets = [
  { path: resolve(root, 'resources/icon.png'), size: 256 },
  { path: resolve(root, 'resources/tray.png'), size: 32 },
  { path: resolve(root, 'build/icon.png'), size: 512 }
]

for (const { path, size } of targets) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, makePng(size))
  console.log(`wrote ${path} (${size}x${size})`)
}
