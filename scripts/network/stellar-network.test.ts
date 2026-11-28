// The types entry avoids loading wallet modules that need a browser.
import { Networks as WalletNetwork } from '@creit.tech/stellar-wallets-kit/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_PASSPHRASE,
  MAINNET_PASSPHRASE,
  StellarNetworkConfigError,
  TESTNET_PASSPHRASE,
  parseStellarNetwork,
  parseStellarNetworkSetting,
  pickRpcUrl,
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

describe('parseStellarNetworkSetting', () => {
  it('accepts LOCAL as a setting but not as a recorded network', () => {
    expect(parseStellarNetworkSetting('LOCAL')).toBe('LOCAL')
    expect(parseStellarNetworkSetting(' TESTNET ')).toBe('TESTNET')
    expect(parseStellarNetworkSetting('')).toBe('TESTNET')
    expect(() => parseStellarNetworkSetting('local')).toThrow(
      StellarNetworkConfigError
    )
    expect(() => parseStellarNetwork('LOCAL')).toThrow(
      StellarNetworkConfigError
    )
  })
})

describe('pickRpcUrl', () => {
  it('reads the current RPC name and the earlier one', () => {
    expect(pickRpcUrl('https://a.example', undefined)).toBe('https://a.example')
    expect(pickRpcUrl(' ', 'https://b.example')).toBe('https://b.example')
    expect(pickRpcUrl('https://a.example', 'https://a.example')).toBe(
      'https://a.example'
    )
    expect(pickRpcUrl(undefined, undefined)).toBeUndefined()
    expect(() => pickRpcUrl('https://a.example', 'https://b.example')).toThrow(
      /both set and differ/
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
      cliNetwork: 'testnet',
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
      cliNetwork: 'mainnet',
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

  it('maps LOCAL to the standalone wallet network, passphrase, and local endpoints', () => {
    expect(resolveStellarNetwork({ network: 'LOCAL' })).toEqual({
      network: 'LOCAL',
      walletNetwork: 'STANDALONE',
      passphrase: LOCAL_PASSPHRASE,
      horizonUrl: 'http://localhost:8000',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      cliNetwork: 'local',
      explorerSegment: null,
    })
    expect(() =>
      resolveStellarNetwork({
        network: 'LOCAL',
        passphrase: TESTNET_PASSPHRASE,
      })
    ).toThrow(/does not match LOCAL/)
  })

  it('maps each wallet network key to the wallets kit enum value', () => {
    const testnet = resolveStellarNetwork({ network: 'TESTNET' })
    const mainnet = resolveStellarNetwork({
      network: 'MAINNET',
      rpcUrl: 'https://rpc.example.org',
    })
    const local = resolveStellarNetwork({ network: 'LOCAL' })
    expect(WalletNetwork[testnet.walletNetwork]).toBe(testnet.passphrase)
    expect(WalletNetwork[mainnet.walletNetwork]).toBe(mainnet.passphrase)
    expect(WalletNetwork[local.walletNetwork]).toBe(local.passphrase)
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

  it('fails at load for MAINNET: the app signs TESTNET transactions only', async () => {
    await expect(
      loadConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET',
        NEXT_PUBLIC_NETWORK_PASSPHRASE: '',
        NEXT_PUBLIC_HORIZON_URL: '',
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.example.org',
      })
    ).rejects.toThrow(/NOT_TESTNET/)
  })

  it('fails at load for a mainnet endpoint on TESTNET', async () => {
    await expect(
      loadConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
        NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
      })
    ).rejects.toThrow(/MAINNET_URL/)
  })

  it('fails at load for NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC', async () => {
    await expect(
      loadConfig({ NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC' })
    ).rejects.toThrow(/Use MAINNET/)
  })

  it('reads NEXT_PUBLIC_STELLAR_RPC_URL and refuses a different earlier RPC value', async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
      NEXT_PUBLIC_STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
      NEXT_PUBLIC_SOROBAN_RPC_URL: '',
    })
    expect(config.SOROBAN_RPC_URL).toBe('https://soroban-testnet.stellar.org')
    await expect(
      loadConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
        NEXT_PUBLIC_STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'http://localhost:8000/soroban/rpc',
      })
    ).rejects.toThrow(/both set and differ/)
  })

  it('fails at load for a mainnet RPC in NEXT_PUBLIC_STELLAR_RPC_URL', async () => {
    await expect(
      loadConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
        NEXT_PUBLIC_SOROBAN_RPC_URL: '',
        NEXT_PUBLIC_STELLAR_RPC_URL: 'https://MAINNET.sorobanrpc.com/',
      })
    ).rejects.toThrow(/MAINNET_URL/)
  })

  it('drives the wallet from LOCAL with a local Convex backend', async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
      NEXT_PUBLIC_NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
      NEXT_PUBLIC_HORIZON_URL: '',
      NEXT_PUBLIC_SOROBAN_RPC_URL: '',
      NEXT_PUBLIC_STELLAR_RPC_URL: 'http://127.0.0.1:8000/soroban/rpc',
      NEXT_PUBLIC_CONVEX_URL: 'http://127.0.0.1:3210',
    })
    expect(config.NETWORK).toBe('LOCAL')
    expect(config.WALLET_NETWORK).toBe('STANDALONE')
    expect(config.NETWORK_PASSPHRASE).toBe(LOCAL_PASSPHRASE)
    expect(config.SOROBAN_RPC_URL).toBe('http://127.0.0.1:8000/soroban/rpc')
  })

  it('fails at load for LOCAL with a Convex cloud URL', async () => {
    await expect(
      loadConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
        NEXT_PUBLIC_NETWORK_PASSPHRASE: '',
        NEXT_PUBLIC_HORIZON_URL: '',
        NEXT_PUBLIC_SOROBAN_RPC_URL: '',
        NEXT_PUBLIC_CONVEX_URL: 'https://efficient-tern-39.convex.cloud',
      })
    ).rejects.toThrow(/LOCAL_CLOUD_CONVEX/)
  })
})
