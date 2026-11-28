import { describe, expect, it } from 'vitest'
import {
  addUnits,
  checkDeposit,
  depositRange,
  isPositive,
  maxDeposit,
  parseXlm,
  stroopsToInput,
  subtractUnits,
  walletFundsFromAccount,
  xlm,
} from '../../lib/tab-ui/amounts'

describe('parseXlm', () => {
  it('parses whole and fractional XLM exactly, with a dot or a comma', () => {
    expect(parseXlm('10')).toBe('100000000')
    expect(parseXlm(' 10.5 ')).toBe('105000000')
    expect(parseXlm('0,0000001')).toBe('1')
    expect(parseXlm('1.')).toBe('10000000')
    expect(parseXlm('0')).toBe('0')
  })
  it('refuses anything else', () => {
    for (const bad of ['', '-1', '1.00000001', 'abc', '1e3', '.5', '1.2.3'])
      expect(parseXlm(bad)).toBeNull()
  })
  it('round-trips to an input value', () => {
    expect(stroopsToInput('105000000')).toBe('10.5')
    expect(stroopsToInput('1')).toBe('0.0000001')
    expect(stroopsToInput('100000000')).toBe('10')
  })
})

describe('walletFundsFromAccount', () => {
  it('subtracts the minimum balance and selling liabilities', () => {
    // (2 + 3 + 1 − 0) × 0.5 XLM = 3 XLM, plus 1 XLM liabilities.
    expect(
      walletFundsFromAccount({
        balance: xlm(100),
        numSubEntries: 3,
        numSponsoring: 1,
        numSponsored: 0,
        sellingLiabilities: xlm(1),
        baseReserve: '5000000',
      })
    ).toEqual({ balance: xlm(100), reserve: xlm(4), spendable: xlm(96) })
  })
  it('never goes below zero', () => {
    expect(
      walletFundsFromAccount({
        balance: xlm(1),
        numSubEntries: 0,
        numSponsoring: 0,
        numSponsored: 0,
        sellingLiabilities: '0',
        baseReserve: '5000000',
      }).spendable
    ).toBe('0')
  })
})

describe('checkDeposit', () => {
  const limits = { minDeposit: xlm(1), maxBalance: xlm(1000) }
  it('applies the contract minimum, the balance cap and the wallet', () => {
    const base = { tabBalance: xlm(995), limits, spendable: xlm(50) }
    expect(checkDeposit({ ...base, amount: null })).toEqual({ kind: 'invalid' })
    expect(checkDeposit({ ...base, amount: '0' })).toEqual({ kind: 'empty' })
    expect(checkDeposit({ ...base, amount: '9999999' })).toEqual({
      kind: 'below-minimum',
      minimum: xlm(1),
    })
    expect(checkDeposit({ ...base, amount: xlm(6) })).toEqual({
      kind: 'above-cap',
      room: xlm(5),
    })
    expect(checkDeposit({ ...base, amount: xlm(5) })).toBeNull()
    // Exactly the minimum deposit passes; one stroop below it does not.
    expect(checkDeposit({ ...base, amount: xlm(1) })).toBeNull()
    expect(checkDeposit({ ...base, tabBalance: '0', amount: xlm(51) })).toEqual(
      { kind: 'above-spendable', spendable: xlm(50) }
    )
  })
  it('leaves unknown limits to the simulation', () => {
    expect(
      checkDeposit({
        amount: '1',
        tabBalance: '0',
        limits: null,
        spendable: null,
      })
    ).toBeNull()
  })
  it('gives the largest deposit that passes', () => {
    expect(
      maxDeposit({ tabBalance: xlm(990), limits, spendable: xlm(50) })
    ).toBe(xlm(10))
    expect(maxDeposit({ tabBalance: '0', limits: null, spendable: null })).toBe(
      null
    )
  })
})

describe('depositRange', () => {
  const limits = { minDeposit: xlm(1), maxBalance: xlm(1000) }
  it('states the range the form accepts', () => {
    expect(
      depositRange({ tabBalance: xlm(990), limits, spendable: xlm(50) })
    ).toEqual({ kind: 'range', min: xlm(1), max: xlm(10) })
    expect(
      depositRange({ tabBalance: '0', limits: null, spendable: null })
    ).toBe(null)
  })
  it('says why when no amount can pass, never an inverted range', () => {
    expect(
      depositRange({ tabBalance: '0', limits, spendable: '5000000' })
    ).toEqual({ kind: 'wallet-short', min: xlm(1), spendable: '5000000' })
    expect(
      depositRange({ tabBalance: '0', limits, spendable: xlm(1) })
    ).toMatchObject({ kind: 'range', max: xlm(1) })
    expect(
      depositRange({ tabBalance: '9995000000', limits, spendable: xlm(50) })
    ).toEqual({ kind: 'tab-full', min: xlm(1), room: '5000000' })
    expect(
      depositRange({ tabBalance: xlm(1001), limits, spendable: null })
    ).toEqual({ kind: 'tab-full', min: xlm(1), room: '0' })
  })
})

describe('unit helpers', () => {
  it('adds, subtracts without going negative, and tests positivity', () => {
    expect(addUnits('1', '2')).toBe('3')
    expect(subtractUnits('1', '2')).toBe('0')
    expect(isPositive('0')).toBe(false)
    expect(isPositive('12')).toBe(true)
    expect(isPositive(null)).toBe(false)
  })
})
