import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as StellarSdkModule from '@stellar/stellar-sdk'
import type { Operation } from '@stellar/stellar-sdk'

const CLIENT_CONFIG_CONTRACT_ID =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const SERVER_QUOTE_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015'
const MINIMUM_TIP_STROOPS = 420_000

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

describe('StellarClient single-article transaction builder', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encodes only the server quote fields without looking up a browser price', async () => {
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
    ).mockImplementation(async (transaction) => {
      if (!(transaction instanceof StellarSdk.Transaction)) {
        throw new Error('Expected a normal Stellar transaction')
      }
      if (transaction.memo.type !== 'none') {
        throw new Error(
          'Transaction contains a memo. Soroban transactions do not support memos.'
        )
      }
      return transaction as never
    })

    const client = new StellarClient()
    const priceLookup = vi.spyOn(client, 'convertCentsToStroops')
    const result = await client.buildTipTransaction(tipper, {
      tipper,
      articleSymbol: 'abc123def4',
      authorAddress: author,
      amountStroops: 12_345_678,
      contractId: SERVER_QUOTE_CONTRACT_ID,
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
    })

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
      'tip_article'
    )
    expect(invocation.args()).toHaveLength(4)
    expect(StellarSdk.scValToNative(invocation.args()[0]!)).toBe(tipper)
    expect(StellarSdk.scValToNative(invocation.args()[1]!)).toBe('abc123def4')
    expect(StellarSdk.scValToNative(invocation.args()[2]!)).toBe(author)
    expect(StellarSdk.scValToNative(invocation.args()[3]!)).toBe(
      BigInt(12_345_678)
    )
  })

  it('rejects a trusted amount below the contract minimum before loading an account', async () => {
    const StellarSdk = await import('@stellar/stellar-sdk')
    const { StellarClient } = await import('@/lib/stellar/client')
    const loadAccount = vi.spyOn(
      StellarSdk.Horizon.Server.prototype,
      'loadAccount'
    )
    const client = new StellarClient()

    await expect(
      client.buildTipTransaction(StellarSdk.Keypair.random().publicKey(), {
        tipper: StellarSdk.Keypair.random().publicKey(),
        articleSymbol: 'abc123def4',
        authorAddress: StellarSdk.Keypair.random().publicKey(),
        amountStroops: MINIMUM_TIP_STROOPS - 1,
        contractId: SERVER_QUOTE_CONTRACT_ID,
        timeBounds: {
          minTime: '123456789',
          maxTime: '2000000000',
        },
      })
    ).rejects.toThrow('Invalid trusted article tip amount')
    expect(loadAccount).not.toHaveBeenCalled()
  })

  it.each(['PENDING', 'DUPLICATE'] as const)(
    'returns the transaction hash immediately when Soroban reports %s',
    async (status) => {
      const StellarSdk = await import('@stellar/stellar-sdk')
      const { StellarClient } = await import('@/lib/stellar/client')
      const source = StellarSdk.Keypair.random().publicKey()
      const signedXdr = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(source, '0'),
        {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: StellarSdk.Networks.TESTNET,
        }
      )
        .addOperation(
          StellarSdk.Operation.manageData({
            name: 'quilltip-test',
            value: 'submitted',
          })
        )
        .setTimeout(30)
        .build()
        .toXDR()
      const sendTransaction = vi
        .spyOn(StellarSdk.rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
          status,
          hash: 'accepted-transaction-hash',
          latestLedger: 123,
          latestLedgerCloseTime: 456,
        } as never)
      const getTransaction = vi
        .spyOn(StellarSdk.rpc.Server.prototype, 'getTransaction')
        .mockRejectedValue(
          new Error('accepted transactions must not be polled')
        )

      const receipt = await new StellarClient().submitTipTransaction(signedXdr)

      expect(receipt.transactionHash).toBe('accepted-transaction-hash')
      expect(sendTransaction).toHaveBeenCalledOnce()
      expect(getTransaction).not.toHaveBeenCalled()
    }
  )
})
