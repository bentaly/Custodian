import { useState } from 'react'
import { Submitter } from './Submitter'
import { ReviewQueue } from './ReviewQueue'
import { OutOfRound } from './OutOfRound'
import { Mappings } from './Mappings'
import { Clients } from './Clients'

type View = 'review' | 'unrouted' | 'mappings' | 'clients' | 'submit'

const TABS: Array<{ key: View; label: string }> = [
  { key: 'review', label: 'Review queue' },
  { key: 'unrouted', label: 'Out of round' },
  { key: 'mappings', label: 'Mappings' },
  { key: 'clients', label: 'Foundations' },
  { key: 'submit', label: 'Submit test' },
]

export default function App() {
  const [view, setView] = useState<View>('review')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-4">
          <span className="py-4 text-sm font-semibold text-gray-900">Custodian Admin</span>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`border-b-2 px-3 py-4 text-sm font-medium transition-colors ${
                  view === t.key
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="px-4 py-8">
        {view === 'review' && <ReviewQueue />}
        {view === 'unrouted' && <OutOfRound />}
        {view === 'mappings' && <Mappings />}
        {view === 'clients' && <Clients />}
        {view === 'submit' && <Submitter />}
      </main>
    </div>
  )
}
