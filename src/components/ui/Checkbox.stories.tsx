import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: 'Controls/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  argTypes: {
    checked: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: { label: 'Include closed rounds', checked: false, indeterminate: false, disabled: false },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/**
 * The three states, all one squircle with a different mark inside — `SquareIcon`,
 * `CheckmarkSquare02Icon` and `MinusSignSquareIcon` share a byte-identical outer path,
 * so nothing shifts as the state changes. Unchecked sits at 30% opacity, per the Figma.
 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox label="Unchecked" checked={false} readOnly />
      <Checkbox label="Checked" checked readOnly />
      <Checkbox label="Indeterminate — some rows selected" indeterminate checked={false} readOnly />
      <Checkbox label="Disabled" checked={false} disabled readOnly />
      <Checkbox label="Disabled, checked" checked disabled readOnly />
    </div>
  ),
}

/** Tab to it: the ring is the app's field-focus treatment, since the comps define no
 *  focus state. Space toggles; Enter deliberately does nothing, as on any checkbox. */
export const Keyboard: Story = {
  render: function Keyboard() {
    const [on, setOn] = useState(false)
    return (
      <div className="flex flex-col gap-3">
        <Checkbox label="Focus me with Tab, toggle with Space" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <p className="font-display text-label text-grey-500">checked: {String(on)}</p>
      </div>
    )
  },
}

/** With no `label`, `aria-label` is required — a checkbox with no accessible name cannot
 *  be used by a screen reader. This is the form the table's select column uses. */
export const Bare: Story = {
  render: function Bare() {
    const [rows, setRows] = useState([false, false, false])
    const all = rows.every(Boolean)
    const some = rows.some(Boolean)
    return (
      <table className="w-[320px] border-collapse">
        <thead>
          <tr className="h-10 bg-grey-100">
            <th className="w-11 px-3">
              <Checkbox
                aria-label="Select all rows"
                checked={all}
                indeterminate={!all && some}
                onChange={() => setRows(rows.map(() => !all))}
              />
            </th>
            <th className="px-3 text-left font-display text-body font-medium text-grey-900">
              Organisation
            </th>
          </tr>
        </thead>
        <tbody>
          {['Nature Learning Network', 'Groundwork Trust', 'Pennine Youth Alliance'].map((name, i) => (
            <tr key={name} className="h-16 hover:bg-grey-50">
              <td className="w-11 px-3">
                <Checkbox
                  aria-label={`Select ${name}`}
                  checked={rows[i]}
                  onChange={() => setRows(rows.map((r, j) => (i === j ? !r : r)))}
                />
              </td>
              <td className="px-3 font-display text-body text-grey-900">{name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  },
}
