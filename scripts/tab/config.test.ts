import { Networks } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import shared from '../../contracts/shared/test-vectors.json'
import {
  defaultTabSigningDeps,
  isTabClientError,
  tabConfig,
  tabScope,
} from '../../lib/stellar/v2/tab'

const TAB = shared.tab_contract
const READER = shared.vouchers[0]!.reader

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('tab configuration', () => {
  it('maps the v2 passphrase and Tab contract id', () => {
    const config = { passphrase: Networks.TESTNET, tabContractId: TAB }
    expect(tabConfig(config)).toEqual({
      networkPassphrase: Networks.TESTNET,
      tabContractId: TAB,
    })
    expect(tabScope(READER, config)).toEqual({
      tabContractId: TAB,
      readerAddress: READER,
    })
  })

  it('refuses to run without a Tab contract', () => {
    let error: unknown
    try {
      tabConfig({ passphrase: Networks.TESTNET, tabContractId: null })
    } catch (e) {
      error = e
    }
    expect(isTabClientError(error) && error.code).toBe('NOT_CONFIGURED')
  })

  it('reads v2Config() by default', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE', Networks.TESTNET)
    vi.stubEnv('NEXT_PUBLIC_TAB_CONTRACT_ID', TAB)
    vi.resetModules()
    const tab = await import('../../lib/stellar/v2/tab')
    expect(tab.tabConfig()).toEqual({
      networkPassphrase: Networks.TESTNET,
      tabContractId: TAB,
    })
    const deps = tab.defaultTabSigningDeps({ readerAddress: READER })
    expect(deps.networkPassphrase).toBe(Networks.TESTNET)
    expect(deps.tabContractId).toBe(TAB)
    expect(deps.readerAddress).toBe(READER)
  })

  it('takes an explicit config in place of v2Config()', () => {
    const deps = defaultTabSigningDeps({
      readerAddress: READER,
      maxAmount: 5n,
      config: { passphrase: Networks.TESTNET, tabContractId: TAB },
    })
    expect(deps).toMatchObject({
      networkPassphrase: Networks.TESTNET,
      tabContractId: TAB,
      readerAddress: READER,
      maxAmount: 5n,
    })
  })
})
