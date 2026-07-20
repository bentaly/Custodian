// Format a pounds figure for display: thousands separators, and pence only when
// the amount actually has a fractional part — so "£22,000", but "£1,250.50". Used
// for budget line items and their total, which are captured to the penny.
export function formatPounds(amount: number): string {
  const hasPence = Math.round(amount * 100) % 100 !== 0
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: hasPence ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
