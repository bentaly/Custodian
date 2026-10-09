// A foundation's logo, prepared in the browser the way a profile photo is (`lib/avatar.ts`):
// decoded, resized and re-encoded here, so the server stores a small fixed-format file
// and never the original (which can carry metadata, and can be any size).
//
// Unlike an avatar it is not cropped. A logo is a wordmark as often as a square, so it
// is fitted INSIDE a box at its own proportions, and its transparency is kept: it sits
// on the white of a letter and the grey of the header alike.
//
// Always PNG out. The logo is emailed at the top of every letter, and Outlook shows no
// WebP; PNG is the one format every mail client draws, with transparency, and a logo is
// flat colour, which PNG compresses well.

/** The box a logo is fitted inside: 2x the largest it is drawn (a letter's 240x80). */
export const LOGO_MAX_WIDTH = 480
export const LOGO_MAX_HEIGHT = 160

/** Largest file we will attempt to decode (a memory guard, as for avatars). */
export const MAX_LOGO_SOURCE_BYTES = 10 * 1024 * 1024

/** Ceiling on the encoded payload the server accepts. A real logo at this size is far under. */
export const MAX_LOGO_ENCODED_BYTES = 512 * 1024

export const LOGO_MIME_TYPE = 'image/png'

export type PreparedLogo = { dataBase64: string; width: number; height: number }

export class LogoError extends Error {}

/** The size a `width x height` image is drawn at to fit the logo box, never enlarged. */
export function fitLogo(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Decode a picked file and re-encode it as the stored PNG.
 *
 * Decoded through an `<img>` rather than `createImageBitmap`, because that is what
 * draws an SVG, and vector logos are common. An SVG with no intrinsic size reports 0x0,
 * so it is drawn at the box's height instead.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (file.size > MAX_LOGO_SOURCE_BYTES) {
    throw new LogoError('That file is too large. Please choose one under 10MB.')
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode'))
      el.src = url
    }).catch(() => {
      throw new LogoError("That image format isn't supported. Try a PNG, JPEG or SVG.")
    })

    const natural = {
      width: img.naturalWidth || LOGO_MAX_HEIGHT,
      height: img.naturalHeight || LOGO_MAX_HEIGHT,
    }
    const { width, height } = fitLogo(natural.width, natural.height)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new LogoError('Could not process that image.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, LOGO_MIME_TYPE))
    if (!blob) throw new LogoError('Could not process that image.')
    const dataBase64 = await toBase64(blob)
    if (dataBase64.length > MAX_LOGO_ENCODED_BYTES) {
      throw new LogoError('That logo is too detailed to store. Please choose a simpler file.')
    }
    return { dataBase64, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192))
  }
  return btoa(binary)
}
