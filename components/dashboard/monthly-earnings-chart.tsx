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
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Monthly Earnings</h3>
      <div className="grid grid-cols-6 gap-2">
        {Object.entries(monthlyEarnings)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 6)
          .reverse()
          .map(([month, amount]) => (
            <div key={month} className="text-center">
              <div className="text-xs text-gray-500 mb-1">{month}</div>
              <div className="bg-gradient-to-t from-yellow-400 to-orange-500 rounded-lg p-2">
                <p className="text-sm font-semibold text-white">
                  ${amount.toFixed(0)}
                </p>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
