import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button, Dialog, Label, Select } from '../ui'
import { C } from '../ui/tokens'
import {
  grantMilestones,
  moveReportFn,
  reportGrantChoices,
  returnReportFn,
} from '../../server/fns/reportCorrections'
import type { GrantChoice } from '../../server/fns/heldReports'
import { fmtDate, fmtMoney } from '../../lib/format'

// "Wrong grant?" on the report's Grant details card. Two ways out, and the admin picks
// one: move the report to the grant it is really about (when they know which), or send
// it back to the reports that need a grant (when they do not, or want to look first).
//
// Either way the milestone it answered here is marked outstanding again, unless another
// report answers it. Moving keeps the analysis, which compared the report with this
// grant, so "Re-run analysis" is offered afterwards; sending back discards it, since the
// report is placed afresh.
//
// Rare by design: automatic matching is exact (the foundation's reference, or a charity
// number with one grant waiting), so this is mostly for a human who picked wrongly.

type Choice = 'move' | 'return'

const grantLabel = (g: GrantChoice) =>
  [g.organisationName, g.programmeName, fmtMoney(g.amountAwarded), g.reference]
    .filter(Boolean)
    .join(' · ')

export function WrongGrantDialog({
  open,
  onClose,
  reportId,
  organisationName,
  currentAwardId,
  milestoneLabel,
  canSendBack,
}: {
  open: boolean
  onClose: () => void
  reportId: string
  organisationName: string
  currentAwardId: string
  /** The milestone it answers here, if any: named in what happens next. */
  milestoneLabel: string | null
  /** False for a report with no stored submission, which has nowhere to go back to. */
  canSendBack: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [choice, setChoice] = useState<Choice>('move')
  const [grants, setGrants] = useState<GrantChoice[] | null>(null)
  const [awardId, setAwardId] = useState('')
  const [milestones, setMilestones] = useState<Array<{
    id: string
    label: string
    dueDate: string
    taken: boolean
  }> | null>(null)
  const [scheduleId, setScheduleId] = useState<string>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A list that failed to load must not look like a list with nothing in it.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setChoice('move')
    setAwardId('')
    setError(null)
    setLoadError(null)
    setGrants(null)
    reportGrantChoices({ data: { reportId } })
      .then((g) => setGrants(g.filter((x) => x.awardId !== currentAwardId)))
      .catch(() => {
        setGrants([])
        setLoadError('The grants could not be loaded. Close this and try again.')
      })
  }, [open, reportId, currentAwardId])

  useEffect(() => {
    if (!open || !awardId) return
    setMilestones(null)
    grantMilestones({ data: { reportId, awardId } })
      .then((m) => {
        setMilestones(m)
        // Start from the new grant's earliest milestone nobody has answered.
        setScheduleId(m.find((x) => !x.taken)?.id ?? 'none')
      })
      .catch(() => {
        setMilestones([])
        setLoadError("That grant's milestones could not be loaded. Close this and try again.")
      })
  }, [open, reportId, awardId])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (choice === 'return') {
        await returnReportFn({ data: { reportId } })
        onClose()
        await navigate({ to: '/reports' })
      } else {
        await moveReportFn({
          data: { reportId, awardId, scheduleId: scheduleId === 'none' ? null : scheduleId },
        })
        onClose()
        // Usually the same address it is already on, which would keep the old grant's
        // data on screen: reload it.
        await navigate({ to: '/reports/$reportKey', params: { reportKey: reportId } })
        await router.invalidate()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const milestoneOptions = [
    ...(milestones ?? [])
      .filter((m) => !m.taken)
      .map((m) => ({ value: m.id, label: `${m.label} · due ${fmtDate(m.dueDate)}` })),
    { value: 'none', label: 'No milestone (an extra report)' },
  ]
  const ready = choice === 'return' || (awardId !== '' && milestones !== null)
  const outstandingAgain = milestoneLabel
    ? ` The ${milestoneLabel} milestone on this grant will show as outstanding again.`
    : ''

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title="Is this the wrong grant?"
      description={`${organisationName} · choose what should happen to this report`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !ready}>
            {busy
              ? choice === 'return'
                ? 'Sending back…'
                : 'Moving…'
              : choice === 'return'
                ? 'Send it back'
                : 'Move report'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="What should happen">
        <Option
          checked={choice === 'move'}
          onSelect={() => setChoice('move')}
          title="Move it to the right grant"
          detail={`Choose the grant it is about.${outstandingAgain} The analysis can be re-run against the new grant afterwards.`}
        >
          {choice === 'move' && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wrong-grant-grant">Grant</Label>
                <Select
                  id="wrong-grant-grant"
                  value={awardId}
                  placeholder={
                    grants === null
                      ? 'Loading grants…'
                      : grants.length === 0 && !loadError
                        ? 'No other grants to move it to'
                        : 'Choose a grant'
                  }
                  options={(grants ?? []).map((g) => ({ value: g.awardId, label: grantLabel(g) }))}
                  onChange={(v: string) => setAwardId(v)}
                  disabled={grants === null}
                />
              </div>
              {awardId && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wrong-grant-milestone">Reporting milestone</Label>
                  <Select
                    id="wrong-grant-milestone"
                    value={scheduleId}
                    options={milestoneOptions}
                    onChange={(v: string) => setScheduleId(v)}
                    disabled={milestones === null}
                  />
                </div>
              )}
            </div>
          )}
        </Option>
        {canSendBack && (
          <Option
            checked={choice === 'return'}
            onSelect={() => setChoice('return')}
            title="Send it back to Reports that need a grant"
            detail={`It waits at the top of the Reports screen until someone chooses its grant.${outstandingAgain} The analysis is discarded.`}
          />
        )}
      </div>
      {(loadError || error) && (
        <p className="mt-3 font-display text-label" style={{ color: C.danger }} role="alert">
          {loadError ?? error}
        </p>
      )}
    </Dialog>
  )
}

function Option({
  checked,
  onSelect,
  title,
  detail,
  children,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
  children?: ReactNode
}) {
  return (
    <div
      className="rounded-chip border px-3 py-2.5"
      style={{
        borderColor: checked ? C.brand : C.line,
        backgroundColor: checked ? C.brandWash : C.white,
      }}
    >
      <label className="flex cursor-pointer items-start gap-2.5" aria-label={title}>
        <input type="radio" className="mt-1" checked={checked} onChange={onSelect} />
        <span className="flex flex-col gap-0.5 font-display">
          <span className="text-body font-medium" style={{ color: C.ink }}>
            {title}
          </span>
          <span className="text-label" style={{ color: C.sub }}>
            {detail}
          </span>
        </span>
      </label>
      {children}
    </div>
  )
}
