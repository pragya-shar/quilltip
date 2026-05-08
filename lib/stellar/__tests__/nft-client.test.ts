import { describe, it, expect, vi, afterEach } from 'vitest'

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
  })
})
