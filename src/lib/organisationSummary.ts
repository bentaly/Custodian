/**
 * How much of an organisation's description the name's tooltip shows. A tooltip is a
 * glance, not a reading: the whole answer is on the application.
 */
export const SUMMARY_PREVIEW_CHARS = 300

/**
 * The description as the tooltip prints it: whitespace collapsed (form answers arrive
 * with their paragraph breaks), and anything past the preview cut at a word with an
 * ellipsis, so it never stops mid-word or pretends to be the whole answer.
 */
export function summaryPreview(text: string | null | undefined): string | null {
  const flat = text?.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  if (flat.length <= SUMMARY_PREVIEW_CHARS) return flat
  const cut = flat.slice(0, SUMMARY_PREVIEW_CHARS)
  const atWord = cut.lastIndexOf(' ')
  return `${(atWord > SUMMARY_PREVIEW_CHARS * 0.7 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.]+$/, '')}…`
}
