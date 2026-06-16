import { describe, expect, it } from 'vitest'
import {
  testnetBadgeLabel,
  tipFlowShortNote,
  practiceFundsNote,
} from '@/lib/copy/network-status'

describe('network-status copy', () => {
  it('testnetBadgeLabel returns compact label on testnet', () => {
    expect(testnetBadgeLabel()).toBe('Testnet — practice funds only')
  })

  it('tipFlowShortNote mentions testnet confirmation', () => {
    expect(tipFlowShortNote()).toContain('testnet confirmation')
  })

  it('practiceFundsNote remains the full explanatory paragraph', () => {
    expect(practiceFundsNote()).toContain('Quilltip runs on Stellar testnet')
  })
})
