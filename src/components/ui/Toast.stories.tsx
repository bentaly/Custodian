import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toaster, toast } from './Toast'
import { Button } from './Button'

/**
 * The success confirmation in the top right. `toast('…')` from anywhere; `<Toaster />`
 * is mounted once in the authenticated shell, and once here in each story.
 *
 * Three tones: success (Mint), info (Paper) and error (Danger). An error toast is for a
 * failure with no control to sit beside; a form's failure stays an `ErrorNote`.
 */
const meta = {
  title: 'Overlays/Toast',
  component: Toaster,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-[320px] p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

/** One save, as the giving strategy screen does it. */
export const Playground: Story = {
  render: () => (
    <>
      <Button onClick={() => toast('Giving strategy saved')}>Save</Button>
      <Toaster />
    </>
  ),
}

/** All three tones. Success and info leave after 3.5s; an error stays until dismissed. */
export const Tones: Story = {
  render: () => (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast.success('Round budget limit switched on')}>Success</Button>
        <Button variant="secondary" onClick={() => toast.info('This round closes on 31 March')}>
          Info
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.error('The award letter could not be sent. Try again from the grant.')
          }
        >
          Error
        </Button>
      </div>
      <Toaster />
    </>
  ),
}

/** A long message wraps inside the 360px card rather than widening it. */
export const LongMessage: Story = {
  render: () => (
    <>
      <Button
        onClick={() =>
          toast(
            'Invitation sent again to priya.raghavan@wrenfield.org. The earlier link no longer works.',
          )
        }
      >
        Resend invitation
      </Button>
      <Toaster />
    </>
  ),
}

/** Click a few times quickly: three at most, newest on top, each gone after 3.5s. */
export const Stacked: Story = {
  render: function Stacked() {
    const messages = [
      'Douglas Bain is now finance',
      'Invitation for sam@wrenfield.org cancelled',
      'Ngozi Adeyemi now votes on applications',
      'Tom Whitlock has been removed from the team',
    ]
    const i = useRef(0)
    return (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            toast(messages[i.current % messages.length]!)
            i.current += 1
          }}
        >
          Make a change on Team
        </Button>
        <Toaster />
      </>
    )
  },
}
