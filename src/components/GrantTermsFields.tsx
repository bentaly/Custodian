import { Input, Label } from './ui'

// The three terms a programme is given *for one round*: the pot, the ceiling on any
// single award, and how long awards run. They are set in two places — adding a
// programme to a round, and adding a round to a programme — which are the same pairing
// approached from either end, so the fields (and their explanations) live here rather
// than being written twice and drifting.
//
// Every field carries a hint. These are the only place a foundation states what its
// money is for, and "Total budget" on its own reads as though it might mean the round,
// the programme, or the year — three different numbers.

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-label text-gray-400">{children}</p>
}

export function GrantTermsFields({
  budget,
  onBudget,
  maxGrantAmount,
  onMaxGrantAmount,
  grantDurationYears,
  onGrantDurationYears,
  budgetRequired,
}: {
  budget: string
  onBudget: (v: string) => void
  maxGrantAmount: string
  onMaxGrantAmount: (v: string) => void
  grantDurationYears: string
  onGrantDurationYears: (v: string) => void
  budgetRequired?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div>
        <Label>
          Total budget{budgetRequired && <span className="ml-0.5 text-danger">*</span>}
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-display text-body text-gray-400">
            £
          </span>
          <Input
            type="number"
            value={budget}
            onChange={(e) => onBudget(e.target.value)}
            min="1"
            step="1"
            placeholder="0"
            required={budgetRequired}
            className="pl-6"
          />
        </div>
        <Hint>
          The whole pot for this programme in this round. Applications and awards are tracked
          against it.
        </Hint>
      </div>
      <div>
        <Label>Max per award</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-display text-body text-gray-400">
            £
          </span>
          <Input
            type="number"
            value={maxGrantAmount}
            onChange={(e) => onMaxGrantAmount(e.target.value)}
            min="1"
            step="1"
            placeholder="0"
            className="pl-6"
          />
        </div>
        <Hint>The most any single grantee can receive. Optional — leave blank for no ceiling.</Hint>
      </div>
      <div>
        <Label>Duration</Label>
        <div className="relative">
          <Input
            type="number"
            value={grantDurationYears}
            onChange={(e) => onGrantDurationYears(e.target.value)}
            min="1"
            max="20"
            step="1"
            placeholder="1"
            className="pr-10"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-display text-body text-gray-400">
            yrs
          </span>
        </div>
        <Hint>How many years a grant here typically runs, for the annual figure. Optional.</Hint>
      </div>
    </div>
  )
}
