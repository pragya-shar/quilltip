import { describe, expect, it } from 'vitest'
import {
  buildLastSixMonthSlots,
  formatMonthLabel,
  monthWindowSpansTwoYears,
  parseMonthKey,
} from '@/lib/earnings/monthly-earnings'

describe('parseMonthKey', () => {
  it('parses a valid YYYY-MM key', () => {
    const date = parseMonthKey('2024-01')
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2024)
    expect(date?.getMonth()).toBe(0)
  })

  it('returns null for invalid keys', () => {
    expect(parseMonthKey('2024-13')).toBeNull()
    expect(parseMonthKey('invalid')).toBeNull()
  })
})

describe('formatMonthLabel', () => {
  it('formats as short month without year by default', () => {
    expect(formatMonthLabel('2024-01', { showYear: false })).toBe('Jan')
    expect(formatMonthLabel('2024-03', { showYear: false })).toBe('Mar')
  })

  it('includes year when showYear is true', () => {
    expect(formatMonthLabel('2024-01', { showYear: true })).toBe('Jan 2024')
  })

  it('falls back to the raw key for invalid input', () => {
    expect(formatMonthLabel('not-a-month', { showYear: false })).toBe(
      'not-a-month'
    )
  })
})

describe('monthWindowSpansTwoYears', () => {
  it('returns false when all months are in the same year', () => {
    expect(
      monthWindowSpansTwoYears([
        '2024-01',
        '2024-02',
        '2024-03',
        '2024-04',
        '2024-05',
        '2024-06',
      ])
    ).toBe(false)
  })

  it('returns true when the window crosses a year boundary', () => {
    expect(
      monthWindowSpansTwoYears([
        '2024-08',
        '2024-09',
        '2024-10',
        '2024-11',
        '2024-12',
        '2025-01',
      ])
    ).toBe(true)
  })
})

describe('buildLastSixMonthSlots', () => {
  it('returns six chronological slots ending at the current month', () => {
    const now = new Date(2024, 5, 15)
    const slots = buildLastSixMonthSlots({ '2024-06': 30 }, now)

    expect(slots).toHaveLength(6)
    expect(slots.map((slot) => slot.monthKey)).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
      '2024-05',
      '2024-06',
    ])
    expect(slots.find((slot) => slot.monthKey === '2024-06')?.amountUsd).toBe(
      30
    )
    expect(slots.filter((slot) => slot.amountUsd > 0)).toHaveLength(1)
  })
})
