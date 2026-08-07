import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input, Textarea, Select, Label } from './fields'
import { Button } from './Button'
import { Card } from './Card'
import { ConfirmDialog } from './ConfirmDialog'
import { GrantTermsFields } from '../GrantTermsFields'

const meta = {
  title: 'Forms/Fields',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Fields: Story = {
  render: () => (
    <div className="max-w-lg space-y-4">
      <div>
        <Label>Round name</Label>
        <Input placeholder="e.g. Spring 2027" />
      </div>
      <div>
        <Label>
          Description <span className="text-gray-400">(optional)</span>
        </Label>
        <Textarea rows={3} placeholder="What this round is for…" />
      </div>
      <div>
        <Label>Impact measured in</Label>
        <Select defaultValue="people">
          <option value="people">People supported</option>
          <option value="hectares">Hectares restored</option>
          <option value="other">Something else…</option>
        </Select>
      </div>
      <div>
        <Label>Disabled</Label>
        <Input disabled value="Locked while saving" readOnly />
      </div>
    </div>
  ),
}

/**
 * The three grant terms, with the hints that say what each number means. Shown here
 * because the wording is the point — this is the only place a foundation is told that
 * "Total budget" is the pot for one programme in one round.
 */
export const GrantTerms: Story = {
  render: function Render() {
    const [budget, setBudget] = useState('500000')
    const [max, setMax] = useState('50000')
    const [years, setYears] = useState('3')
    return (
      <Card className="max-w-3xl p-5">
        <GrantTermsFields
          budget={budget}
          onBudget={setBudget}
          maxGrantAmount={max}
          onMaxGrantAmount={setMax}
          grantDurationYears={years}
          onGrantDurationYears={setYears}
          budgetRequired
        />
      </Card>
    )
  },
}

/** Every destructive action goes through this, and none of them back out while busy. */
export const Confirm: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    return (
      <>
        <Button variant="dangerGhost" onClick={() => setOpen(true)}>
          Delete programme
        </Button>
        <ConfirmDialog
          open={open}
          title="Delete programme"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setBusy(true)
            setTimeout(() => {
              setBusy(false)
              setOpen(false)
            }, 1200)
          }}
          confirmLabel="Delete programme"
          busyLabel="Deleting…"
          busy={busy}
        >
          Delete <span className="font-medium text-gray-700">Youth work</span>? It is in 2 rounds,
          and their budgets go with it. This cannot be undone.
        </ConfirmDialog>
      </>
    )
  },
}
