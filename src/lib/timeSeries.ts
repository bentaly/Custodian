// Adaptive time-bucketing for "amount over time" series. Picks a bucket size from the
// span so a short window (a young quarter) resolves to weeks or days while a multi-year
// window resolves to months/quarters/years — instead of collapsing to a single point.
// Buckets are per-period sums (not cumulative); empty periods are kept as zero so the
// line is continuous. All maths is in UTC.

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type SeriesPoint = { label: string; amount: number }
export type DatedAmount = { date: Date; amount: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

// Thresholds chosen to keep bucket counts roughly in the 4–30 range.
export function chooseGranularity(spanDays: number): Granularity {
  if (spanDays <= 16) return 'day'
  if (spanDays <= 120) return 'week' // ~17 weeks
  if (spanDays <= 900) return 'month' // ~30 months
  if (spanDays <= 2600) return 'quarter' // ~7 years
  return 'year'
}

function startOfBucket(d: Date, g: Granularity): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  switch (g) {
    case 'day':
      return new Date(Date.UTC(y, m, day))
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
      return new Date(Date.UTC(y, m, day - dow))
    }
    case 'month':
      return new Date(Date.UTC(y, m, 1))
    case 'quarter':
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))
    case 'year':
      return new Date(Date.UTC(y, 0, 1))
  }
}

function nextBucket(d: Date, g: Granularity): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  switch (g) {
    case 'day':
      return new Date(Date.UTC(y, m, day + 1))
    case 'week':
      return new Date(Date.UTC(y, m, day + 7))
    case 'month':
      return new Date(Date.UTC(y, m + 1, 1))
    case 'quarter':
      return new Date(Date.UTC(y, m + 3, 1))
    case 'year':
      return new Date(Date.UTC(y + 1, 0, 1))
  }
}

function labelFor(d: Date, g: Granularity, multiYear: boolean): string {
  const yy = `’${String(d.getUTCFullYear()).slice(2)}`
  switch (g) {
    case 'day':
    case 'week':
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
    case 'month':
      return multiYear ? `${MONTHS[d.getUTCMonth()]} ${yy}` : MONTHS[d.getUTCMonth()]!
    case 'quarter':
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1}${multiYear ? ` ${yy}` : ''}`
    case 'year':
      return String(d.getUTCFullYear())
  }
}

/**
 * Bucket `events` between `start` and `end` at an automatically-chosen resolution.
 * Returns one point per period (chronological), with empty periods as zero.
 */
export function bucketSeries(events: DatedAmount[], start: Date, end: Date): SeriesPoint[] {
  const spanDays = Math.max(0, (end.getTime() - start.getTime()) / DAY_MS)
  const g = chooseGranularity(spanDays)
  const multiYear = start.getUTCFullYear() !== end.getUTCFullYear()

  const buckets: Array<{ start: number; label: string; amount: number }> = []
  let cur = startOfBucket(start, g)
  while (cur.getTime() <= end.getTime()) {
    buckets.push({ start: cur.getTime(), label: labelFor(cur, g, multiYear), amount: 0 })
    cur = nextBucket(cur, g)
  }
  if (buckets.length === 0) {
    const s = startOfBucket(start, g)
    buckets.push({ start: s.getTime(), label: labelFor(s, g, multiYear), amount: 0 })
  }

  for (const e of events) {
    const t = e.date.getTime()
    if (t < buckets[0]!.start) continue
    // Walk back to the last bucket whose start is <= the event.
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i]!.start) {
        buckets[i]!.amount += e.amount
        break
      }
    }
  }

  return buckets.map((b) => ({ label: b.label, amount: b.amount }))
}
