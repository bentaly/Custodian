import type { Meta, StoryObj } from '@storybook/react-vite'
import { Download01Icon, PlusSignIcon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from './Button'
import { ExternalTextLink } from './TextLink'

const meta = {
  title: 'Controls/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'tinted', 'danger', 'dangerGhost', 'ghost', 'link'],
    },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md'] },
  },
  args: { children: 'Award grant', variant: 'primary', size: 'md' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Every variant at the default 40px size. Variants say what a button *is*. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Award grant</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="tinted">Export CSV</Button>
      <Button variant="danger">Delete round</Button>
      <Button variant="dangerGhost">Remove</Button>
      <Button variant="ghost">Dismiss</Button>
      <Button variant="text">Check the submission →</Button>
    </div>
  ),
}

/** 40px is screen-level, 32px sits inside a card, 28px inside a table row. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['md', 'sm', 'xs'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          <span className="w-8 font-display text-[12px] text-[#97A1AF]">{size}</span>
          <Button size={size} variant="primary">
            Award grant
          </Button>
          <Button size={size} variant="secondary">
            Cancel
          </Button>
          <Button size={size} variant="tinted">
            Export CSV
          </Button>
        </div>
      ))}
    </div>
  ),
}

/** An icon leads by default; `iconPosition="right"` is for outbound motion (export, next). */
export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button icon={PlusSignIcon}>Add programme</Button>
      <Button variant="tinted" icon={Download01Icon} iconPosition="right">
        Export CSV
      </Button>
      <Button variant="secondary" icon={Cancel01Icon} aria-label="Close" />
      <Button variant="ghost" size="sm" icon={Cancel01Icon} aria-label="Close" />
    </div>
  ),
}

/**
 * `text` vs `TextLink`: the same thing to look at, chosen by behaviour. If it navigates
 * it must be the anchor — announced as a link, middle-clickable, copyable. If it acts on
 * the page it stays a button, however link-like it looks.
 */
export const TextButtonVsLink: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button variant="text" onClick={() => {}}>
        Check the submission → <span className="text-[#97A1AF]">(opens a drawer — button)</span>
      </Button>
      {/* `TextLink` is the in-app version and needs a router, so the story shows its
          external twin — same styling, same element. */}
      <ExternalTextLink href="#">
        Award record → <span className="text-[#97A1AF]">(goes somewhere — anchor)</span>
      </ExternalTextLink>
    </div>
  ),
}

/**
 * Disabled is the whole busy story: an async action must disable while it runs, and
 * say so in its label, so a slow save can't be double-submitted.
 */
export const Busy: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Saving…</Button>
      <Button variant="secondary" disabled>
        Cancel
      </Button>
      <Button variant="danger" disabled>
        Deleting…
      </Button>
    </div>
  ),
}
