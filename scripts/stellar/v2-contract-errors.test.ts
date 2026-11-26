/**
 * Contract errors decoded with the contract that raised them, over failures
 * recorded on a local standalone network (fixtures/contract-errors.json,
 * written by scripts/integration/contract-errors.test.ts). Core, the Stellar
 * Asset Contract and the article NFT share error numbers.
 */
import { xdr } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import {
  describeContractFailure,
  raisingContract,
  type ContractKind,
  type KnownContracts,
} from '../../lib/stellar/v2/errors'
import {
  contractErrorEvent,
  describeTransactionFailure,
  needsMoreXlm,
} from '../../lib/stellar/v2/failure-events'
import recorded from './fixtures/contract-errors.json'

const CONTRACTS = recorded.contracts as Required<KnownContracts>
const GENERIC = 'Stellar testnet refused the transaction. Nothing was sent.'

const parsed = (events: string[]) =>
  events.map((e) => xdr.DiagnosticEvent.fromXDR(e, 'base64'))

function simulation(label: string) {
  const s = recorded.simulations.find((x) => x.case === label)
  if (!s) throw new Error(`no recorded case: ${label}`)
  return s
}

function decode(label: string, contracts: KnownContracts = CONTRACTS) {
  const s = simulation(label)
  return describeContractFailure(s.error, {
    raisedBy: raisingContract(parsed(s.events)),
    contracts,
  })
}

const EXPECTED: Record<string, { contract: ContractKind; name: string }> = {
  'core tip repeats a client_ref': {
    contract: 'core',
    name: 'DuplicateClientRef',
  },
  'core tip below the minimum': { contract: 'core', name: 'BelowMinimum' },
  'core tip above the tipper balance': {
    contract: 'token',
    name: 'BalanceError',
  },
  'tab open_session above the reader balance': {
    contract: 'token',
    name: 'BalanceError',
  },
  'tab open_session below the minimum deposit': {
    contract: 'tab',
    name: 'BelowMinimumDeposit',
  },
  'nft mint below the tip threshold': {
    contract: 'nft',
    name: 'BelowThreshold',
  },
}

describe('recorded simulation failures', () => {
  it('covers every recorded case', () => {
    expect(recorded.simulations.map((s) => s.case).sort()).toEqual(
      Object.keys(EXPECTED).sort()
    )
  })

  for (const [label, want] of Object.entries(EXPECTED)) {
    it(`${label}: ${want.contract} ${want.name}`, () => {
      const s = simulation(label)
      expect(raisingContract(parsed(s.events))).toBe(CONTRACTS[want.contract])
      expect(decode(label)).toMatchObject({
        code: s.code,
        contract: want.contract,
        name: want.name,
      })
    })
  }

  it('tells the token balance error from Core #10', () => {
    const token = decode('core tip above the tipper balance')
    const core = decode('core tip repeats a client_ref')
    expect([token.code, core.code]).toEqual([10, 10])
    expect(token.message).toMatch(/enough testnet XLM/)
    expect(core.message).toBe('This tip was already sent.')
    expect(needsMoreXlm(token)).toBe(true)
    expect(needsMoreXlm(core)).toBe(false)
  })

  it('reads the same token error under Tab', () => {
    const info = decode('tab open_session above the reader balance')
    expect(needsMoreXlm(info)).toBe(true)
    expect(info.message).not.toMatch(/deposit/i)
  })

  it('reads NFT #70 after nested Core calls that succeed', () => {
    const s = simulation('nft mint below the tip threshold')
    const events = parsed(s.events)
    // Core's fn_return events come first; they carry no error.
    expect(raisingContract(events.slice(0, 5))).toBeNull()
    expect(raisingContract(events)).toBe(CONTRACTS.nft)
  })

  it('is generic when the raising contract is not configured', () => {
    // A tip flow that knows only Core: the token's #10 is not read as Core's.
    expect(
      decode('core tip above the tipper balance', { core: CONTRACTS.core })
    ).toMatchObject({ code: 10, name: null, contract: null, message: GENERIC })
    // No events at all.
    const s = simulation('core tip above the tipper balance')
    expect(describeContractFailure(s.error)).toMatchObject({
      code: 10,
      name: null,
      message: GENERIC,
    })
  })
})

describe('recorded transaction result', () => {
  const result = recorded.results[0]!

  it('has no contract code in the result XDR', () => {
    const res = xdr.TransactionResult.fromXDR(result.resultXdr, 'base64')
    const text = JSON.stringify(res.toJSON())
    expect(text).not.toMatch(/"contract"\s*:\s*10/)
    expect(text).toMatch(/trapped/i)
  })

  it('reads the code and raising contract from the diagnostic events', () => {
    expect(contractErrorEvent(result.events)).toEqual({
      contractId: CONTRACTS.token,
      code: 10,
    })
    expect(contractErrorEvent(parsed(result.events))).toEqual({
      contractId: CONTRACTS.token,
      code: 10,
    })
    const info = describeTransactionFailure(result.events, CONTRACTS)
    expect(info).toMatchObject({
      code: 10,
      contract: 'token',
      name: 'BalanceError',
    })
    expect(needsMoreXlm(info)).toBe(true)
  })

  it('is generic without the token contract or without events', () => {
    expect(
      describeTransactionFailure(result.events, { core: CONTRACTS.core })
    ).toMatchObject({ code: 10, contract: null, name: null, message: GENERIC })
    expect(describeTransactionFailure([], CONTRACTS)).toMatchObject({
      code: null,
      contract: null,
      message: GENERIC,
    })
    expect(describeTransactionFailure(['not xdr', null], CONTRACTS)).toEqual(
      describeTransactionFailure([], CONTRACTS)
    )
  })
})

describe('needsMoreXlm', () => {
  it('is true for a fee the wallet cannot pay', () => {
    expect(needsMoreXlm(describeContractFailure('txInsufficientBalance'))).toBe(
      true
    )
  })

  it('is false for a code that is not the token contract’s', () => {
    expect(
      needsMoreXlm({
        code: 10,
        name: 'BalanceError',
        contract: 'core',
        message: '',
      })
    ).toBe(false)
  })
})
