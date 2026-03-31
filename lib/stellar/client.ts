import { createHash } from 'crypto'
import { STELLAR_CONFIG } from './config'
import { loadStellarSdk } from './sdk-loader'
import type { Keypair } from '@stellar/stellar-sdk'
// Note: Memos cannot be used with Soroban source account auth
// (Stellar protocol restriction: "non-source auth Soroban tx uses memo or muxed source account")
import type {
  TipParams,
  TipReceipt,
  TransactionResult,
  AuthorBalance,
  TipData,
  XLMPriceData,
} from './types'

/**
 * Generate a deterministic short ID from article ID using SHA256
 * This prevents collisions that could occur with simple truncation
 */
function shortArticleId(articleId: string): string {
  return createHash('sha256').update(articleId).digest('hex').slice(0, 10)
}

// Cache for XLM price to avoid excessive API calls
let xlmPriceCache: { price: number; timestamp: number; source: string } | null =
  null
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute cache
const PRICE_FETCH_TIMEOUT = 5000 // 5 second timeout per oracle
const MAX_REASONABLE_XLM_PRICE = 100 // Sanity check upper bound

// Price oracles with parsers (in priority order)
const PRICE_ORACLES = [
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    parse: (data: Record<string, unknown>) =>
      (data?.stellar as Record<string, number>)?.usd,
  },
  {
    name: 'CoinCap',
    url: 'https://api.coincap.io/v2/assets/stellar',
    parse: (data: Record<string, unknown>) => {
      const priceUsd = (data?.data as Record<string, string>)?.priceUsd
      return priceUsd ? parseFloat(priceUsd) : undefined
    },
  },
  {
    name: 'Binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=XLMUSDT',
    parse: (data: Record<string, unknown>) => {
      const price = (data as { price?: string })?.price
      return price ? parseFloat(price) : undefined
    },
  },
  {
    name: 'Kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XLMUSD',
    parse: (data: Record<string, unknown>) => {
      const result = (data as { result?: Record<string, { c?: string[] }> })
        ?.result
      const ticker = result?.XXLMZUSD || result?.XLMUSD
      return ticker?.c?.[0] ? parseFloat(ticker.c[0]) : undefined
    },
  },
]

/**
 * Fetch real-time XLM price with fallback oracles
 */
async function fetchXLMPrice(): Promise<number> {
  if (xlmPriceCache && Date.now() - xlmPriceCache.timestamp < PRICE_CACHE_TTL) {
    return xlmPriceCache.price
  }

  for (const oracle of PRICE_ORACLES) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        PRICE_FETCH_TIMEOUT
      )

      const response = await fetch(oracle.url, {
        signal: controller.signal,
        next: { revalidate: 60 },
      })
      clearTimeout(timeoutId)

      if (!response.ok) continue

      const data = await response.json()
      const price = oracle.parse(data)

      if (
        typeof price === 'number' &&
        price > 0 &&
        price < MAX_REASONABLE_XLM_PRICE
      ) {
        xlmPriceCache = { price, timestamp: Date.now(), source: oracle.name }
        console.debug(`[XLM Price] $${price.toFixed(4)} from ${oracle.name}`)
        return price
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'Unknown'
      if (errorName === 'AbortError') {
        console.warn(`[XLM Price] ${oracle.name} timeout`)
      } else {
        console.warn(`[XLM Price] ${oracle.name} error:`, error)
      }
    }
  }

  console.error(
    '[XLM Price] ALL ORACLES FAILED - using fallback rate $' +
      STELLAR_CONFIG.XLM_TO_USD_RATE
  )
  xlmPriceCache = {
    price: STELLAR_CONFIG.XLM_TO_USD_RATE,
    timestamp: Date.now(),
    source: 'Fallback',
  }
  return STELLAR_CONFIG.XLM_TO_USD_RATE
}

type StellarSdkContext = {
  StellarSdk: Awaited<ReturnType<typeof loadStellarSdk>>
  server: InstanceType<
    Awaited<ReturnType<typeof loadStellarSdk>>['Horizon']['Server']
  >
  sorobanServer: InstanceType<
    Awaited<ReturnType<typeof loadStellarSdk>>['rpc']['Server']
  >
}

