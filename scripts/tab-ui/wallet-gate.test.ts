import { describe, expect, test } from 'vitest'
import {
  tabWalletGate,
  type TabWalletInput,
} from '../../lib/tab-ui/wallet-gate'

const TESTNET = 'Test SDF Network ; September 2015'
const PUBLIC = 'Public Global Stellar Network ; September 2015'
const LINKED = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const OTHER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

function input(
  overrides: Partial<Omit<TabWalletInput, 'wallet'>> & {
    wallet?: Partial<TabWalletInput['wallet']>
  } = {}
): TabWalletInput {
  const { wallet, ...rest } = overrides
  return {
    authLoading: false,
    signedIn: true,
    verified: LINKED,
    passphrase: TESTNET,
    ...rest,
    wallet: {
      isLoading: false,
      isInstalled: true,
      isConnected: true,
      errorKind: null,
      publicKey: LINKED,
      networkReported: true,
      networkPassphrase: TESTNET,
      ...wallet,
    },
  }
}

describe('tab wallet gate (#582)', () => {
  test('the linked account, connected on testnet: ready', () => {
    expect(tabWalletGate(input())).toEqual({ kind: 'ready' })
  })

  test('a verified linked address and another account: switch to the linked address, not the link step', () => {
    expect(tabWalletGate(input({ wallet: { publicKey: OTHER } }))).toEqual({
      kind: 'other-account',
      linked: LINKED,
      address: OTHER,
    })
  })

  test('no verified linked address: the link step for the connected account', () => {
    expect(
      tabWalletGate(input({ verified: null, wallet: { publicKey: OTHER } }))
    ).toEqual({ kind: 'unverified', address: OTHER })
  })

  test('no verified linked address and no address read yet: the link step', () => {
    expect(
      tabWalletGate(input({ verified: null, wallet: { publicKey: null } }))
    ).toEqual({ kind: 'unverified' })
  })

  test('a linked address but no address read from the wallet: the link step, as before', () => {
    expect(tabWalletGate(input({ wallet: { publicKey: null } }))).toEqual({
      kind: 'unverified',
    })
  })

  test('the earlier states keep their order', () => {
    expect(tabWalletGate(input({ authLoading: true }))).toEqual({
      kind: 'checking',
    })
    expect(tabWalletGate(input({ signedIn: false }))).toEqual({
      kind: 'signed-out',
    })
    expect(tabWalletGate(input({ wallet: { isLoading: true } }))).toEqual({
      kind: 'checking',
    })
    expect(
      tabWalletGate(
        input({ wallet: { errorKind: 'locked', publicKey: OTHER } })
      )
    ).toEqual({ kind: 'locked' })
    expect(
      tabWalletGate(
        input({ wallet: { isConnected: false, isInstalled: false } })
      )
    ).toEqual({ kind: 'no-wallet' })
    expect(tabWalletGate(input({ wallet: { isConnected: false } }))).toEqual({
      kind: 'disconnected',
    })
    // Another network is named before another account.
    expect(
      tabWalletGate(
        input({ wallet: { networkPassphrase: PUBLIC, publicKey: OTHER } })
      )
    ).toEqual({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
  })
})
