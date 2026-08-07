import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { FilterPill } from './FilterPill'
import { SelectPill } from './SelectPill'
import { DateRangePicker, type DateRange } from './DateRangePicker'
import { SearchInput } from './SearchInput'
import { APPLICATION_STATUS_OPTIONS } from '../../lib/validators/application'

// The filter row, which is where "everything should look the same" is most visible: on
// a list screen these four sit side by side, and any one of them wearing a different
// text colour or caret is immediately obvious.

const meta = {
  title: 'Controls/Filters',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// The app's real status registry — a story showing invented labels would be the very
// drift these components exist to prevent.
const STATUSES = APPLICATION_STATUS_OPTIONS

const ROUNDS = [
  { value: 'r1', label: 'Spring 2026' },
  { value: 'r2', label: 'Autumn 2026' },
]

/** The row as a list screen renders it: round pill, filters, date, search. */
export const FilterRow: Story = {
  render: function Render() {
    const [round, setRound] = useState<string | undefined>('r1')
    const [status, setStatus] = useState<string | undefined>()
    const [theme, setTheme] = useState<string | undefined>('Youth')
    const [range, setRange] = useState<DateRange>({})
    const [q, setQ] = useState<string | undefined>()
    return (
      <div className="flex w-[900px] flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <SelectPill
            ariaLabel="Select round"
            icon={Calendar03Icon}
            options={ROUNDS}
            value={round}
            suffix="Current round"
            clearLabel="All rounds"
            onChange={setRound}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Search organisation or ID…" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <FilterPill
            label="Theme"
            value={theme}
            options={[
              { value: 'Youth', label: 'Youth' },
              { value: 'Housing', label: 'Housing' },
            ]}
            onChange={setTheme}
          />
          <DateRangePicker value={range} onChange={setRange} allLabel="Any date" />
        </div>
      </div>
    )
  },
}

/**
 * Idle vs chosen. The text, icon and caret stay Gray/900 in both — what changes is the
 * surface, so a row of pills reads "which filters are on" at a glance.
 */
export const IdleAndChosen: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="w-16 font-display text-[12px] text-[#97A1AF]">idle</span>
        <FilterPill label="Status" value={undefined} options={STATUSES} onChange={() => {}} />
        <DateRangePicker value={{}} onChange={() => {}} allLabel="Any date" />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-16 font-display text-[12px] text-[#97A1AF]">chosen</span>
        <FilterPill label="Status" value="shortlisted" options={STATUSES} onChange={() => {}} />
        <DateRangePicker
          value={{ from: '2026-08-17', to: '2026-08-18' }}
          onChange={() => {}}
          allLabel="Any date"
        />
      </div>
    </div>
  ),
}

/** `SelectPill`'s two jobs: the 40px screen-level selector and the 32px in-card one. */
export const SelectPillSizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <SelectPill
        ariaLabel="Select round"
        icon={Calendar03Icon}
        options={ROUNDS}
        value="r1"
        suffix="Current round"
        onChange={() => {}}
      />
      <SelectPill
        size="sm"
        ariaLabel="Programme"
        label="Programme"
        options={[{ value: 'p1', label: 'Youth work (24)' }]}
        value="p1"
        onChange={() => {}}
      />
    </div>
  ),
}
