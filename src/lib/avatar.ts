// Client-side avatar preparation. The browser does the resize so the uploaded payload
// is a fixed ~10–20KB regardless of what the user picked — a 12MP phone photo and a
// 200px avatar both come out at AVATAR_PX square.
//
// Re-encoding is not just about size: it strips EXIF, which on phone photos carries GPS
// coordinates. Storing a user's original file would put their home location in the DB.

/** Stored avatar edge length. Covers the largest display use (~96px) at 2× DPR. */
export const AVATAR_PX = 256

/**
 * Largest file we will even attempt to decode. Not a transport limit — decoding a
 * 50-megapixel image into a canvas can exhaust memory on a phone, so this fails fast
 * with a clear message instead of crashing the tab.
 */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

/**
 * Ceiling on the encoded payload the server will accept. ~10× the expected size, so it
 * never fires for a real upload from our own form; it exists to bound a request that
 * skips the form entirely.
 */
export const MAX_ENCODED_BYTES = 256 * 1024

export const ALLOWED_AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const

export type AvatarMimeType = (typeof ALLOWED_AVATAR_TYPES)[number]
export type PreparedAvatar = { mimeType: AvatarMimeType; dataBase64: string }

export class AvatarError extends Error {}

/**
 * Decode → square-crop → resize → re-encode a user-picked file.
 *
 * Encodes to WebP where the browser supports it (~30% smaller than JPEG at equivalent
 * quality), falling back to JPEG otherwise. The fallback is not optional: `toBlob` with
 * an unsupported type does not throw — older Safari silently hands back a PNG, which at
 * this size is several times larger than either. So we check what we actually got.
 */
export async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarError('That image is too large — please choose one under 10MB.')
  }

  let bitmap: ImageBitmap
  try {
    // `from-image` applies the EXIF rotation; without it portrait phone photos land
    // sideways, because canvas does not honour orientation on its own.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Desktop Chrome cannot decode HEIC. (iOS Safari converts to JPEG in the file
    // picker, so uploads straight from a phone are fine — this is the "copied the
    // photos off my iPhone onto a laptop" case.)
    throw new AvatarError("That image format isn't supported — try a JPEG or PNG.")
  }

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PX
  canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AvatarError('Could not process that image.')

  // Centre-crop the largest square the source allows, then scale it to fit.
  const edge = Math.min(bitmap.width, bitmap.height)
  ctx.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    AVATAR_PX,
    AVATAR_PX,
  )
  bitmap.close()

  let blob = await encode(canvas, 'image/webp')
  if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg')
  if (!blob || !isAllowedType(blob.type)) throw new AvatarError('Could not process that image.')

  const dataBase64 = await toBase64(blob)
  if (dataBase64.length > MAX_ENCODED_BYTES) {
    throw new AvatarError('That image is too large — please choose a simpler one.')
  }
  return { mimeType: blob.type, dataBase64 }
}

export function isAllowedType(type: string): type is AvatarMimeType {
  return (ALLOWED_AVATAR_TYPES as readonly string[]).includes(type)
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.8))
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // Chunked to keep the argument list within the engine's apply() limit on large inputs.
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192))
  }
  return btoa(binary)
}
