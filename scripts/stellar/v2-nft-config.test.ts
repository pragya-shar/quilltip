import { StrKey } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Two distinct contract addresses: the v1 NFT and the v2 Article NFT.
const V1_NFT = StrKey.encodeContract(Buffer.alloc(32, 1))
const V2_NFT = StrKey.encodeContract(Buffer.alloc(32, 2))

async function freshConfig() {
  vi.resetModules()
  const { v2Config } = await import('../../lib/stellar/v2/config')
  return v2Config()
}

describe('v2 Article NFT contract variable', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID, never the v1 name', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NFT_CONTRACT_ID', V1_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', V2_NFT)
    expect((await freshConfig()).nftContractId).toBe(V2_NFT)
  })

  it('stays unset when only the v1 name is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NFT_CONTRACT_ID', V1_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', '')
    expect((await freshConfig()).nftContractId).toBeNull()
  })

  it('refuses a v2 Article NFT ID equal to the v1 NFT ID', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NFT_CONTRACT_ID', V2_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', V2_NFT)
    await expect(freshConfig()).rejects.toThrow(/v1 NFT contract/)
  })
})

describe('v1 NFT contract variable', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function v1NftId() {
    vi.resetModules()
    const { STELLAR_CONFIG } = await import('../../lib/stellar/config')
    return STELLAR_CONFIG.NFT_CONTRACT_ID
  }

  it('keeps the v1 ID when the v2 ID differs or is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NFT_CONTRACT_ID', V1_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', V2_NFT)
    expect(await v1NftId()).toBe(V1_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', '')
    expect(await v1NftId()).toBe(V1_NFT)
  })

  it('is unset when it names the v2 Article NFT contract', async () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('NEXT_PUBLIC_NFT_CONTRACT_ID', V2_NFT)
    vi.stubEnv('NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID', V2_NFT)
    expect(await v1NftId()).toBe('')
  })
})
