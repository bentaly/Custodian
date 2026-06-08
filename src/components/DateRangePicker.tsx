export function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  startLabel = 'Opens',
  endLabel = 'Closes',
}: {
  startDate: string
  endDate: string
  onStartChange: (date: string) => void
  onEndChange: (date: string) => void
  startLabel?: string
  endLabel?: string
}) {
  return (
    <div className="flex overflow-hidden rounded border border-gray-300 focus-within:ring-2 focus-within:ring-gray-400 divide-x divide-gray-200">
      <div className="flex-1 px-3 py-2">
        <div className="mb-0.5 text-xs font-medium text-gray-400">{startLabel}</div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="w-full bg-transparent text-sm text-gray-900 focus:outline-none"
        />
      </div>
      <div className="flex-1 px-3 py-2">
        <div className="mb-0.5 text-xs font-medium text-gray-400">{endLabel}</div>
        <input
          type="date"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => onEndChange(e.target.value)}
          className="w-full bg-transparent text-sm text-gray-900 focus:outline-none"
        />
      </div>
    </div>
  )
}
