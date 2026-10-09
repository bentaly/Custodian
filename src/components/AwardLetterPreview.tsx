import { useRouteContext } from '@tanstack/react-router'

/**
 * A rendered award letter, shown as a letter rather than as an email.
 *
 * Takes the plain-text body (the stored source of truth) and lays it out for reading —
 * deliberately NOT `dangerouslySetInnerHTML` of the stored HTML. The body originates in
 * a template a foundation admin can edit, and the letter is also read by people who did
 * not write it; rendering it as text means a template can never inject markup into the
 * app the way it could into a mail client.
 *
 * The foundation's logo heads it, as it heads the emailed letter (`lib/letterHtml`).
 * Taken from the signed-in foundation rather than the letter, so a preview shows the
 * logo as it is now; a stored letter's own HTML carries the one it was sent with.
 */
export function AwardLetterPreview({
  bodyText,
  className = '',
}: {
  bodyText: string
  className?: string
}) {
  const { user } = useRouteContext({ from: '/_authenticated' })
  const blocks = bodyText.split(/\n{2,}/)
  return (
    <div className={`text-label leading-relaxed text-grey-700 ${className}`}>
      {user.clientLogo && (
        // 240x80 at most, the size the emailed letter draws it.
        <img
          src={user.clientLogo}
          alt={user.clientName ?? ''}
          className="mb-4 h-auto max-h-20 w-auto max-w-60 object-contain"
        />
      )}
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        const numbered = lines.length > 1 && lines.every((l) => /^\d+\.\s/.test(l.trim()))
        if (numbered) {
          return (
            <ol key={i} className="mb-3 list-decimal space-y-1.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.trim().replace(/^\d+\.\s*/, '')}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i} className="mb-3 last:mb-0">
            {lines.map((l, j) => (
              <span key={j}>
                {l.trim()}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
