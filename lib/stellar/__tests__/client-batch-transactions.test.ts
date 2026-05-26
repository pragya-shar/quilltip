import { createHash } from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as StellarSdkModule from '@stellar/stellar-sdk'
import type { Operation, xdr as StellarXdr } from '@stellar/stellar-sdk'

const TEST_CONTRACT_ID =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015'

vi.mock('@/lib/stellar/config', () => ({
  STELLAR_CONFIG: {
    NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: TEST_PASSPHRASE,
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    TIPPING_CONTRACT_ID: TEST_CONTRACT_ID,
    PLATFORM_FEE_BPS: 250,
    MINIMUM_TIP_STROOPS: 100_000,
    XLM_TO_USD_RATE: 0.25,
  },
}))

type StellarSdk = typeof StellarSdkModule
type InvokeHostFunctionOperation = Extract<
  Operation,
  { type: 'invokeHostFunction' }
>

function shortArticleIdForTest(articleId: string): string {
  return createHash('sha256').update(articleId).digest('hex').slice(0, 10)
}

function getInvokeContractCall(StellarSdk: StellarSdk, xdr: string) {
  const decoded = StellarSdk.TransactionBuilder.fromXDR(xdr, TEST_PASSPHRASE)
  const operation = decoded.operations[0] as
    | InvokeHostFunctionOperation
    | undefined

  expect(operation).toBeDefined()
  expect(operation?.type).toBe('invokeHostFunction')

  const invocation = operation?.func.invokeContract()
  expect(invocation).toBeDefined()
  if (!invocation) throw new Error('Missing invoke contract call')

  return {
    functionName: Buffer.from(invocation.functionName()).toString(),
    args: invocation.args(),
  }
}

function scMapToNativeEntries(StellarSdk: StellarSdk, scMap: StellarXdr.ScVal) {
  const entries = scMap.map()

  expect(entries).not.toBeNull()
  if (!entries) throw new Error('Expected ScVal map entries')

  return Object.fromEntries(
    entries.map((entry) => {
      const key = entry.key()
      const value = entry.val()

      return [
        StellarSdk.scValToNative(key),
        {
          type:
            typeof value === 'object' &&
            value !== null &&
            'switch' in value &&
            typeof value.switch === 'function'
              ? value.switch().name
              : undefined,
          value: StellarSdk.scValToNative(value),
        },
      ]
    })
  )
}

