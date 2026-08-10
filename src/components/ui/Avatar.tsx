// Person avatar — the uploaded/OAuth photo when there is one, otherwise the moss
// initials chip. A broken image URL (an expired Google CDN link, say) falls back to
// the initials too, so the header never renders an empty box.
import { useState } from 'react'

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
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
