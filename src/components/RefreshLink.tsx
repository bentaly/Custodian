import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { C } from './ui/tokens'

/**
 * "Refresh", beside a message saying an AI assessment or analysis is running. Nothing
 * tells the page when the model finishes (there is no push, and polling was ruled out
 * for the free tiers), so the person asks: this re-runs the page's loader, which reloads
 * the data in place, not the whole page. Used by the application and report screens.
 */
export function RefreshLink() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="font-display underline disabled:opacity-50"
      style={{ color: C.brand }}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await router.invalidate()
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
