// The types entry avoids loading wallet modules that need a browser.
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAINNET_PASSPHRASE,
  StellarNetworkConfigError,
  TESTNET_PASSPHRASE,
  parseStellarNetwork,
  resolveStellarNetwork,
  stellarExpertTransactionUrl,
} from '../../lib/stellar/network'

describe('parseStellarNetwork', () => {
  it('defaults an unset or blank value to TESTNET', () => {
    expect(parseStellarNetwork(undefined)).toBe('TESTNET')
    expect(parseStellarNetwork('')).toBe('TESTNET')
    expect(parseStellarNetwork('  ')).toBe('TESTNET')
  })

  it('accepts TESTNET and MAINNET', () => {
    expect(parseStellarNetwork('TESTNET')).toBe('TESTNET')
    expect(parseStellarNetwork(' MAINNET ')).toBe('MAINNET')
  })

  it('rejects PUBLIC so one mainnet name is used everywhere', () => {
    expect(() => parseStellarNetwork('PUBLIC')).toThrow(/Use MAINNET/)
    expect(() => parseStellarNetwork('public')).toThrow(
      StellarNetworkConfigError
    )
  })

  it('rejects unknown values', () => {
    expect(() => parseStellarNetwork('FUTURENET')).toThrow(
      /must be TESTNET or MAINNET/
    )
    expect(() => parseStellarNetwork('testnet')).toThrow(
      StellarNetworkConfigError
    )
  })
})

describe('resolveStellarNetwork', () => {
  it('maps TESTNET to wallet network, passphrase, Horizon, and RPC', () => {
    expect(resolveStellarNetwork({ network: 'TESTNET' })).toEqual({
      network: 'TESTNET',
      walletNetwork: 'TESTNET',
      passphrase: TESTNET_PASSPHRASE,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerSegment: 'testnet',
    })
  })

  it('maps an unset network to TESTNET defaults', () => {
    expect(resolveStellarNetwork({}).network).toBe('TESTNET')
  })

  it('maps MAINNET to the PUBLIC wallet network and mainnet passphrase', () => {
    expect(
      resolveStellarNetwork({
        network: 'MAINNET',
        rpcUrl: 'https://rpc.example.org',
      })
    ).toEqual({
      network: 'MAINNET',
      walletNetwork: 'PUBLIC',
      passphrase: MAINNET_PASSPHRASE,
      horizonUrl: 'https://horizon.stellar.org',
      rpcUrl: 'https://rpc.example.org',
      explorerSegment: 'public',
    })
  })

  it('requires an explicit RPC URL on MAINNET', () => {
    expect(() => resolveStellarNetwork({ network: 'MAINNET' })).toThrow(
      /no default Soroban RPC URL/
    )
  })

  it('uses Horizon and RPC overrides', () => {
    const resolved = resolveStellarNetwork({
      network: 'TESTNET',
      horizonUrl: 'http://localhost:8000',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
    })
    expect(resolved.horizonUrl).toBe('http://localhost:8000')
    expect(resolved.rpcUrl).toBe('http://localhost:8000/soroban/rpc')
  })

  it('rejects a passphrase that does not match the network', () => {
    expect(() =>
      resolveStellarNetwork({
        network: 'TESTNET',
        passphrase: MAINNET_PASSPHRASE,
      })
    ).toThrow(/does not match TESTNET/)
    expect(() =>
      resolveStellarNetwork({
        network: 'MAINNET',
        passphrase: TESTNET_PASSPHRASE,
        rpcUrl: 'https://rpc.example.org',
      })
    ).toThrow(/does not match MAINNET/)
  })

  it('maps each wallet network key to the wallets kit enum value', () => {
    const testnet = resolveStellarNetwork({ network: 'TESTNET' })
    const mainnet = resolveStellarNetwork({
      network: 'MAINNET',
      rpcUrl: 'https://rpc.example.org',
    })
    expect(WalletNetwork[testnet.walletNetwork]).toBe(testnet.passphrase)
    expect(WalletNetwork[mainnet.walletNetwork]).toBe(mainnet.passphrase)
  })

  it('builds explorer links per network', () => {
    expect(stellarExpertTransactionUrl('TESTNET', 'abc')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abc'
    )
    expect(stellarExpertTransactionUrl('MAINNET', 'abc')).toBe(
      'https://stellar.expert/explorer/public/tx/abc'
    )
  })
})

describe('STELLAR_CONFIG', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadConfig(env: Record<string, string>) {
    vi.resetModules()
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    return (await import('../../lib/stellar/config')).STELLAR_CONFIG
  }

  it('reads the network from NEXT_PUBLIC_* values', async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
      NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
      NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    })
    expect(config.NETWORK).toBe('TESTNET')
    expect(config.WALLET_NETWORK).toBe('TESTNET')
    expect(config.NETWORK_PASSPHRASE).toBe(TESTNET_PASSPHRASE)
  })

  it('selects the PUBLIC wallet network for MAINNET', async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET',
      NEXT_PUBLIC_NETWORK_PASSPHRASE: '',
      NEXT_PUBLIC_HORIZON_URL: '',
      NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.example.org',
    })
    expect(config.WALLET_NETWORK).toBe('PUBLIC')
    expect(config.NETWORK_PASSPHRASE).toBe(MAINNET_PASSPHRASE)
    expect(config.HORIZON_URL).toBe('https://horizon.stellar.org')
  })

  it('fails at load for NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC', async () => {
    await expect(
      loadConfig({ NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC' })
    ).rejects.toThrow(/Use MAINNET/)
  })
})