describe('StellarClient batch transaction builders', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds article batch_tip XDR with expected argument layout and totals', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')

    const tipperKeypair = StellarSdk.Keypair.random()
    const authorOne = StellarSdk.Keypair.random().publicKey()
    const authorTwo = StellarSdk.Keypair.random().publicKey()
    const tipperPublicKey = tipperKeypair.publicKey()
    const fakeAccount = new StellarSdk.Account(tipperPublicKey, '0')

    vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    ).mockResolvedValue(fakeAccount as unknown as never)

    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'prepareTransaction'
    ).mockImplementation(async (tx) => tx as never)

    const client = new StellarClient()
    vi.spyOn(client, 'convertCentsToStroops').mockImplementation(
      async (cents) => {
        if (cents === 100) return 100_000_000
        if (cents === 250) return 250_000_000
        throw new Error(`unexpected cents: ${cents}`)
      }
    )

    const result = await client.buildArticleBatchTipTransaction(
      tipperPublicKey,
      [
        {
          articleId: 'article-one',
          authorAddress: authorOne,
          amountCents: 100,
        },
        {
          articleId: 'article-two',
          authorAddress: authorTwo,
          amountCents: 250,
        },
      ]
    )

    expect(result.stroops).toBe(350_000_000)
    expect(result.authorReceived).toBe(341_250_000)
    expect(result.platformFee).toBe(8_750_000)
    expect(result.items).toEqual([
      {
        articleId: 'article-one',
        authorAddress: authorOne,
        amountCents: 100,
        stroops: 100_000_000,
        authorReceived: 97_500_000,
        platformFee: 2_500_000,
      },
      {
        articleId: 'article-two',
        authorAddress: authorTwo,
        amountCents: 250,
        stroops: 250_000_000,
        authorReceived: 243_750_000,
        platformFee: 6_250_000,
      },
    ])

    const call = getInvokeContractCall(StellarSdk, result.xdr)
    expect(call.functionName).toBe('batch_tip')
    expect(call.args).toHaveLength(2)

    const tipperArg = call.args[0]
    const tipsArg = call.args[1]
    if (!tipperArg || !tipsArg) throw new Error('Missing batch call arguments')

    expect(tipperArg.switch().name).toBe('scvAddress')
    expect(StellarSdk.scValToNative(tipperArg)).toBe(tipperPublicKey)
    expect(tipsArg.switch().name).toBe('scvVec')

    const tips = tipsArg.vec()
    if (!tips) throw new Error('Missing article batch tip vector')
    expect(tips).toHaveLength(2)

    const firstTip = tips[0]
    const secondTip = tips[1]
    if (!firstTip || !secondTip) throw new Error('Missing article batch tips')

    expect(scMapToNativeEntries(StellarSdk, firstTip)).toEqual({
      amount: { type: 'scvI128', value: BigInt(100_000_000) },
      article_id: {
        type: 'scvSymbol',
        value: shortArticleIdForTest('article-one'),
      },
      author: { type: 'scvAddress', value: authorOne },
    })

    expect(scMapToNativeEntries(StellarSdk, secondTip)).toEqual({
      amount: { type: 'scvI128', value: BigInt(250_000_000) },
      article_id: {
        type: 'scvSymbol',
        value: shortArticleIdForTest('article-two'),
      },
      author: { type: 'scvAddress', value: authorTwo },
    })
  }, 15_000)

  it('builds batch_tip_highlights XDR with expected argument layout and totals', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')

    const tipperKeypair = StellarSdk.Keypair.random()
    const author = StellarSdk.Keypair.random().publicKey()
    const tipperPublicKey = tipperKeypair.publicKey()
    const fakeAccount = new StellarSdk.Account(tipperPublicKey, '0')

    vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    ).mockResolvedValue(fakeAccount as unknown as never)

    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'prepareTransaction'
    ).mockImplementation(async (tx) => tx as never)

    const client = new StellarClient()
    vi.spyOn(client, 'convertCentsToStroops').mockResolvedValue(125_000_000)

    const result = await client.buildHighlightBatchTipTransaction(
      tipperPublicKey,
      [
        {
          highlightId: 'highlight-123',
          articleId: 'article-one',
          authorAddress: author,
          amountCents: 125,
        },
      ]
    )

    expect(result.stroops).toBe(125_000_000)
    expect(result.authorReceived).toBe(121_875_000)
    expect(result.platformFee).toBe(3_125_000)
    expect(result.items).toEqual([
      {
        highlightId: 'highlight-123',
        articleId: 'article-one',
        authorAddress: author,
        amountCents: 125,
        stroops: 125_000_000,
        authorReceived: 121_875_000,
        platformFee: 3_125_000,
      },
    ])

    const call = getInvokeContractCall(StellarSdk, result.xdr)
    expect(call.functionName).toBe('batch_tip_highlights')
    expect(call.args).toHaveLength(2)

    const tipperArg = call.args[0]
    const tipsArg = call.args[1]
    if (!tipperArg || !tipsArg) throw new Error('Missing batch call arguments')

    expect(tipperArg.switch().name).toBe('scvAddress')
    expect(StellarSdk.scValToNative(tipperArg)).toBe(tipperPublicKey)
    expect(tipsArg.switch().name).toBe('scvVec')

    const tips = tipsArg.vec()
    if (!tips) throw new Error('Missing highlight batch tip vector')
    expect(tips).toHaveLength(1)

    const firstTip = tips[0]
    if (!firstTip) throw new Error('Missing highlight batch tip')

    expect(scMapToNativeEntries(StellarSdk, firstTip)).toEqual({
      amount: { type: 'scvI128', value: BigInt(125_000_000) },
      article_id: {
        type: 'scvSymbol',
        value: shortArticleIdForTest('article-one'),
      },
      author: { type: 'scvAddress', value: author },
      highlight_id: { type: 'scvString', value: 'highlight-123' },
    })
  }, 15_000)

  it('rejects invalid batch sizes before loading the source account', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')

    const loadAccountSpy = vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    )

    const client = new StellarClient()
    const tipperPublicKey = StellarSdk.Keypair.random().publicKey()
    const authorAddress = StellarSdk.Keypair.random().publicKey()

    await expect(
      client.buildArticleBatchTipTransaction(tipperPublicKey, [])
    ).rejects.toThrow('Batch must include at least one tip')

    await expect(
      client.buildHighlightBatchTipTransaction(
        tipperPublicKey,
        Array.from({ length: 11 }, (_, index) => ({
          highlightId: `highlight-${index}`,
          articleId: `article-${index}`,
          authorAddress,
          amountCents: 100,
        }))
      )
    ).rejects.toThrow('Batch cannot include more than 10 tips')

    expect(loadAccountSpy).not.toHaveBeenCalled()
  })
})
