'use client'

import {
  buildLastSixMonthSlots,
  formatMonthLabel,
  monthWindowSpansTwoYears,
} from '@/lib/earnings/monthly-earnings'
import { Card, CardContent } from '@/components/ui/card'

type MonthlyEarningsChartProps = {
  monthlyEarnings: Record<string, number>
}

export function MonthlyEarningsChart({
  monthlyEarnings,
}: MonthlyEarningsChartProps) {
  const slots = buildLastSixMonthSlots(monthlyEarnings)
  const showYear = monthWindowSpansTwoYears(slots.map((slot) => slot.monthKey))
  const allZero = slots.every((slot) => slot.amountUsd === 0)

  return (
    <Card variant="quiet" className="mt-6">
      <CardContent className="pt-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Monthly Earnings</h3>
          {allZero && (
            <p className="text-sm text-muted-foreground mt-1">
              No earnings in the last 6 months
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {slots.map((slot) => {
            const hasEarnings = slot.amountUsd > 0
            return (
              <div key={slot.monthKey} className="min-w-0 text-center">
                <div className="text-xs text-muted-foreground mb-1 whitespace-nowrap">
                  {formatMonthLabel(slot.monthKey, { showYear })}
                </div>
                <div
                  className={
                    hasEarnings
                      ? 'bg-success text-success-foreground rounded-lg p-2'
                      : 'bg-muted text-muted-foreground rounded-lg border border-border p-2'
                  }
                >
                  <p className="text-sm font-semibold">
                    ${slot.amountUsd.toFixed(0)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
