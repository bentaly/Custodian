import { useMemo, useState } from 'react'
import { getGrantCreditors } from '../../server/fns/budget'
import { Button, Dialog, ErrorNote, Label, Select, TOKENS as C } from '../ui'
import { messageFor } from '../../lib/errors'
import { fmtDate, fmtMoney } from '../../lib/format'
import { shiftFinancialYear } from '../../lib/financialYear'
import { grantCreditorsWorkbook } from '../../lib/grantCreditorsWorkbook'

/**
 * "Grant creditors at year end": the Excel file a foundation's accountant needs for the
 * SORP creditors note — what was promised and still unpaid, due within one year and
 * after more than one year. The rules are `src/lib/grantCreditors.ts`.
 *
 * Offers the foundation's last six COMPLETED year ends, newest first and selected. The
 * current year's end is not offered: until it has passed, payments still to be marked
 * paid before it would read as owed, and the file would be a forecast wearing the name
 * of a statement.
 *
 * Nothing is downloaded when nothing was owed; the dialog says so instead, since an
 * empty spreadsheet reads as a failed export.
 */
export function GrantCreditorsDialog({
  open,
  currentYearEnd,
  onClose,
}: {
  open: boolean
  /** `yyyy-mm-dd`, the end of the financial year we are in — the month is all that is read. */
  currentYearEnd: string
  onClose: () => void
}) {
  const options = useMemo(() => {
    const endMonth = Number(currentYearEnd.slice(5, 7))
    return [-1, -2, -3, -4, -5, -6].map((offset) => {
      const fy = shiftFinancialYear(endMonth, offset, new Date(`${currentYearEnd}T00:00:00Z`))
      return { value: fy.end, label: `${fmtDate(fy.end)} (year ${fy.label})` }
    })
  }, [currentYearEnd])

  const [yearEnd, setYearEnd] = useState(options[0]!.value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)

  function close() {
    setError('')
    setResult(null)
    onClose()
  }

  async function handleDownload() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const { report, foundationName } = await getGrantCreditors({ data: { yearEnd } })
      if (report.lines.length === 0) {
        setResult(
          `Nothing was owed to grantees at ${fmtDate(yearEnd)}, so there is no file to download.`,
        )
        return
      }
      const blob = await grantCreditorsWorkbook(report, foundationName)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grant-creditors-${yearEnd}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      const t = report.totals
      setResult(
        `Downloaded ${t.count} grant${t.count === 1 ? '' : 's'}: ${fmtMoney(t.dueWithinOneYear)} due within one year, ` +
          `${fmtMoney(t.dueAfterOneYear)} after more than one year` +
          (t.noDueDate > 0 ? `, and ${fmtMoney(t.noDueDate)} with no due date set.` : '.'),
      )
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="Grant creditors at year end"
      description="What you had promised grantees and not yet paid, split into due within one year and after more than one year, for your accounts."
      busy={busy}
      size="sm"
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button onClick={handleDownload} disabled={busy}>
            {busy ? 'Preparing…' : 'Download Excel'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="creditors-year-end">Year end</Label>
          <Select
            id="creditors-year-end"
            options={options}
            value={yearEnd}
            onChange={(v) => {
              setYearEnd(v)
              setResult(null)
            }}
            disabled={busy}
          />
        </div>

        <ErrorNote error={error} />

        {result && (
          <p className="font-display text-body" style={{ color: C.sub }}>
            {result}
          </p>
        )}

        <p className="font-display text-label" style={{ color: C.faint }}>
          Built from the payment schedules in Custodian, so check any dates that have moved before
          sending it on. Cancelled grants are left out.
        </p>
      </div>
    </Dialog>
  )
}
