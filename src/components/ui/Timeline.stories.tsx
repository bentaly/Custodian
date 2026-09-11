import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Timeline, type TimelineStep } from './Timeline'
import { C } from './tokens'

// The report screen's Reporting and Finance cards, at the side column's own width —
// the width is what the overflow cases below are about.

const meta = {
  title: 'Data display/Timeline',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Card({
  title,
  meta: right,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <div
      className="flex w-[340px] flex-col gap-4 rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
          {title}
        </h2>
        {right && (
          <span className="font-display text-body" style={{ color: C.sub }}>
            {right}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

const MONTHS = ['Jan', 'Apr', 'Jul', 'Oct']

/** Twelve quarterly payments, five paid, one overdue. */
const QUARTERLY: TimelineStep[] = Array.from({ length: 12 }, (_, i) => {
  const date = `2 ${MONTHS[i % 4]} ${2025 + Math.floor(i / 4)}`
  const paid = i < 5
  return {
    key: String(i),
    title: `Instalment ${i + 1} of 12`,
    sub: paid ? `Paid ${date} · £3,750` : `Due ${date} · £3,750${i === 5 ? ' · overdue' : ''}`,
    urgent: i === 5,
    marker: paid ? 'done' : i === 5 ? 'current' : 'future',
  }
})

export const Short: Story = {
  render: () => (
    <Card title="Reporting" meta="1 of 2 received">
      <Timeline
        anchor={2}
        steps={[
          { key: 'a', title: 'Grant awarded', sub: '2 Jul 2026 · £38,000', marker: 'done' },
          {
            key: 'b',
            title: 'Interim report — you are here',
            sub: 'Received 21 Jul 2026 · 391 households',
            marker: 'done',
          },
          { key: 'c', title: 'Final report', sub: 'Due 14 Nov 2026', marker: 'current' },
        ]}
      />
    </Card>
  ),
}

/** Twelve steps fold to five, centred on the one the grant is waiting on. */
export const LongScheduleFolds: Story = {
  render: () => (
    <Card title="Finance" meta="5 of 12 paid">
      <Timeline steps={QUARTERLY} anchor={5} />
    </Card>
  ),
}

/** Titles and lines longer than the column wrap rather than run off the card. */
export const LongText: Story = {
  render: () => (
    <Card title="Reporting" meta="0 of 1 received">
      <Timeline
        steps={[
          {
            key: 'a',
            title: 'Grant awarded',
            sub: '2 Jul 2026 · £1,250,000',
            marker: 'done',
          },
          {
            key: 'b',
            title:
              'Year two narrative and financial report to the board of trustees — you are here',
            sub: 'Received 21 Jul 2026 · 12,480 hectares of upland peat restored to active bog',
            marker: 'done',
          },
          {
            key: 'c',
            title: 'Final report',
            sub: 'Due 14 Nov 2025 · overdue',
            urgent: true,
            marker: 'current',
          },
        ]}
      />
    </Card>
  ),
}
