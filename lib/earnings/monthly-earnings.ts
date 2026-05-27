const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/

export type MonthlyEarningsSlot = {
  monthKey: string
  amountUsd: number
}

export function parseMonthKey(monthKey: string): Date | null {
  const match = MONTH_KEY_RE.exec(monthKey)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) {
    return null
  }

  return new Date(year, month - 1, 1)
}

export function formatMonthKey(monthKey: string): string {
  const date = parseMonthKey(monthKey)
  if (!date) {
    return monthKey
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(
  monthKey: string,
  options: { showYear: boolean }
): string {
  const date = parseMonthKey(monthKey)
  if (!date) {
    return monthKey
  }

  if (options.showYear) {
    return date.toLocaleString(undefined, {
      month: 'short',
      year: 'numeric',
    })
  }

  return date.toLocaleString(undefined, { month: 'short' })
}

export function monthWindowSpansTwoYears(monthKeys: string[]): boolean {
  if (monthKeys.length === 0) {
    return false
  }

  const firstKey = monthKeys[0]
  const lastKey = monthKeys[monthKeys.length - 1]
  if (!firstKey || !lastKey) {
    return false
  }

  const first = parseMonthKey(firstKey)
  const last = parseMonthKey(lastKey)
  if (!first || !last) {
    return false
  }

  return first.getFullYear() !== last.getFullYear()
}

export function buildLastSixMonthSlots(
  monthlyEarnings: Record<string, number>,
  now: Date = new Date()
): MonthlyEarningsSlot[] {
  const slots: MonthlyEarningsSlot[] = []

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    slots.push({
      monthKey,
      amountUsd: monthlyEarnings[monthKey] ?? 0,
    })
  }

  return slots
}
