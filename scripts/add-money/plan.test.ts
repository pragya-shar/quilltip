import { describe, expect, it } from 'vitest'
import {
  addMoneyPlan,
  primaryLabel,
  quickTipsVariant,
  tipButtonWords,
  type DeviceKind,
} from '@/lib/addMoney/plan'

const NEEDS: DeviceKind[] = [
  'none',
  'other-device',
  'gone',
  'expired',
  'revoked',
  'stopped',
  'pending',
]

describe('which request Add money makes', () => {
  it('from a tip, on a device that cannot quick tip: add and set up, money only as the quiet choice', () => {
    for (const device of NEEDS) {
      const plan = addMoneyPlan({ entry: 'tip', device })
      expect(plan.quickTipsByDefault, device).toBe(true)
      expect(plan.choice, device).toBe('add-only')
      expect(plan.verb, device).toBe(device === 'expired' ? 'renew' : 'set-up')
    }
  })

  it('from the balance, on a device that cannot quick tip: money only, with a switch', () => {
    for (const device of NEEDS) {
      const plan = addMoneyPlan({ entry: 'balance', device })
      expect(plan.quickTipsByDefault, device).toBe(false)
      expect(plan.choice, device).toBe('switch')
    }
  })

  it('on a set-up device, from anywhere: add and renew, money only as the quiet choice', () => {
    for (const entry of ['tip', 'balance'] as const)
      for (const device of ['ready', 'unchecked'] as const)
        expect(addMoneyPlan({ entry, device })).toEqual({
          quickTipsByDefault: true,
          verb: 'renew',
          choice: 'add-only',
        })
  })

  it('in a browser that cannot keep an approval: money only, and no choice', () => {
    for (const entry of ['tip', 'balance'] as const)
      expect(addMoneyPlan({ entry, device: 'storage-unavailable' })).toEqual({
        quickTipsByDefault: false,
        verb: 'set-up',
        choice: 'none',
      })
  })

  it('before the device is read, from the balance, offers the switch off', () => {
    expect(addMoneyPlan({ entry: 'balance', device: null }).choice).toBe(
      'switch'
    )
  })
})

describe('the primary button names what the reader agrees to', () => {
  it('carries the amount, with no ampersand', () => {
    expect(primaryLabel('$10', false, 'set-up')).toBe('Add $10')
    expect(primaryLabel('$10', true, 'set-up')).toBe(
      'Add $10 and set up quick tips'
    )
    expect(primaryLabel('$20', true, 'renew')).toBe(
      'Add $20 and renew quick tips'
    )
  })
})

describe('the tip button when the balance covers the tip', () => {
  it('names the step the device needs', () => {
    expect(tipButtonWords('expired')).toBe('Renew to tip')
    expect(tipButtonWords('ready', true)).toBe('Renew to tip')
    expect(tipButtonWords('pending')).toBe('Finish setup to tip')
    for (const d of [
      'none',
      'other-device',
      'gone',
      'revoked',
      'stopped',
    ] as const)
      expect(tipButtonWords(d), d).toBe('Set up to tip')
  })

  it('has no setup words when the device is ready, unchecked or cannot keep a key', () => {
    expect(tipButtonWords('ready')).toBeNull()
    // Not yet checked against the ledger: waiting, never "set up again".
    expect(tipButtonWords('unchecked')).toBeNull()
    expect(tipButtonWords('storage-unavailable')).toBeNull()
  })

  it('opens the sheet variant that says why', () => {
    expect(quickTipsVariant('expired')).toBe('renew')
    expect(quickTipsVariant('ready', true)).toBe('limit')
    expect(quickTipsVariant('gone')).toBe('gone')
    expect(quickTipsVariant('revoked')).toBe('revoked')
    expect(quickTipsVariant('stopped')).toBe('stopped')
    expect(quickTipsVariant('pending')).toBe('pending')
    expect(quickTipsVariant('none')).toBe('set-up')
    expect(quickTipsVariant('other-device')).toBe('set-up')
  })
})
