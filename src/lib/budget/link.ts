// A readable name for a budget document link.
//
// The link comes from an applicant-filled form, usually as a storage URL whose last
// path segment is the original filename ("…/responses/files/<hash>/Project_Budget.ods").
// Showing that beats showing the raw URL, which is long, opaque and reveals nothing.
// Anything we can't read a filename out of falls back to a plain label rather than
// printing a hash at an admin.

/** Longest filename we'll show before it stops being a label and starts being noise. */
const MAX_NAME = 60

export function budgetDocumentName(url: string): string {
  const fallback = 'Budget document'
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return fallback
  }

  const last = path.split('/').filter(Boolean).pop()
  if (!last) return fallback

  let name: string
  try {
    name = decodeURIComponent(last)
  } catch {
    // A malformed escape sequence — use the raw segment rather than failing.
    name = last
  }
  name = name.trim()

  // A segment with no extension is far more likely to be an id than a filename.
  if (!name || !/\.[a-z0-9]{1,8}$/i.test(name)) return fallback
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name
}