export class StellarClient {
  private readonly networkPassphrase = STELLAR_CONFIG.NETWORK_PASSPHRASE
  private sdkContextPromise: Promise<StellarSdkContext> | null = null

  private async getSdkContext(): Promise<StellarSdkContext> {
    this.sdkContextPromise ??= (async () => {
      const StellarSdk = await loadStellarSdk()
      const server = new StellarSdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL)
      const sorobanServer = new StellarSdk.rpc.Server(
        STELLAR_CONFIG.SOROBAN_RPC_URL
      )
      return { StellarSdk, server, sorobanServer }
    })()
    return this.sdkContextPromise
  }

  async convertCentsToStroops(cents: number): Promise<number> {
    const xlmPrice = await fetchXLMPrice()
    const usdAmount = cents / 100
    const xlmAmount = usdAmount / xlmPrice
    const stroops = Math.floor(xlmAmount * 10_000_000)

    return Math.max(stroops, STELLAR_CONFIG.MINIMUM_TIP_STROOPS)
  }

  async convertStroopsToUSD(stroops: number): Promise<number> {
    const xlmPrice = await fetchXLMPrice()
    const xlmAmount = stroops / 10_000_000
    return xlmAmount * xlmPrice
  }

  async getXLMPrice(): Promise<number> {
    return fetchXLMPrice()
  }

  async createAccount(): Promise<Keypair> {
    const { StellarSdk } = await this.getSdkContext()
    const keypair = StellarSdk.Keypair.random()

    if (STELLAR_CONFIG.NETWORK === 'TESTNET') {
      try {
        await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`)
      } catch (error) {
        console.error('Failed to fund testnet account:', error)
      }
    }

    return keypair
  }

  async getBalance(publicKey: string): Promise<AuthorBalance> {
    const { server } = await this.getSdkContext()
    try {
      const account = await server.loadAccount(publicKey)
      const xlmBalance = account.balances.find(
        (balance) => balance.asset_type === 'native'
      )

      const balanceStroops = xlmBalance
        ? Math.floor(parseFloat(xlmBalance.balance) * 10_000_000)
        : 0

      return {
        address: publicKey,
        balance: balanceStroops,
        balanceXLM: balanceStroops / 10_000_000,
        balanceUSD: await this.convertStroopsToUSD(balanceStroops),
        pendingWithdrawal: false,
      }
    } catch {
      return {
        address: publicKey,
        balance: 0,
        balanceXLM: 0,
        balanceUSD: 0,
        pendingWithdrawal: false,
      }
    }
  }

  async sendPayment(
    sourceKeypair: Keypair,
    destinationId: string,
    amountStroops: number
  ): Promise<TransactionResult> {
    const { StellarSdk, server } = await this.getSdkContext()
    try {
      const sourceAccount = await server.loadAccount(
        sourceKeypair.publicKey()
      )
      const xlmAmount = (amountStroops / 10_000_000).toFixed(7)

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationId,
            asset: StellarSdk.Asset.native(),
            amount: xlmAmount,
          })
        )
        .addMemo(StellarSdk.Memo.text('payment'))
        .setTimeout(30)
        .build()

      transaction.sign(sourceKeypair)

      const result = await server.submitTransaction(transaction)

      return {
        success: true,
        hash: result.hash,
      }
    } catch (error) {
      console.error('Payment failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async buildTipTransaction(
    tipperPublicKey: string,
    params: TipParams
  ): Promise<{
    xdr: string
    stroops: number
    authorReceived: number
    platformFee: number
  }> {
    const { StellarSdk, server, sorobanServer } = await this.getSdkContext()
    const stroops = await this.convertCentsToStroops(params.amountCents)
    const platformFee = Math.floor(
      (stroops * STELLAR_CONFIG.PLATFORM_FEE_BPS) / 10_000
    )
    const authorReceived = stroops - platformFee

    const account = await server.loadAccount(tipperPublicKey)

    const contract = new StellarSdk.Contract(STELLAR_CONFIG.TIPPING_CONTRACT_ID)

    const stroopsBigInt = BigInt(stroops)

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'tip_article',
          StellarSdk.nativeToScVal(tipperPublicKey, { type: 'address' }),
          StellarSdk.nativeToScVal(shortArticleId(params.articleId), {
            type: 'symbol',
          }),
          StellarSdk.nativeToScVal(params.authorAddress, { type: 'address' }),
          StellarSdk.nativeToScVal(stroopsBigInt, { type: 'i128' })
        )
      )
      .setTimeout(180)
      .build()

    const preparedTransaction =
      await sorobanServer.prepareTransaction(transaction)

    return {
      xdr: preparedTransaction.toXDR(),
      stroops,
      authorReceived,
      platformFee,
    }
  }

  async buildHighlightTipTransaction(
    tipperPublicKey: string,
    params: {
      highlightId: string
      articleId: string
      authorAddress: string
      amountCents: number
    }
  ): Promise<{
    xdr: string
    stroops: number
    authorReceived: number
    platformFee: number
  }> {
    const { StellarSdk, server, sorobanServer } = await this.getSdkContext()
    const stroops = await this.convertCentsToStroops(params.amountCents)
    const platformFee = Math.floor(
      (stroops * STELLAR_CONFIG.PLATFORM_FEE_BPS) / 10_000
    )
    const authorReceived = stroops - platformFee

    const account = await server.loadAccount(tipperPublicKey)

    const contract = new StellarSdk.Contract(STELLAR_CONFIG.TIPPING_CONTRACT_ID)

    const stroopsBigInt = BigInt(stroops)

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'tip_highlight_direct',
          StellarSdk.nativeToScVal(tipperPublicKey, { type: 'address' }),
          StellarSdk.nativeToScVal(params.highlightId, { type: 'string' }),
          StellarSdk.nativeToScVal(shortArticleId(params.articleId), {
            type: 'symbol',
          }),
          StellarSdk.nativeToScVal(params.authorAddress, { type: 'address' }),
          StellarSdk.nativeToScVal(stroopsBigInt, { type: 'i128' })
        )
      )
      .setTimeout(180)
      .build()

    const preparedTransaction =
      await sorobanServer.prepareTransaction(transaction)

    return {
      xdr: preparedTransaction.toXDR(),
      stroops,
      authorReceived,
      platformFee,
    }
  }

  async submitTipTransaction(signedXDR: string): Promise<TipReceipt> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedXDR,
      this.networkPassphrase
    )

    const result = await sorobanServer.sendTransaction(transaction)

    if (result.status === 'PENDING') {
      let txResult = await sorobanServer.getTransaction(result.hash)
      let retries = 0
      const maxRetries = 30

      while (txResult.status === 'NOT_FOUND' && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        txResult = await sorobanServer.getTransaction(result.hash)
        retries++
      }

      if (txResult.status === 'SUCCESS') {
        const returnValue = txResult.returnValue
        if (returnValue) {
          const receipt = StellarSdk.scValToNative(returnValue)

          return {
            tipId: receipt.tip_id.toString(),
            amountSent: receipt.amount_sent,
            authorReceived: receipt.author_received,
            platformFee: receipt.platform_fee,
            timestamp: new Date(Number(receipt.timestamp) * 1000),
            transactionHash: result.hash,
          }
        }
      } else if (txResult.status === 'FAILED') {
        throw new Error('Transaction failed on the network')
      } else if (txResult.status === 'NOT_FOUND' && retries >= maxRetries) {
        throw new Error(
          'Transaction timeout: Could not confirm transaction after 30 seconds'
        )
      }
    }

    const errorMessage = result.errorResult
      ? `Transaction failed: ${JSON.stringify(result.errorResult)}`
      : `Transaction failed with status: ${result.status}`

    throw new Error(errorMessage)
  }

  async getArticleTips(articleId: string): Promise<TipData[]> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const contract = new StellarSdk.Contract(
        STELLAR_CONFIG.TIPPING_CONTRACT_ID
      )

      const account = new StellarSdk.Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0'
      )

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_article_tips',
            StellarSdk.nativeToScVal(shortArticleId(articleId), {
              type: 'symbol',
            })
          )
        )
        .setTimeout(30)
        .build()

      const result = await sorobanServer.simulateTransaction(transaction)

      if (
        StellarSdk.rpc.Api.isSimulationSuccess(result) &&
        result.result?.retval
      ) {
        const tips = StellarSdk.scValToNative(result.result.retval)
        return tips.map(
          (tip: { tipper: string; amount: number; timestamp: number }) => ({
            tipper: tip.tipper,
            amount: tip.amount,
            timestamp: new Date(tip.timestamp * 1000),
          })
        )
      }

      return []
    } catch (error) {
      console.error('Error getting article tips:', error)
      return []
    }
  }

  async withdrawEarnings(): Promise<TransactionResult> {
    return {
      success: true,
      hash: `mock_withdraw_${Date.now()}`,
    }
  }

  async getXLMPriceData(): Promise<XLMPriceData> {
    const price = await fetchXLMPrice()
    return {
      price,
      timestamp: new Date(),
      source: xlmPriceCache!.source,
      isFallback: xlmPriceCache!.source === 'Fallback',
    }
  }

  async fundTestnetAccount(publicKey: string): Promise<boolean> {
    if (STELLAR_CONFIG.NETWORK !== 'TESTNET') {
      console.error('Can only fund accounts on testnet')
      return false
    }

    try {
      const response = await fetch(
        `https://friendbot.stellar.org?addr=${publicKey}`
      )
      return response.ok
    } catch (error) {
      console.error('Failed to fund account:', error)
      return false
    }
  }

  async buildExtendContractTTLTransaction(
    adminPublicKey: string,
    contractId: string = STELLAR_CONFIG.TIPPING_CONTRACT_ID,
    ledgersToExtend: number = 535680
  ): Promise<{ xdr: string; contractId: string }> {
    const { StellarSdk, server, sorobanServer } = await this.getSdkContext()
    if (!contractId) {
      throw new Error('Contract ID is required')
    }

    const account = await server.loadAccount(adminPublicKey)

    const contract = new StellarSdk.Contract(contractId)
    const contractAddress = contract.address()

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.extendFootprintTtl({
          extendTo: ledgersToExtend,
        })
      )
      .setTimeout(180)
      .setSorobanData(
        new StellarSdk.SorobanDataBuilder()
          .setReadOnly([
            StellarSdk.xdr.LedgerKey.contractData(
              new StellarSdk.xdr.LedgerKeyContractData({
                contract: contractAddress.toScAddress(),
                key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: StellarSdk.xdr.ContractDataDurability.persistent(),
              })
            ),
          ])
          .build()
      )
      .build()

    const preparedTransaction =
      await sorobanServer.prepareTransaction(transaction)

    return {
      xdr: preparedTransaction.toXDR(),
      contractId,
    }
  }

  async submitExtendTTLTransaction(
    signedXDR: string
  ): Promise<{ success: boolean; hash?: string; error?: string }> {
    const { StellarSdk, sorobanServer } = await this.getSdkContext()
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedXDR,
        this.networkPassphrase
      )
      const result = await sorobanServer.sendTransaction(transaction)

      if (result.status === 'PENDING') {
        let txResult = await sorobanServer.getTransaction(result.hash)
        let retries = 0

        while (txResult.status === 'NOT_FOUND' && retries < 30) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          txResult = await sorobanServer.getTransaction(result.hash)
          retries++
        }

        if (txResult.status === 'SUCCESS') {
          return { success: true, hash: result.hash }
        } else {
          return {
            success: false,
            error: `Transaction failed: ${txResult.status}`,
          }
        }
      }

      return { success: false, error: `Unexpected status: ${result.status}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Stellar] Extend TTL failed:', message)
      return { success: false, error: message }
    }
  }
}

export const stellarClient = new StellarClient()
