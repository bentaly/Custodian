import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input, Textarea, Select, Label } from './fields'
import { Button } from './Button'
import { Card } from './Card'
import { ConfirmDialog } from './ConfirmDialog'

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
        <Select
          value="people"
          onChange={() => {}}
          options={[
            { value: 'people', label: 'People supported' },
            { value: 'hectares', label: 'Hectares restored' },
            { value: 'other', label: 'Something else…' },
          ]}
        />
      </div>
      <div>
        <Label>Disabled</Label>
        <Input disabled value="Locked while saving" readOnly />
      </div>
    </div>
  ),
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
