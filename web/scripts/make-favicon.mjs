#!/usr/bin/env node
/**
 * Regenerate the desktop app's favicon from the brand mark.
 *
 *   node scripts/make-favicon.mjs
 *
 * Source: ../images/LISTD X Logo.png (400×400). Outputs into src/app/ where
 * Next.js App Router auto-serves them as the site favicon:
 *   - favicon.ico  — multi-resolution (16/32/48/256), PNG-encoded entries
 *   - icon.png     — high-res copy for browsers that prefer a PNG <link>
 *
 * Uses `sharp` (already present transitively via Next) for the resizes and a
 * tiny hand-rolled ICO encoder (the ICO container holds one PNG per size).
 * Re-run this whenever the logo changes.
 */
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '..', '..', 'images', 'LISTD X Logo.png')
const APP = resolve(__dirname, '..', 'src', 'app')

const ICO_SIZES = [16, 32, 48, 256]

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

// Render each ICO entry as a square PNG (contain → never crops the mark).
// `ensureAlpha` + `palette:false` force 32-bit RGBA — Next.js's ICO metadata
// decoder rejects RGB/palette PNGs ("The PNG is not in RGBA format").
const pngs = await Promise.all(
  ICO_SIZES.map((s) =>
    sharp(SRC)
      .resize(s, s, { fit: 'contain', background: transparent })
      .ensureAlpha()
      .png({ palette: false, compressionLevel: 9 })
      .toBuffer()
  )
)

// ── ICO container ───────────────────────────────────────────────────
// Header (6 bytes): reserved=0, type=1 (icon), image count.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(pngs.length, 4)

const entries = []
let offset = 6 + 16 * pngs.length
pngs.forEach((png, i) => {
  const size = ICO_SIZES[i]
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0) // width  (0 ⇒ 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1) // height (0 ⇒ 256)
  e.writeUInt8(0, 2) // palette colours
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // colour planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(png.length, 8) // image byte length
  e.writeUInt32LE(offset, 12) // image byte offset
  offset += png.length
  entries.push(e)
})

await writeFile(resolve(APP, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]))

// icon.png — copy the native 400×400 source verbatim (crisp, no upscale).
await writeFile(resolve(APP, 'icon.png'), await readFile(SRC))

console.log(`favicon.ico (${ICO_SIZES.join('/')}) + icon.png written to ${APP}`)
