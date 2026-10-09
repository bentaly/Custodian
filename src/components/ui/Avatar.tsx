// Person avatar — the uploaded/OAuth photo when there is one, otherwise the moss
// initials chip. A broken image URL (an expired Google CDN link, say) falls back to
// the initials too, so the header never renders an empty box.
import { useState } from 'react'

/**
 * Two letters for a monogram. A leading "The" is skipped, so The Montirex Foundation is
 * MF rather than TM: half of all foundations and charities start with it, and their
 * monograms all began with T. Kept when it is the whole name.
 */
export function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean)
  const named = words.length > 1 && words[0]!.toLowerCase() === 'the' ? words.slice(1) : words
  return named
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function Avatar({
  name,
  image,
  size = 32,
  className = '',
}: {
  name: string
  image?: string | null
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (image && !failed) {
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-secondary font-semibold text-brand ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.375) }}
    >
      {initials(name)}
    </span>
  )
}
