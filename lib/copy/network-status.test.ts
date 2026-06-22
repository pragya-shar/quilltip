import { describe, expect, it } from 'vitest'
import {
  testnetBadgeLabel,
  tipDialogFooterNote,
  tipFlowShortNote,
  practiceFundsNote,
} from '@/lib/copy/network-status'

describe('network-status copy', () => {
  it('testnetBadgeLabel returns compact label on testnet', () => {
    expect(testnetBadgeLabel()).toBe('Testnet — practice funds only')
  })

  it('tipDialogFooterNote is a short modal footer line', () => {
    expect(tipDialogFooterNote()).toMatch(/Tips confirm in seconds/)
    expect(tipDialogFooterNote().length).toBeLessThan(80)
  })

  it('tipFlowShortNote mentions testnet confirmation', () => {
    expect(tipFlowShortNote()).toContain('testnet confirmation')
  })

  it('practiceFundsNote remains the full explanatory paragraph', () => {
    expect(practiceFundsNote()).toContain('Quilltip runs on Stellar testnet')
  })
})
