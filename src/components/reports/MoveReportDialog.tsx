import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, Dialog, Label, Select } from '../ui'
import { C } from '../ui/tokens'
import {
  grantMilestones,
  moveReportFn,
  reportGrantChoices,
} from '../../server/fns/reportCorrections'
import type { GrantChoice } from '../../server/fns/heldReports'
import { fmtDate, fmtMoney } from '../../lib/format'

// Put a report where it belongs: another grant (the reference belonged to the charity's
// other grant), or another milestone on this one (it is the year-two report, and ticked
// year one because year one was still open). The milestone it leaves is un-ticked, the
// one it joins is ticked, and both grants' statuses follow.
//
// Moving does not re-run the analysis, which compared the report with the grant it was
// on; the report screen offers "Re-run analysis" afterwards.

const NO_MILESTONE = 'none'

export function MoveReportDialog({
  open,
  onClose,
  reportId,
  organisationName,
  currentAwardId,
  currentScheduleId,
}: {
  open: boolean
  onClose: () => void
  reportId: string
  organisationName: string
  currentAwardId: string
  currentScheduleId: string | null
}) {
  const navigate = useNavigate()
  const [grants, setGrants] = useState<GrantChoice[] | null>(null)
  const [awardId, setAwardId] = useState(currentAwardId)
  const [milestones, setMilestones] = useState<Array<{
    id: string
    label: string
    dueDate: string
    taken: boolean
  }> | null>(null)
  const [scheduleId, setScheduleId] = useState<string>(currentScheduleId ?? NO_MILESTONE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAwardId(currentAwardId)
    setScheduleId(currentScheduleId ?? NO_MILESTONE)
    setError(null)
    reportGrantChoices({ data: { reportId } })
      .then(setGrants)
      .catch(() => setGrants([]))
  }, [open, reportId, currentAwardId, currentScheduleId])

  useEffect(() => {
    if (!open) return
    setMilestones(null)
    grantMilestones({ data: { reportId, awardId } })
      .then((m) => {
        setMilestones(m)
        // Changing grant: start from its earliest milestone nobody has answered.
        if (awardId !== currentAwardId) {
          setScheduleId(m.find((x) => !x.taken)?.id ?? NO_MILESTONE)
        }
      })
      .catch(() => setMilestones([]))
  }, [open, reportId, awardId, currentAwardId])

  const unchanged =
    awardId === currentAwardId &&
    (scheduleId === NO_MILESTONE ? null : scheduleId) === currentScheduleId

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await moveReportFn({
        data: { reportId, awardId, scheduleId: scheduleId === NO_MILESTONE ? null : scheduleId },
      })
      onClose()
      // By the report's own id: the address it was opened at may name the milestone it
      // just left.
      await navigate({ to: '/reports/$reportKey', params: { reportKey: reportId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const grantOptions = (grants ?? []).map((g) => ({
    value: g.awardId,
    label: [g.organisationName, g.programmeName, fmtMoney(g.amountAwarded), g.reference]
      .filter(Boolean)
      .join(' · '),
  }))
  const milestoneOptions = [
    ...(milestones ?? [])
      .filter((m) => !m.taken)
      .map((m) => ({ value: m.id, label: `${m.label} · due ${fmtDate(m.dueDate)}` })),
    { value: NO_MILESTONE, label: 'No milestone (an extra report)' },
  ]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title="Move this report"
      description={`${organisationName} · for when it was attached to the wrong grant or milestone`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || unchanged || grants === null}>
            {busy ? 'Moving…' : 'Move report'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="move-grant">Grant</Label>
          <Select
            id="move-grant"
            value={awardId}
            options={grantOptions}
            onChange={(v: string) => setAwardId(v)}
            disabled={grants === null}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="move-milestone">Reporting milestone</Label>
          <Select
            id="move-milestone"
            value={scheduleId}
            options={milestoneOptions}
            onChange={(v: string) => setScheduleId(v)}
            disabled={milestones === null}
          />
          <p className="font-display text-label" style={{ color: C.sub }}>
            Milestones another report already answers are not offered. The one this report leaves is
            marked outstanding again, unless another report answers it.
          </p>
        </div>
        {awardId !== currentAwardId && (
          <p className="font-display text-label" style={{ color: C.sub }}>
            The AI analysis compared this report with its current grant. After moving, re-run it
            from the report to compare it with the new one.
          </p>
        )}
        {error && (
          <p className="font-display text-label" style={{ color: C.danger }} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
