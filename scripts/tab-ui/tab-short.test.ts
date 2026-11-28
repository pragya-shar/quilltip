import { describe, expect, it } from 'vitest'

import { STATUS_LABEL } from '@/lib/copy/payment-states'
import {
  readerTabTipPhase,
  tabIsShort,
  tabShortBy,
} from '@/lib/tab-ui/tab-short'

const XLM = BigInt(10_000_000)
const tab = (status: 'OPEN' | 'CLOSING', available: bigint) => ({
  status,
  available: available.toString(),
})

describe('a short tab (#643)', () => {
  it('is an open tab whose tips settling exceed its balance', () => {
    // 2 XLM held, 5.5529111 XLM sent: 3.5529111 XLM short.
    const short = tab('OPEN', BigInt(-35_529_111))
    expect(tabShortBy(short)).toBe('35529111')
    expect(tabIsShort(short)).toBe(true)
  })

  it('is not short when the tab covers its tips, or with no tab', () => {
    expect(tabIsShort(tab('OPEN', BigInt(0)))).toBe(false)
    expect(tabIsShort(tab('OPEN', XLM))).toBe(false)
    expect(tabIsShort(null)).toBe(false)
    expect(tabIsShort(undefined)).toBe(false)
  })

  it('reads short only for an open tab, as the tab notice does', () => {
    expect(tabIsShort(tab('CLOSING', -XLM))).toBe(false)
  })
})

describe('a tab tip as its reader sees it (#643)', () => {
  it('waits for a top-up when accepted on a short tab', () => {
    const phase = readerTabTipPhase('ACCEPTED', true)
    expect(phase).toBe('shortfall')
    expect(STATUS_LABEL[phase]).toBe('Waiting for balance')
  })

  it('keeps the settling wording when the tab is not short', () => {
    const phase = readerTabTipPhase('ACCEPTED', false)
    expect(phase).toBe('accepted')
    expect(STATUS_LABEL[phase]).toBe('Settling')
  })

  it('changes no other state', () => {
    for (const tabShort of [true, false]) {
      expect(readerTabTipPhase('SETTLED', tabShort)).toBe('settled')
      expect(readerTabTipPhase('SHORTFALL', tabShort)).toBe('shortfall')
      expect(readerTabTipPhase('UNPAID', tabShort)).toBe('unpaid')
      expect(readerTabTipPhase('REJECTED', tabShort)).toBe('rejected')
      expect(readerTabTipPhase('VOID_RESET', tabShort)).toBe('void-reset')
    }
  })
})
