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
})
