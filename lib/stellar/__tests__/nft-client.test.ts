import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { StellarFlowEvent } from '@/lib/stellar/stellar-flow-emitter'

const TEST_CONTRACT_ID =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015'

vi.mock('@/lib/stellar/config', () => ({
  STELLAR_CONFIG: {
    NETWORK_PASSPHRASE: TEST_PASSPHRASE,
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NFT_CONTRACT_ID: TEST_CONTRACT_ID,
    NFT_TIP_THRESHOLD_STROOPS: 100_000_000,
  },
}))

describe('NFTClient.buildMintTransaction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('produces a Soroban transaction with no memo', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { NFTClient } = await import('@/lib/stellar/nft-client')

    const authorKeypair = StellarSdk.Keypair.random()
    const authorPublicKey = authorKeypair.publicKey()
    const fakeAccount = new StellarSdk.Account(authorPublicKey, '0')

    vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    ).mockResolvedValue(fakeAccount as unknown as never)

    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'prepareTransaction'
    ).mockImplementation(async (tx) => tx as never)

    const client = new NFTClient()
    const { xdr } = await client.buildMintTransaction(authorPublicKey, {
      authorAddress: authorPublicKey,
      articleId: 'test_article',
      tipAmount: 100_000_000,
      metadataUrl: 'https://example.com/meta.json',
    })

    const decoded = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      TEST_PASSPHRASE
    ) as InstanceType<typeof StellarSdk.Transaction>

    expect(decoded.memo.type).toBe('none')
  }, 15_000)
})

describe('NFTClient.submitMintTransaction', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    const { stellarFlowEmitter } =
      await import('@/lib/stellar/stellar-flow-emitter')
    emitSpy = vi.spyOn(stellarFlowEmitter, 'emit')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits nft_mint submitting then confirming on successful submit', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { NFTClient } = await import('@/lib/stellar/nft-client')

    vi.spyOn(StellarSdk.TransactionBuilder, 'fromXDR').mockReturnValue(
      {} as never
    )
    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'sendTransaction'
    ).mockResolvedValue({ status: 'PENDING', hash: 'testhash' } as never)
    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'getTransaction'
    ).mockResolvedValue({ status: 'SUCCESS', returnValue: undefined } as never)

    const client = new NFTClient()
    const result = await client.submitMintTransaction('AAAAxdr')

    expect(result.success).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith({
      flow: 'nft_mint',
      step: 'submitting',
    })
    expect(emitSpy).toHaveBeenCalledWith({
      flow: 'nft_mint',
      step: 'confirming',
    })
    const asFlow = (c: unknown): StellarFlowEvent | undefined => {
      if (!Array.isArray(c) || c[0] === undefined) return undefined
      return c[0] as StellarFlowEvent
    }
    const submitIdx = emitSpy.mock.calls.findIndex((c: unknown) => {
      const e = asFlow(c)
      return e?.flow === 'nft_mint' && e.step === 'submitting'
    })
    const confirmIdx = emitSpy.mock.calls.findIndex((c: unknown) => {
      const e = asFlow(c)
      return e?.flow === 'nft_mint' && e.step === 'confirming'
    })
    expect(submitIdx).toBeLessThan(confirmIdx)
  })
})
