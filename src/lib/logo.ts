// A foundation's logo, prepared in the browser the way a profile photo is (`lib/avatar.ts`):
// decoded, positioned and re-encoded here, so the server stores a small fixed-format file
// and never the original (which can carry metadata, and can be any size).
//
// Positioned in a SQUARE frame (`LogoCropper`), as a profile photo is: the logo takes
// the monogram's place in the header, which is square. Unlike an avatar the
// logo starts CONTAINED, the whole of it inside the frame, and may stay smaller than the
// frame in either direction: a square mark beside empty space is a normal logo, where a
// photo with a gap is a broken one. Zooming in trims a file's own empty margins; dragging
// sets where it sits. The empty
// part of the frame is transparent, so it sits on the white of a letter and the grey of
// the header alike.
//
// PNG out, or JPEG for a logo PNG cannot hold small. The logo is emailed at the top of
// every letter, and Outlook shows no WebP; PNG is drawn by every mail client, with
// transparency, and a flat-colour logo compresses well in it. A photographic one does
// not, and is re-encoded as JPEG on white (also drawn everywhere) rather than refused.
//
// SIZE IS A MEASURED LIMIT. The upload is one INSERT, and `getDb()` gives every query
// 4 seconds and never retries a write. From a laptop to the staging branch (2026-10-09)
// a 20KB payload took 2.4s, 150KB 3.5s, and 350KB timed out, which the screen could
// only report as "Something went wrong at our end". So the frame is stored at 2x the
// largest it is drawn rather than 4x, and the payload is capped at `MAX_LOGO_ENCODED_BYTES`.

/** The stored frame: square, 2x the 80px it is drawn at on a letter. */
export const LOGO_WIDTH = 160
export const LOGO_HEIGHT = 160

/** Largest file we will attempt to decode (a memory guard, as for avatars). */
export const MAX_LOGO_SOURCE_BYTES = 10 * 1024 * 1024

/**
 * Ceiling on the base64 payload, with the write's 4s in mind (see above). A flat logo at
 * 160px is a few KB as PNG; a photographic one goes to JPEG well under this.
 */
export const MAX_LOGO_ENCODED_BYTES = 100 * 1024

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number]

/** How far in the user may zoom, as a multiple of "the whole logo just fits". */
export const LOGO_MAX_ZOOM = 4

/** Long edge of the working copy. Sharp at full zoom on the stored frame, cheap to hold. */
const WORK_PX = 1600

export type PreparedLogo = {
  mimeType: LogoMimeType
  dataBase64: string
  width: number
  height: number
}

export class LogoError extends Error {}

/** A decoded working copy plus a URL for previewing it. */
export type LogoSource = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  previewUrl: string
  /** Frees the preview object URL. Call when the editor closes. */
  release: () => void
}

/** Where the logo sits in the frame, in CSS pixels of the editor. */
export type LogoCrop = {
  frameWidth: number
  frameHeight: number
  displayWidth: number
  displayHeight: number
  /** The logo's top-left relative to the frame's top-left. */
  offsetX: number
  offsetY: number
}

/** The scale at which the whole of a `w x h` image just fits a `fw x fh` frame. */
export function containScale(w: number, h: number, fw: number, fh: number): number {
  return Math.min(fw / w, fh / h)
}

/**
 * Where a logo may sit along one axis. Smaller than the frame, it stays wholly inside
 * (no part of a logo is lost by moving it); larger, it must cover the frame (there is no
 * reason to zoom in only to push the logo out of view).
 */
export function clampAxis(offset: number, displayed: number, frame: number): number {
  const lo = Math.min(0, frame - displayed)
  const hi = Math.max(0, frame - displayed)
  return Math.min(hi, Math.max(lo, offset))
}

/**
 * Decode a picked file into a working copy the editor can move about.
 *
 * Through an `<img>` rather than `createImageBitmap`, because that is what draws an SVG,
 * and vector logos are common. A vector is drawn at the working size, so it stays sharp
 * at any zoom; an SVG with no intrinsic size reports 0x0 and is given a square one.
 */
export async function loadLogoSource(file: File): Promise<LogoSource> {
  if (file.size > MAX_LOGO_SOURCE_BYTES) {
    throw new LogoError('That file is too large. Please choose one under 10MB.')
  }
  const url = URL.createObjectURL(file)
  let img: HTMLImageElement
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode'))
      el.src = url
    })
  } catch {
    URL.revokeObjectURL(url)
    throw new LogoError("That image format isn't supported. Try a PNG, JPEG or SVG.")
  }

  const vector = file.type === 'image/svg+xml'
  const natural = {
    width: img.naturalWidth || LOGO_WIDTH,
    height: img.naturalHeight || LOGO_HEIGHT,
  }
  const long = Math.max(natural.width, natural.height)
  const scale = vector ? WORK_PX / long : Math.min(1, WORK_PX / long)
  const width = Math.max(1, Math.round(natural.width * scale))
  const height = Math.max(1, Math.round(natural.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    URL.revokeObjectURL(url)
    throw new LogoError('Could not process that image.')
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)

  return { canvas, width, height, previewUrl: url, release: () => URL.revokeObjectURL(url) }
}

/** Render the frame as positioned to the stored PNG: the logo where it was put, the rest clear. */
export async function cropLogo(source: LogoSource, crop: LogoCrop): Promise<PreparedLogo> {
  // Editor pixels → stored pixels.
  const ratio = LOGO_WIDTH / crop.frameWidth
  const canvas = document.createElement('canvas')
  canvas.width = LOGO_WIDTH
  canvas.height = LOGO_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new LogoError('Could not process that image.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source.canvas,
    crop.offsetX * ratio,
    crop.offsetY * ratio,
    crop.displayWidth * ratio,
    crop.displayHeight * ratio,
  )

  const png = await encode(canvas, 'image/png')
  if (png.length <= MAX_LOGO_ENCODED_BYTES) {
    return { mimeType: 'image/png', dataBase64: png, width: LOGO_WIDTH, height: LOGO_HEIGHT }
  }

  // Too detailed for PNG at this size: a photograph, or a logo with gradients. JPEG has
  // no transparency, so the clear part of the frame is filled white, the letter's colour.
  const flat = document.createElement('canvas')
  flat.width = LOGO_WIDTH
  flat.height = LOGO_HEIGHT
  const fctx = flat.getContext('2d')
  if (!fctx) throw new LogoError('Could not process that image.')
  fctx.fillStyle = '#ffffff'
  fctx.fillRect(0, 0, LOGO_WIDTH, LOGO_HEIGHT)
  fctx.drawImage(canvas, 0, 0)
  const jpeg = await encode(flat, 'image/jpeg', 0.85)
  if (jpeg.length > MAX_LOGO_ENCODED_BYTES) {
    throw new LogoError('That logo is too detailed to store. Please choose a simpler file.')
  }
  return { mimeType: 'image/jpeg', dataBase64: jpeg, width: LOGO_WIDTH, height: LOGO_HEIGHT }
}

async function encode(canvas: HTMLCanvasElement, type: LogoMimeType, quality?: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  if (!blob || blob.type !== type) throw new LogoError('Could not process that image.')
  return toBase64(blob)
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192))
  }
  return btoa(binary)
}
