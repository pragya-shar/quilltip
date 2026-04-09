'use client'

type MonthlyEarningsChartProps = {
  monthlyEarnings: Record<string, number>
}

export function MonthlyEarningsChart({
  monthlyEarnings,
}: MonthlyEarningsChartProps) {
  if (Object.keys(monthlyEarnings).length === 0) {
    return null
  }

  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
      <h3 className="text-lg font-semibold mb-4">Monthly Earnings</h3>
      <div className="grid grid-cols-6 gap-2">
        {Object.entries(monthlyEarnings)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 6)
          .reverse()
          .map(([month, amount]) => (
            <div key={month} className="text-center">
              <div className="text-xs text-muted-foreground mb-1">{month}</div>
              <div className="bg-success text-success-foreground rounded-lg p-2">
                <p className="text-sm font-semibold">
                  ${amount.toFixed(0)}
                </p>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
