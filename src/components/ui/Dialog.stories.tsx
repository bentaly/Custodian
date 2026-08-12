import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { DateField } from './DateField'
import { Tooltip } from './Tooltip'
import { Input, Label } from './fields'

const meta = {
  title: 'Overlays/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** The shell as the round dialog uses it: title, one explanatory line, close button,
 *  a scrolling body and a pinned footer. */
export const Playground: Story = {
  args: { open: true, title: '', onClose: () => {}, children: null },
  render: function Playground() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        <Dialog
          open={open}
          title="New Funding Round"
          description="Define the funding period, budget, and programmes for this round."
          onClose={() => setOpen(false)}
          size="lg"
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Create round</Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="story-name">Round name</Label>
              <Input id="story-name" placeholder="Enter round name" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="story-opens">Opens</Label>
                <DateField id="story-opens" value="2026-02-01" onChange={() => {}} />
              </div>
              <div className="flex-1">
                <Label htmlFor="story-closes">Closes</Label>
                <DateField id="story-closes" value="2026-03-31" onChange={() => {}} />
              </div>
            </div>
            <span className="flex items-center gap-1 font-display text-label font-medium text-gray-500">
              Max per award
              <Tooltip label="About max per award">
                The most any one applicant can be awarded from this programme's budget. Leave blank
                for no ceiling.
              </Tooltip>
            </span>
          </div>
        </Dialog>
      </>
    )
  },
}

/**
 * `busy` is the state that matters: mid-save, Escape and the backdrop must do nothing
 * and the close button must be dead, or a half-finished write loses the panel that is
 * about to report whether it worked. Try Escape — it should not close.
 */
export const Busy: Story = {
  args: { open: true, title: '', onClose: () => {}, children: null },
  render: () => (
    <Dialog
      open
      title="Saving…"
      description="Escape and the backdrop are inert until this finishes."
      onClose={() => alert('This should never fire while busy')}
      busy
      footer={
        <div className="flex justify-end">
          <Button disabled>Saving…</Button>
        </div>
      }
    >
      <p className="font-display text-body text-gray-500">Writing the round…</p>
    </Dialog>
  ),
}

/** A body taller than the viewport scrolls on its own; the title and the footer stay put. */
export const LongBody: Story = {
  args: { open: true, title: '', onClose: () => {}, children: null },
  render: () => (
    <Dialog
      open
      title="Programmes this round funds"
      onClose={() => {}}
      size="lg"
      footer={
        <div className="flex justify-end">
          <Button>Save changes</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {Array.from({ length: 20 }, (_, i) => (
          <Input key={i} defaultValue={`Programme ${i + 1}`} />
        ))}
      </div>
    </Dialog>
  ),
}
