import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as StellarSdkModule from '@stellar/stellar-sdk'
import type { Operation } from '@stellar/stellar-sdk'

const CLIENT_CONFIG_CONTRACT_ID =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const SERVER_QUOTE_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015'
const MINIMUM_TIP_STROOPS = 420_000
const SIGNED_XDR =
  'AAAAAgAAAADqSmxj4pxSCr71UHsTLsX5lUd2rr6+e5JCHuppFEbSLAAAAGQAAAAAAAAAAQAAAAEAAAAAB1vNFQAAAAB3NZQAAAAAAAAAAAEAAAAAAAAACgAAAA1xdWlsbHRpcC1oYXNoAAAAAAAAAQAAAAZzaWduZWQAAAAAAAAAAAABFEbSLAAAAEBuhftuewiagdc4PlrYnICsjbJzL/63iooqOyH6fsMqRM6Ih35YiJK+1lo9FtPGUThbPbDHiM56/3TojZ6f2AsG'
const TESTNET_TRANSACTION_HASH =
  '49cf1e201e95bf3c088a834b30e71592bec59491bb4e01f48d61707fdb95cc79'

vi.mock('@/lib/stellar/config', () => ({
  STELLAR_CONFIG: {
    NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: TEST_PASSPHRASE,
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    TIPPING_CONTRACT_ID: CLIENT_CONFIG_CONTRACT_ID,
    PLATFORM_FEE_BPS: 250,
    MINIMUM_TIP_STROOPS,
    XLM_TO_USD_RATE: 0.25,
  },
}))

type StellarSdk = typeof StellarSdkModule
type InvokeHostFunctionOperation = Extract<
  Operation,
  { type: 'invokeHostFunction' }
>

function readInvocation(StellarSdk: StellarSdk, xdr: string) {
  const decoded = StellarSdk.TransactionBuilder.fromXDR(xdr, TEST_PASSPHRASE)
  const operation = decoded.operations[0] as
    | InvokeHostFunctionOperation
    | undefined
  expect(operation?.type).toBe('invokeHostFunction')

  const invocation = operation?.func.invokeContract()
  if (!invocation) throw new Error('Missing invoke contract call')
  return invocation
}

describe('StellarClient highlight transaction builder', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encodes only the server quote fields without converting cents or recomputing identifiers', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')
    const tipper = StellarSdk.Keypair.random().publicKey()
    const author = StellarSdk.Keypair.random().publicKey()
    const fakeAccount = new StellarSdk.Account(tipper, '0')

    vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    ).mockResolvedValue(fakeAccount as never)
    vi.spyOn(
      StellarSdk.rpc.Server.prototype,
      'prepareTransaction'
    ).mockImplementation(async (transaction) => transaction as never)

    const client = new StellarClient()
    const priceLookup = vi.spyOn(client, 'convertCentsToStroops')
    const serverQuoteWithLegacyClientFields = {
      highlightId: 'server-highlight-id',
      articleSymbol: 'server1234',
      authorAddress: author,
      amountStroops: 12_345_678,
      contractId: SERVER_QUOTE_CONTRACT_ID,
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
      articleId: 'client-controlled-article-id',
      amountCents: 100,
    }
    const result = await client.buildHighlightTipTransaction(
      tipper,
      serverQuoteWithLegacyClientFields
    )

    expect(priceLookup).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      stroops: 12_345_678,
      authorReceived: 12_037_037,
      platformFee: 308_641,
    })

    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      result.xdr,
      StellarSdk.Networks.TESTNET
    )
    if (!(transaction instanceof StellarSdk.Transaction)) {
      throw new Error('Expected a normal Stellar transaction')
    }
    expect(transaction.memo.type).toBe('none')
    expect(transaction.timeBounds).toEqual({
      minTime: '123456789',
      maxTime: '2000000000',
    })

    const invocation = readInvocation(StellarSdk, result.xdr)
    expect(
      StellarSdk.Address.fromScAddress(invocation.contractAddress()).toString()
    ).toBe(SERVER_QUOTE_CONTRACT_ID)
    expect(Buffer.from(invocation.functionName()).toString()).toBe(
      'tip_highlight_direct'
    )
    expect(invocation.args()).toHaveLength(5)
    expect(StellarSdk.scValToNative(invocation.args()[0]!)).toBe(tipper)
    expect(StellarSdk.scValToNative(invocation.args()[1]!)).toBe(
      'server-highlight-id'
    )
    expect(StellarSdk.scValToNative(invocation.args()[2]!)).toBe('server1234')
    expect(StellarSdk.scValToNative(invocation.args()[3]!)).toBe(author)
    expect(StellarSdk.scValToNative(invocation.args()[4]!)).toBe(
      BigInt(12_345_678)
    )
  })

  it('rejects a trusted amount below the contract minimum before loading an account', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')
    const loadAccount = vi
      .spyOn(StellarSdk.Horizon.Server.prototype, 'loadAccount')
      .mockRejectedValue(new Error('account should not be loaded'))
    const legacyCompatibleParams = {
      highlightId: 'server-highlight-id',
      articleSymbol: 'server1234',
      authorAddress: StellarSdk.Keypair.random().publicKey(),
      amountStroops: MINIMUM_TIP_STROOPS - 1,
      contractId: SERVER_QUOTE_CONTRACT_ID,
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
      articleId: 'client-controlled-article-id',
      amountCents: 100,
    }

    await expect(
      new StellarClient().buildHighlightTipTransaction(
        StellarSdk.Keypair.random().publicKey(),
        legacyCompatibleParams
      )
    ).rejects.toThrow('Invalid trusted highlight tip amount')
    expect(loadAccount).not.toHaveBeenCalled()
  })

  it('derives the deterministic transaction hash from the exact signed XDR on the configured network', async () => {
    const { StellarClient } = await import('@/lib/stellar/client')

    await expect(
      new StellarClient().deriveTipTransactionHash(SIGNED_XDR)
    ).resolves.toBe(TESTNET_TRANSACTION_HASH)
  })

  it('rebroadcasts the same signed XDR after an ambiguous response and accepts DUPLICATE idempotently', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')
    const sendTransaction = vi
      .spyOn(StellarSdk.rpc.Server.prototype, 'sendTransaction')
      .mockRejectedValueOnce(new Error('RPC response lost'))
      .mockResolvedValueOnce({
        status: 'DUPLICATE',
        hash: TESTNET_TRANSACTION_HASH,
        latestLedger: 123,
        latestLedgerCloseTime: 456,
      } as never)
    const client = new StellarClient()

    await expect(client.submitTipTransaction(SIGNED_XDR)).rejects.toThrow(
      'RPC response lost'
    )
    await expect(client.submitTipTransaction(SIGNED_XDR)).resolves.toEqual({
      transactionHash: TESTNET_TRANSACTION_HASH,
    })
    expect(sendTransaction).toHaveBeenCalledTimes(2)
    expect(sendTransaction.mock.calls[0]?.[0].toXDR()).toBe(SIGNED_XDR)
    expect(sendTransaction.mock.calls[1]?.[0].toXDR()).toBe(SIGNED_XDR)
  })
})
