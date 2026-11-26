/**
 * Checks the event fixtures recorded by the local network integration suite
 * (scripts/integration). Each fixture is one contract event as the RPC returned
 * it. Refresh the file from `event-fixtures.json` in the suite's output folder.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  decodeContractEventXdr,
  parseTippedEvent,
} from '../../convex/lib/chain/events'

type Fixture = {
  transaction: string
  contract: string
  name: string
  xdr: string
}
const recorded = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/v2-local-events.json'), 'utf8')
) as {
  contracts: Record<string, string>
  events: Fixture[]
}

const FEE_BPS = BigInt(250)
const DENOM = BigInt(10_000)

function find(contract: string, name: string) {
  const fixture = recorded.events.find(
    (e) => e.contract === contract && e.name === name
  )
  if (!fixture) throw new Error(`No ${contract}:${name} fixture`)
  return decodeContractEventXdr(fixture.xdr)
}

describe('recorded v2 contract events', () => {
  it('decode to the recorded contract and name', () => {
    for (const e of recorded.events) {
      const decoded = decodeContractEventXdr(e.xdr)
      expect(decoded.name, e.transaction).toBe(e.name)
      expect(decoded.contractId, e.transaction).toBe(
        recorded.contracts[e.contract]
      )
    }
  })

  it('cover the events the indexer reads', () => {
    const names = new Set(recorded.events.map((e) => `${e.contract}:${e.name}`))
    for (const required of [
      'core:article_registered',
      'core:tipped',
      'core:paused',
      'core:unpaused',
      'core:migrated',
      'tab:deposited',
      'tab:key_registered',
      'tab:tab_settled',
      'tab:claimed',
      'tab:withdraw_started',
      'tab:withdraw_cancelled',
      'nft:article_nft_minted',
    ]) {
      expect(names.has(required), required).toBe(true)
    }
  })

  it('split a tip 97.5% / 2.5% to the stroop', () => {
    const tipped = parseTippedEvent(find('core', 'tipped'))
    expect(tipped).not.toBeNull()
    expect(tipped!.fee).toBe((tipped!.gross * FEE_BPS) / DENOM)
    expect(tipped!.net + tipped!.fee).toBe(tipped!.gross)
    expect(tipped!.token).toBe(recorded.contracts.token)
  })

  it('split a settlement 97.5% / 2.5% to the stroop', () => {
    const data = find('tab', 'tab_settled').data as Record<string, bigint>
    expect(data.fee).toBe((data.gross! * FEE_BPS) / DENOM)
    expect(data.paid_after! >= data.gross!).toBe(true)
  })
})
