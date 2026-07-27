// Client-side avatar preparation. The browser does the decode, crop and resize so the
// uploaded payload is a fixed ~10–20KB regardless of what the user picked — a 12MP phone
// photo and a 200px avatar both come out at AVATAR_PX square.
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

/**
 * Long edge of the working copy the cropper pans around. Big enough that the output is
 * still sharp at maximum zoom (which samples roughly a third of the shorter edge), small
 * enough that holding it in a canvas costs little.
 */
const WORK_PX = 1600

/** How far in the user may zoom, as a multiple of the "just covers the viewport" scale. */
export const MAX_ZOOM = 3

export const ALLOWED_AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const

export type AvatarMimeType = (typeof ALLOWED_AVATAR_TYPES)[number]
export type PreparedAvatar = { mimeType: AvatarMimeType; dataBase64: string }

export class AvatarError extends Error {}

/** A decoded, orientation-corrected working copy plus a URL for previewing it. */
export type AvatarSource = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  previewUrl: string
  /** Frees the preview object URL. Call when the editor closes. */
  release: () => void
}

/** Where the viewport sits over the source image, in CSS pixels of the preview. */
export type AvatarCrop = {
  /** Edge length of the square viewport the user is dragging within. */
  viewport: number
  /** Displayed width/height of the image at the current zoom. */
  displayWidth: number
  displayHeight: number
  /** Image top-left relative to the viewport top-left. Both ≤ 0. */
  offsetX: number
  offsetY: number
}

/**
 * Decode a user-picked file into a working copy the cropper can pan around.
 *
 * The decode is where unsupported formats and oversized files surface, so this is the
 * step that owns those error messages.
 */
export async function loadAvatarSource(file: File): Promise<AvatarSource> {
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

  const shrink = Math.min(1, WORK_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * shrink)
  const height = Math.round(bitmap.height * shrink)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AvatarError('Could not process that image.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await encode(canvas, 'image/webp')
  const previewUrl = URL.createObjectURL(blob ?? new Blob())
  return { canvas, width, height, previewUrl, release: () => URL.revokeObjectURL(previewUrl) }
}

/**
 * Render the region currently under the viewport to an AVATAR_PX square.
 *
 * Encodes to WebP where the browser supports it (~30% smaller than JPEG at equivalent
 * quality), falling back to JPEG otherwise. The fallback is not optional: `toBlob` with
 * an unsupported type does not throw — older Safari silently hands back a PNG, which at
 * this size is several times larger than either. So we check what we actually got.
 */
export async function cropAvatar(source: AvatarSource, crop: AvatarCrop): Promise<PreparedAvatar> {
  // Preview CSS pixels → working-canvas pixels.
  const ratio = source.width / crop.displayWidth
  const sx = -crop.offsetX * ratio
  const sy = -crop.offsetY * ratio
  const size = crop.viewport * ratio

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PX
  canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AvatarError('Could not process that image.')
  ctx.drawImage(source.canvas, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX)

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
