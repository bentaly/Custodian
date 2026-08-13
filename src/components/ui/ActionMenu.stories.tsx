import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArchiveRestoreIcon, Delete02Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { ActionMenu } from './ActionMenu'
import { Badge } from './Badge'
import { Card } from './Card'

const meta = {
  title: 'Controls/ActionMenu',
  component: ActionMenu,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ActionMenu>

export default meta
type Story = StoryObj<typeof meta>

/** Try the keyboard: Down opens onto the first item, Up onto the last, Escape returns
 *  focus to the kebab. Tabbing out dismisses rather than walking into the page behind. */
export const Playground: Story = {
  args: { actions: [] },
  render: () => (
    <div className="w-[420px]">
      <ActionMenu
        label="Actions for Community & Place"
        actions={[
          { label: 'Edit', icon: PencilEdit02Icon, onSelect: () => alert('Edit') },
          {
            label: 'Archive',
            icon: Delete02Icon,
            destructive: true,
            onSelect: () => alert('Archive'),
          },
        ]}
      />
    </div>
  ),
}

/**
 * The programmes-list card, both states. Archived collapses the themes and impact unit —
 * they describe how a programme takes applications, and a retired one takes none — and
 * greys the title, so the row is findable without looking live.
 */
export const OnACard: Story = {
  args: { actions: [] },
  render: function OnACard() {
    const [archived, setArchived] = useState(false)
    return (
      <Card className="flex w-[520px] flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-3 shrink-0 rounded-swatch ${archived ? 'opacity-40' : ''}`}
                style={{ backgroundColor: 'var(--color-accent-sky)' }}
              />
              <h2
                className={`font-display text-title font-semibold ${archived ? 'text-grey-400' : 'text-grey-900'}`}
              >
                Community &amp; Place
              </h2>
              {archived ? (
                <Badge className="bg-grey-100 text-grey-500">Archived</Badge>
              ) : (
                <Badge className="bg-success/10 text-success">In open round</Badge>
              )}
            </div>
            <p className={`font-display text-body ${archived ? 'text-grey-400' : 'text-grey-600'}`}>
              Place-based community development and social cohesion across West Yorkshire.
            </p>
          </div>
          <ActionMenu
            label="Actions for Community & Place"
            actions={[
              { label: 'Edit', icon: PencilEdit02Icon, onSelect: () => {} },
              archived
                ? {
                    label: 'Restore',
                    icon: ArchiveRestoreIcon,
                    onSelect: () => setArchived(false),
                  }
                : {
                    label: 'Archive',
                    icon: Delete02Icon,
                    destructive: true,
                    onSelect: () => setArchived(true),
                  },
            ]}
          />
        </div>
        {!archived && (
          <div className="flex gap-16">
            <div className="flex flex-col gap-2">
              <span className="font-display text-label font-medium text-grey-500">
                Impact measured in
              </span>
              <span className="font-display text-body font-medium text-grey-700">People</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-display text-label font-medium text-grey-500">Themes</span>
              <span className="font-display text-body font-medium text-grey-700">
                Social cohesion, Food poverty
              </span>
            </div>
          </div>
        )}
      </Card>
    )
  },
}

/** Every action disabled renders nothing at all — a kebab that opens onto a dead list is
 *  worse than no kebab. */
export const NothingToDo: Story = {
  args: { actions: [] },
  render: () => (
    <ActionMenu actions={[{ label: 'Edit', onSelect: () => {}, disabled: true }]} label="Actions" />
  ),
}
