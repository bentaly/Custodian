import { useEffect } from 'react'
import type { getApplication } from '../server/fns/applications'

type Application = Awaited<ReturnType<typeof getApplication>>

export function ApplicationDrawer({
  application,
  open,
  onClose,
}: {
  application: Application
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const responses = application.responses ?? []

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Application form responses"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Application form</h2>
            <p className="mt-0.5 text-sm text-gray-500">{application.organisationName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {responses.length === 0 ? (
            <p className="text-sm text-gray-500">No form responses recorded.</p>
          ) : (
            <dl className="space-y-6">
              {responses.map((r, i) => (
                <div key={i}>
                  <dt className="text-sm font-medium text-gray-700">{r.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
                    {r.value || '—'}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </>
  )
}
